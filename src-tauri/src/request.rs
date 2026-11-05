use reqwest::header::{HeaderValue, COOKIE, REFERER, USER_AGENT};
use reqwest::{Client, Proxy};
use serde::Deserialize;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use tauri::command;

#[derive(Serialize)]
pub struct ResponseData {
    pub status: u16,
    pub text: String,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestSchema {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub cookie: Option<String>,
    pub body: Option<String>,
    pub proxy_url: Option<String>,
}

pub async fn http_request(request: RequestSchema) -> Result<ResponseData, String> {
    let client = build_client(request.proxy_url.as_deref())?;
    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid HTTP method: {e}"))?;
    let mut builder = client.request(method, &request.url);
    // Cookie has a single wire representation: merge the `cookie` field with
    // any Cookie-named header instead of sending duplicate Cookie headers.
    let mut cookie = request.cookie.filter(|v| !v.trim().is_empty());
    let mut headers = request.headers.unwrap_or_default();
    let cookie_keys: Vec<String> = headers
        .keys()
        .filter(|key| key.eq_ignore_ascii_case("cookie"))
        .cloned()
        .collect();
    for key in cookie_keys {
        if let Some(value) = headers.remove(&key) {
            if !value.trim().is_empty() {
                cookie = Some(match cookie.take() {
                    Some(existing) => format!("{value}; {existing}"),
                    None => value,
                });
            }
        }
    }
    if let Some(cookie) = cookie {
        builder = builder.header(COOKIE, cookie);
    }
    for (name, value) in headers {
        let name = name
            .parse::<reqwest::header::HeaderName>()
            .map_err(|e| format!("Invalid header name: {e}"))?;
        builder = builder.header(
            name,
            HeaderValue::from_str(&value).map_err(|e| format!("Invalid header value: {e}"))?,
        );
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let response = builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = response.status().as_u16();
    // Join repeated response headers (e.g. multiple Set-Cookie) instead of
    // letting a HashMap overwrite all but the last one.
    let mut response_headers: HashMap<String, String> = HashMap::new();
    for (key, value) in response.headers().iter() {
        let entry = response_headers.entry(key.to_string()).or_default();
        if !entry.is_empty() {
            entry.push_str(", ");
        }
        entry.push_str(value.to_str().unwrap_or(""));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    Ok(ResponseData {
        status,
        text,
        headers: response_headers,
    })
}

fn build_client(proxy_url: Option<&str>) -> Result<Client, String> {
    static CLIENTS: OnceLock<Mutex<HashMap<Option<String>, Client>>> = OnceLock::new();
    let key = proxy_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let mut clients = CLIENTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "HTTP client cache lock poisoned".to_string())?;
    if let Some(client) = clients.get(&key) {
        return Ok(client.clone());
    }
    let mut builder = Client::builder().timeout(std::time::Duration::from_secs(30));

    if let Some(proxy_url) = key.as_deref() {
        let proxy = Proxy::all(proxy_url).map_err(|error| format!("Invalid proxy: {}", error))?;
        builder = builder.proxy(proxy);
    }

    let client = builder
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {}", error))?;
    // Bound retained pools when users switch between many proxy configurations.
    if clients.len() >= 8 {
        clients.clear();
    }
    clients.insert(key, client.clone());
    Ok(client)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::time::{timeout, Duration};

    #[tokio::test]
    async fn form_posts_forward_headers_and_cookie_without_leaking_to_next_request() {
        timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let proxy = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut requests = Vec::new();
                for _ in 0..2 {
                    let mut header = Vec::new();
                    while !header.ends_with(b"\r\n\r\n") {
                        header.push(socket.read_u8().await.unwrap());
                    }
                    let header = String::from_utf8(header).unwrap().to_ascii_lowercase();
                    let length = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    let mut body = vec![0; length];
                    socket.read_exact(&mut body).await.unwrap();
                    requests.push((header, body));
                    socket
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                        .await
                        .unwrap();
                }
                requests
            });
            let headers = HashMap::from([(
                "Content-Type".to_string(),
                "application/x-www-form-urlencoded".to_string(),
            )]);
            assert_eq!(
                http_request(RequestSchema {
                    url: "http://neotieba.invalid/".to_string(),
                    method: Some("POST".to_string()),
                    headers: Some(headers),
                    cookie: Some("session=test".to_string()),
                    body: Some("tid=123&sign=ABC".to_string()),
                    proxy_url: Some(proxy.clone()),
                })
                .await
                .unwrap()
                .text,
                "OK"
            );
            assert_eq!(
                http_request(RequestSchema {
                    url: "http://neotieba.invalid/".to_string(),
                    method: Some("POST".to_string()),
                    headers: None,
                    cookie: None,
                    body: Some("plain-body".to_string()),
                    proxy_url: Some(proxy),
                })
                .await
                .unwrap()
                .text,
                "OK"
            );
            let requests = server.await.unwrap();
            assert!(requests[0]
                .0
                .contains("content-type: application/x-www-form-urlencoded\r\n"));
            assert!(requests[0].0.contains("cookie: session=test\r\n"));
            assert_eq!(requests[0].1, b"tid=123&sign=ABC");
            assert!(!requests[1].0.contains("cookie:"));
            assert!(!requests[1].0.contains("content-type:"));
            assert_eq!(requests[1].1, b"plain-body");
        })
        .await
        .expect("form requests did not complete on the shared connection");
    }

    #[tokio::test]
    async fn merges_cookie_sources_and_joins_repeated_response_headers() {
        timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let proxy = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut header = Vec::new();
                while !header.ends_with(b"\r\n\r\n") {
                    header.push(socket.read_u8().await.unwrap());
                }
                let header = String::from_utf8(header).unwrap().to_ascii_lowercase();
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nSet-Cookie: A=1\r\nSet-Cookie: B=2\r\nContent-Length: 2\r\n\r\nOK",
                    )
                    .await
                    .unwrap();
                header
            });
            let response = http_request(RequestSchema {
                url: "http://neotieba.invalid/".to_string(),
                method: None,
                headers: Some(HashMap::from([(
                    "Cookie".to_string(),
                    "b=2".to_string(),
                )])),
                cookie: Some("a=1".to_string()),
                body: None,
                proxy_url: Some(proxy),
            })
            .await
            .unwrap();
            let request = server.await.unwrap();
            let cookie_lines: Vec<&str> = request
                .lines()
                .filter(|line| line.starts_with("cookie:"))
                .collect();
            assert_eq!(cookie_lines, vec!["cookie: b=2; a=1"]);
            assert_eq!(
                response.headers.get("set-cookie").map(String::as_str),
                Some("A=1, B=2")
            );
            assert_eq!(response.status, 200);
        })
        .await
        .expect("cookie/header merge test did not complete");
    }

    #[tokio::test]
    async fn reuses_connection_without_retaining_cookie_headers() {
        timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let proxy = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                // Both requests must arrive on this single accepted connection.
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut requests = Vec::new();
                for _ in 0..2 {
                    let mut request = Vec::new();
                    while !request.ends_with(b"\r\n\r\n") {
                        let byte = socket.read_u8().await.unwrap();
                        request.push(byte);
                    }
                    requests.push(String::from_utf8(request).unwrap().to_ascii_lowercase());
                    socket
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                        .await
                        .unwrap();
                }
                requests
            });
            assert_eq!(
                http_request(RequestSchema {
                    url: "http://neotieba.invalid/".to_string(),
                    method: None,
                    headers: None,
                    cookie: Some("session=test".to_string()),
                    body: None,
                    proxy_url: Some(proxy.clone()),
                })
                .await
                .unwrap()
                .text,
                "OK"
            );
            assert_eq!(
                http_request(RequestSchema {
                    url: "http://neotieba.invalid/".to_string(),
                    method: None,
                    headers: None,
                    cookie: None,
                    body: None,
                    proxy_url: Some(format!(" {proxy} ")),
                })
                .await
                .unwrap()
                .text,
                "OK"
            );
            let requests = server.await.unwrap();
            assert!(requests[0].contains("cookie: session=test\r\n"));
            assert!(!requests[1].contains("cookie:"));
        })
        .await
        .expect("client did not reuse its connection");
    }
}

pub async fn fetch_bytes(
    url: &str,
    proxy_url: Option<&str>,
    referer: &str,
    max_bytes: Option<u64>,
) -> Result<(String, Vec<u8>), String> {
    let client = build_client(proxy_url)?;
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(120))
        .header(USER_AGENT, "Mozilla/5.0 (NeoTieba)")
        .header(REFERER, referer)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch {}: {}", url, error))?
        .error_for_status()
        .map_err(|error| format!("Request for {} failed: {}", url, error))?;

    if let Some(max_bytes) = max_bytes {
        if let Some(length) = response.content_length() {
            if length > max_bytes {
                return Err(format!(
                    "{} is {} bytes, exceeding the {} byte limit",
                    url, length, max_bytes
                ));
            }
        }
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("application/octet-stream")
        .trim()
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read body of {}: {}", url, error))?
        .to_vec();
    if let Some(max_bytes) = max_bytes {
        if bytes.len() as u64 > max_bytes {
            return Err(format!(
                "{} is {} bytes, exceeding the {} byte limit",
                url,
                bytes.len(),
                max_bytes
            ));
        }
    }

    Ok((mime, bytes))
}

pub async fn fetch_image(url: &str, proxy_url: Option<&str>) -> Result<(String, Vec<u8>), String> {
    let client = build_client(proxy_url)?;
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(60))
        .header(USER_AGENT, "Mozilla/5.0 (NeoTieba)")
        .header(REFERER, "https://tieba.baidu.com/")
        .send()
        .await
        .map_err(|error| format!("Failed to fetch image: {}", error))?
        .error_for_status()
        .map_err(|error| format!("Image request failed: {}", error))?;

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read image: {}", error))?
        .to_vec();

    Ok((mime, bytes))
}

/// Proxy applied to media-protocol image downloads. Custom-scheme requests
/// carry no per-request proxy, so the frontend settings store pushes the
/// active proxy here via the `set_image_proxy` command.
static IMAGE_PROXY: Mutex<Option<String>> = Mutex::new(None);

pub fn set_image_proxy(proxy_url: Option<String>) {
    let trimmed = proxy_url.filter(|value| !value.trim().is_empty());
    if let Ok(mut slot) = IMAGE_PROXY.lock() {
        *slot = trimmed;
    }
}

fn image_proxy() -> Option<String> {
    IMAGE_PROXY.lock().ok().and_then(|slot| slot.clone())
}

/// Bounded in-memory cache for media-protocol images, keyed by target URL.
/// FIFO eviction once the total payload exceeds [`MAX_IMAGE_CACHE_BYTES`];
/// failures are never cached so broken images retry on their next request.
const MAX_IMAGE_CACHE_BYTES: usize = 64 * 1024 * 1024;

struct ImageCache {
    entries: HashMap<String, (String, Vec<u8>)>,
    order: VecDeque<String>,
    bytes: usize,
}

impl ImageCache {
    fn get(&self, url: &str) -> Option<(String, Vec<u8>)> {
        self.entries.get(url).cloned()
    }

    fn insert(&mut self, url: &str, mime: &str, bytes: &[u8]) {
        if bytes.len() > MAX_IMAGE_CACHE_BYTES {
            return;
        }
        if let Some(old) = self.entries.get(url) {
            self.bytes -= old.1.len();
        } else {
            self.order.push_back(url.to_string());
        }
        self.bytes += bytes.len();
        self.entries
            .insert(url.to_string(), (mime.to_string(), bytes.to_vec()));
        while self.bytes > MAX_IMAGE_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(old) = self.entries.remove(&oldest) {
                self.bytes -= old.1.len();
            }
        }
    }
}

/// Serves media-protocol requests: cache lookup, then `fetch_image` with the
/// stored proxy (which injects the Referer Tieba's CDN requires).
pub async fn fetch_media_image(url: String) -> Result<(String, Vec<u8>), String> {
    static CACHE: OnceLock<Mutex<ImageCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| {
        Mutex::new(ImageCache {
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        })
    });
    if let Some(hit) = cache.lock().ok().and_then(|cache| cache.get(&url)) {
        return Ok(hit);
    }
    let (mime, bytes) = fetch_image(&url, image_proxy().as_deref()).await?;
    if let Ok(mut cache) = cache.lock() {
        cache.insert(&url, &mime, &bytes);
    }
    Ok((mime, bytes))
}

// Connectivity and HTTP acceptance are separate: a 403 still proves reachability.
async fn probe_url(url: &str, proxy_url: Option<&str>) -> Result<u16, String> {
    let response = build_client(proxy_url)?
        .get(url)
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send().await.map_err(|error| format!("连接失败: {}", error))?;
    Ok(response.status().as_u16())
}

#[command]
pub async fn test_connection(proxy_url: Option<String>) -> Result<u16, String> {
    probe_url("https://tieba.baidu.com", proxy_url.as_deref()).await
}

#[cfg(test)]
mod connectivity_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn forbidden_is_reachable_and_probe_sends_browser_headers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                header.push(socket.read_u8().await.unwrap());
            }
            let header = String::from_utf8(header).unwrap().to_ascii_lowercase();
            assert!(header.contains("user-agent: mozilla/5.0"));
            socket
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
        });
        assert_eq!(
            probe_url(
                &format!("http://{address}/"),
                Some(&format!("http://{address}"))
            )
            .await
            .unwrap(),
            403
        );
        server.await.unwrap();
    }
}
