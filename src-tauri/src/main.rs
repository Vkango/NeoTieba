// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod cookie_manager;
mod file_io;
mod protobuf_api;
mod request;
mod thread_archive;
mod thread_save;
use protobuf_api::protobuf_call;

use cookie_manager::{
    clear_cookies, delete_cookie, get_baidu_auth_cookies, get_cookie, get_cookies,
    get_cookies_string, set_cookie,
};
use file_io::{copy_file_to_install_dir, read_file, read_file_bytes, write_file};
use request::{fetch_image, fetch_media_image, http_request, test_connection, RequestSchema};
use thread_archive::{
    archive_delete, archive_list, archive_media_lookup, archive_read_floor, archive_read_meta,
    archive_read_page,
};
use thread_save::{thread_save_cancel, thread_save_start, thread_save_status, SaveJobs};
use tauri::Manager;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_decorum::WebviewWindowExt;
// Windows effect helpers (apply_acrylic, apply_mica, clear_acrylic, ...) come
// from this glob; macOS uses the explicit import below, so keep it windows-only.
#[cfg(target_os = "windows")]
use window_vibrancy::*;
// use api::{ get_user_info };
use base64::{engine::general_purpose, Engine as _};
use tauri::command;

// src-tauri/src/main.rs
use tauri::{AppHandle, Emitter, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

use std::sync::{Mutex, OnceLock};

// Browser login flow state: remembers the credentials present when the login
// window opened, so a stale session can be told apart from a fresh login.
#[derive(Default)]
struct BrowserLoginState {
    baseline: Option<(String, String)>,
    settled: bool,
}

fn login_state() -> &'static Mutex<BrowserLoginState> {
    static STATE: OnceLock<Mutex<BrowserLoginState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(BrowserLoginState::default()))
}

fn is_tieba_url(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("tieba.baidu.com")
            || host.to_ascii_lowercase().ends_with(".tieba.baidu.com")
    })
}

async fn complete_login<R: Runtime>(
    app: AppHandle<R>,
    login_window: Option<WebviewWindow<R>>,
    bduss: String,
    stoken: String,
) -> Result<(), String> {
    {
        let mut state = login_state().lock().unwrap();
        if state.settled {
            return Ok(());
        }
        state.settled = true;
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "无法找到主窗口".to_string())?;
    main.emit(
        "browser-login-cookies",
        serde_json::json!({
            "bduss": bduss, "stoken": stoken,
        }),
    )
    .map_err(|e| e.to_string())?;

    // The app persists the credentials itself; clean the shared jar so the
    // next login starts logged-out where the platform allows it.
    if let Some(login_window) = login_window {
        if let Err(error) = cookie_manager::clear_baidu_cookies(login_window.clone()).await {
            eprintln!("[login] post-login cookie cleanup failed: {}", error);
        }
        let _ = login_window.close();
    }
    Ok(())
}

// Runs when the login window is destroyed. If the user closed it right after
// logging in, the fresh credentials are still in the shared cookie jar and
// are picked up from the main window.
fn finalize_closed_login<R: Runtime>(app: AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("browser-login-window-closed", ());
    }
    tauri::async_runtime::spawn(async move {
        let (baseline, settled) = {
            let state = login_state().lock().unwrap();
            (state.baseline.clone(), state.settled)
        };
        if settled {
            return;
        }
        let Some(main) = app.get_webview_window("main") else {
            return;
        };
        let Ok(Some((bduss, stoken))) = cookie_manager::read_baidu_auth(main).await else {
            return;
        };
        if baseline.as_ref() != Some(&(bduss.clone(), stoken.clone())) {
            eprintln!("[login] login window closed after a fresh login, recovering credentials");
            let _ = complete_login(app, None, bduss, stoken).await;
        }
    });
}

#[tauri::command]
async fn open_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("login_window") {
        return window.set_focus().map_err(|e| e.to_string());
    }

    let url = Url::parse("https://passport.baidu.com/v2/?login&u=https%3A%2F%2Ftieba.baidu.com")
        .map_err(|e| format!("无效的URL: {}", e))?;

    let window = WebviewWindowBuilder::new(
        &app,
        "login_window",
        WebviewUrl::External(Url::parse("about:blank").unwrap()),
    )
    .title("登录百度账号")
    .inner_size(800.0, 600.0)
    .center()
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    // Best effort: clear the native cookie store before the login page loads
    // so it starts logged-out where the platform allows it. Clearing is NOT
    // reliable on every webview backend.
    if let Err(error) = cookie_manager::clear_baidu_cookies(window.clone()).await {
        eprintln!("[login] cookie cleanup failed: {}", error);
    }

    // Capture whatever credentials survived the cleanup; login detection
    // below only ever accepts credentials DIFFERENT from these, so a stale
    // session can never be mistaken for a completed login.
    let baseline = cookie_manager::read_baidu_auth(window.clone()).await?;
    {
        let mut state = login_state().lock().unwrap();
        state.baseline = baseline;
        state.settled = false;
    }

    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            finalize_closed_login(close_app.clone());
        }
    });

    if let Err(error) = window.navigate(url) {
        let _ = window.close();
        return Err(format!("打开登录页失败: {}", error));
    }

    // Auto-complete once the page has actually landed on tieba.baidu.com
    // (passport redirects there after a successful login) with credentials
    // that differ from the ones captured at open time.
    let poll_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if login_state().lock().unwrap().settled {
                return;
            }
            let Some(login_window) = poll_app.get_webview_window("login_window") else {
                return;
            };
            let auth = match cookie_manager::read_baidu_auth(login_window.clone()).await {
                Ok(auth) => auth,
                Err(_) => None,
            };
            if let Some((bduss, stoken)) = auth {
                let unchanged = {
                    let state = login_state().lock().unwrap();
                    state.baseline.as_ref() == Some(&(bduss.clone(), stoken.clone()))
                };
                let on_tieba = login_window
                    .url()
                    .map(|url| is_tieba_url(&url))
                    .unwrap_or(false);
                if !unchanged && on_tieba {
                    eprintln!("[login] fresh credentials detected on tieba.baidu.com");
                    let _ = complete_login(poll_app, Some(login_window), bduss, stoken).await;
                    return;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
    Ok(())
}

/// Reads BDUSS/STOKEN from the login window after the user explicitly
/// confirmed they finished logging in (e.g. re-using the same account, where
/// the credentials did not change and auto-detection stays silent).
#[tauri::command]
async fn finish_browser_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("login_window")
        .ok_or_else(|| "登录窗口未打开".to_string())?;

    let (bduss, stoken) = cookie_manager::read_baidu_auth(window.clone())
        .await?
        .ok_or_else(|| "未检测到登录凭据, 请先在登录窗口完成登录".to_string())?;

    complete_login(app, Some(window), bduss, stoken).await
}

#[tauri::command]
async fn cancel_browser_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("login_window") {
        // Mark settled first so closing the window cannot recover the
        // credentials from the jar afterwards.
        login_state().lock().unwrap().settled = true;
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
fn toggle_devtools<R: Runtime>(window: tauri::WebviewWindow<R>) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
fn set_wallpaper_effect<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    effect: &str,
    dark: Option<bool>,
) -> Result<(), String> {
    if let Err(e) = apply_effect(&window, effect, dark) {
        return Err(format!("apply_effect({}) failed: {}", effect, e));
    }
    Ok(())
}

#[tauri::command]
fn set_window_dark_mode<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    dark: bool,
) -> Result<(), String> {
    // Theme must not implicitly replace the selected wallpaper effect.
    window
        .set_theme(Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|error| format!("枚举系统字体失败: {error}"))
}

#[cfg(target_os = "windows")]
fn apply_effect<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    effect: &str,
    dark: Option<bool>,
) -> Result<(), String> {
    clear_acrylic(window).map_err(|e| e.to_string())?;
    clear_mica(window).map_err(|e| e.to_string())?;
    match effect {
        "acrylic" => apply_acrylic(window, Some((255, 255, 255, 0))).map_err(|e| format!("{}", e)),
        "mica" => apply_mica(window, dark).map_err(|e| format!("{}", e)),
        "image" | "solid" => Ok(()),
        _ => Err("Unsupported wallpaper effect".into()),
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_effect<R: Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _effect: &str,
    _dark: Option<bool>,
) -> Result<(), String> {
    Ok(())
}

#[command]
async fn http_request_command(request: RequestSchema) -> Result<request::ResponseData, String> {
    http_request(request).await
}

#[command]
async fn fetch_image_base64(url: &str, proxy_url: Option<String>) -> Result<String, String> {
    let (mime, bytes) = fetch_image(url, proxy_url.as_deref()).await?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    ))
}

/// Resolves `(tid, member)` from an archive media request URI.
///
/// The webview may deliver the custom scheme in several shapes depending on
/// platform and Tauri/wry version:
/// - `archive://{tid}/media/{hash}`                     (tid in the host)
/// - `archive://localhost/{tid}/media/{hash}`           (tid in the path)
/// - `http://archive.localhost/{tid}/media/{hash}`      (Windows mapping)
/// So the tid is probed in both positions and validated numerically.
fn parse_archive_uri(uri: &str) -> Option<(String, String)> {
    let url = Url::parse(uri).ok()?;
    let host = url.host_str().unwrap_or("");
    let host = host.split(':').next().unwrap_or(host);
    let segments: Vec<&str> = url
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if let [dir, file] = segments[..] {
        if thread_archive::validate_tid(host).is_ok() {
            return Some((host.to_string(), format!("{dir}/{file}")));
        }
    }
    if let [tid, dir, file] = segments[..] {
        if thread_archive::validate_tid(tid).is_ok() {
            return Some((tid.to_string(), format!("{dir}/{file}")));
        }
    }
    None
}

/// Serves media blobs from saved-thread tar archives to the webview.
fn handle_archive_media_request(app: &tauri::AppHandle, uri: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = |message: String| {
        tauri::http::Response::builder()
            .status(404)
            .header("content-type", "text/plain; charset=utf-8")
            .body(message.into_bytes())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
    };

    let Some((tid, member)) = parse_archive_uri(uri) else {
        eprintln!("[archive] unparseable media request: {uri}");
        return not_found(format!("invalid archive request: {uri}"));
    };

    if !member.starts_with("media/")
        || member.contains("..")
        || member.contains('\\')
        || !member[6..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        eprintln!("[archive] invalid member {member:?} for tid {tid}");
        return not_found(format!("invalid archive member: {member}"));
    }

    match thread_archive::read_member_by_tid(app, &tid, &member) {
        Ok(Some(bytes)) => {
            let mime = thread_archive::sniff_mime(&bytes);
            tauri::http::Response::builder()
                .status(200)
                .header("content-type", mime)
                .header("cache-control", "max-age=31536000, immutable")
                .header("access-control-allow-origin", "*")
                .body(bytes)
                .unwrap_or_else(|_| not_found("response build failed".to_string()))
        }
        Ok(None) => not_found(format!("media not found: {tid}/{member}")),
        Err(error) => not_found(error),
    }
}

/// Receives the active proxy from the frontend settings store so media
/// protocol downloads follow proxy changes (scheme requests carry none).
#[command]
fn set_image_proxy(proxy_url: Option<String>) {
    request::set_image_proxy(proxy_url);
}

/// Extracts the percent-encoded target URL from a media request URI.
///
/// The webview may deliver the custom scheme in several shapes depending on
/// platform and Tauri/wry version (see `parse_archive_uri`):
/// - `http://media.localhost/<encoded-url>`   (Windows mapping)
/// - `media://localhost/<encoded-url>`
/// - `media://<encoded-url>`                  (encoded URL in the host)
/// The encoded segment is taken from the raw string: `Url::path()` may
/// already have decoded `%2F`, corrupting the target URL.
fn parse_media_uri(uri: &str) -> Option<String> {
    const MARKERS: [&str; 3] = [
        "http://media.localhost/",
        "https://media.localhost/",
        "media://localhost/",
    ];
    let encoded = MARKERS
        .iter()
        .find_map(|marker| uri.strip_prefix(marker))
        .or_else(|| uri.strip_prefix("media://"))?;
    // Cut any query/fragment appended by cache-busting retries, and a stray
    // trailing slash the webview may add to the host-only form.
    let encoded = encoded
        .split(['?', '#'])
        .next()
        .unwrap_or(encoded)
        .trim_end_matches('/');
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?
        .into_owned();
    if decoded.starts_with("http://") || decoded.starts_with("https://") {
        Some(decoded)
    } else {
        None
    }
}

/// Serves online images to the webview over the `media` scheme: streams raw
/// bytes with long-lived cache headers so WebView loads and decodes them
/// natively instead of shuttling base64 strings over IPC.
async fn handle_media_request(uri: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = |message: String| {
        tauri::http::Response::builder()
            .status(404)
            .header("content-type", "text/plain; charset=utf-8")
            .body(message.into_bytes())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
    };

    let Some(url) = parse_media_uri(uri) else {
        eprintln!("[media] unparseable media request: {uri}");
        return not_found(format!("invalid media request: {uri}"));
    };

    match fetch_media_image(url).await {
        Ok((mime, bytes)) => tauri::http::Response::builder()
            .status(200)
            .header("content-type", mime)
            .header("cache-control", "max-age=86400")
            .header("access-control-allow-origin", "*")
            .body(bytes)
            .unwrap_or_else(|_| not_found("response build failed".to_string())),
        Err(error) => not_found(error),
    }
}

#[cfg(test)]
mod media_uri_tests {
    use super::parse_media_uri;

    const TARGET: &str = "http://imgsrc.baidu.com/forum/pic/item/abc.jpg?x=1";
    // encodeURIComponent 风格编码后的 TARGET（协议相对头已由前端补成 http:）。
    const ENCODED: &str = "http%3A%2F%2Fimgsrc.baidu.com%2Fforum%2Fpic%2Fitem%2Fabc.jpg%3Fx%3D1";

    #[test]
    fn parses_all_webview_uri_shapes() {
        for uri in [
            format!("http://media.localhost/{ENCODED}"),
            format!("https://media.localhost/{ENCODED}"),
            format!("media://localhost/{ENCODED}"),
            format!("media://{ENCODED}"),
            format!("media://{ENCODED}/"), // host 形态可能被补上尾部斜杠
            format!("http://media.localhost/{ENCODED}?r=1"), // 缓存穿透重试
        ] {
            assert_eq!(parse_media_uri(&uri).as_deref(), Some(TARGET), "uri: {uri}");
        }
    }

    #[test]
    fn rejects_non_http_targets_and_garbage() {
        assert_eq!(parse_media_uri("http://media.localhost/data%3Aimage%2Fpng"), None);
        assert_eq!(parse_media_uri("http://media.localhost/"), None);
        assert_eq!(parse_media_uri("https://example.com/nope"), None);
        assert_eq!(parse_media_uri("media://localhost/"), None);
    }
}

fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SaveJobs::default());

    // decorum's macOS traffic-light positioning currently dereferences a
    // null NSView on recent macOS versions during window creation.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_decorum::init());
    }

    builder = builder.register_asynchronous_uri_scheme_protocol("archive", |_ctx, request, responder| {
        let uri = request.uri().to_string();
        let app = _ctx.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            let response = handle_archive_media_request(&app, &uri);
            responder.respond(response);
        });
    });

    builder = builder.register_asynchronous_uri_scheme_protocol("media", |_ctx, request, responder| {
        let uri = request.uri().to_string();
        tauri::async_runtime::spawn(async move {
            let response = handle_media_request(&uri).await;
            responder.respond(response);
        });
    });

    builder
        .invoke_handler(tauri::generate_handler![
            toggle_devtools,
            set_wallpaper_effect,
            set_window_dark_mode,
            list_system_fonts,
            http_request_command,
            test_connection,
            read_file,
            read_file_bytes,
            copy_file_to_install_dir,
            write_file,
            fetch_image_base64,
            set_image_proxy,
            open_login,
            finish_browser_login,
            cancel_browser_login,
            get_cookies,
            get_cookie,
            set_cookie,
            delete_cookie,
            clear_cookies,
            get_baidu_auth_cookies,
            get_cookies_string,
            protobuf_call,
            archive_read_meta,
            archive_read_page,
            archive_read_floor,
            archive_list,
            archive_delete,
            archive_media_lookup,
            thread_save_start,
            thread_save_cancel,
            thread_save_status
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(not(target_os = "macos"))]
            window
                .create_overlay_titlebar()
                .expect("failed to create overlay titlebar");

            #[cfg(target_os = "macos")]
            {
                // Not unwrapped: a vibrancy failure would panic before the
                // window is shown. The window stays usable without the blur.
                if let Err(error) = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    None,
                    None,
                ) {
                    eprintln!("apply_vibrancy failed, falling back to opaque window: {error}");
                }
            }

            #[cfg(target_os = "windows")]
            let _ = apply_acrylic(&window, Some((255, 255, 255, 0)));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod archive_uri_tests {
    use super::parse_archive_uri;

    const TID: &str = "9047774506";
    const HASH: &str = "d009f987a8aeafd49b47dbec34eb7f17e55a523c";

    #[test]
    fn parses_every_delivered_uri_shape() {
        // tid in the host (custom scheme)
        assert_eq!(
            parse_archive_uri(&format!("archive://{TID}/media/{HASH}")),
            Some((TID.to_string(), format!("media/{HASH}")))
        );
        // Windows WebView2 mapping: http://archive.localhost/{tid}/media/{hash}
        assert_eq!(
            parse_archive_uri(&format!("http://archive.localhost/{TID}/media/{HASH}")),
            Some((TID.to_string(), format!("media/{HASH}")))
        );
        // Tauri/wry may route custom schemes via a generic host: the tid then
        // rides in the path (this shape previously produced "invalid tid").
        assert_eq!(
            parse_archive_uri(&format!("archive://localhost/{TID}/media/{HASH}")),
            Some((TID.to_string(), format!("media/{HASH}")))
        );
        assert_eq!(
            parse_archive_uri(&format!("http://localhost/{TID}/media/{HASH}")),
            Some((TID.to_string(), format!("media/{HASH}")))
        );
    }

    #[test]
    fn rejects_requests_without_a_usable_tid() {
        assert_eq!(parse_archive_uri("archive://localhost/media/abc"), None);
        assert_eq!(parse_archive_uri("http://archive.localhost/media/abc"), None);
        assert_eq!(parse_archive_uri("not a url"), None);
        assert_eq!(parse_archive_uri("http://archive.localhost/"), None);
    }

    #[test]
    fn prefers_tid_in_path_when_host_is_not_numeric() {
        // A numeric-looking host must not be mistaken for the tid when the
        // path carries the real one, and vice versa: the numeric probe order
        // keeps the host form working.
        assert_eq!(
            parse_archive_uri(&format!("archive://{TID}/media/{HASH}")),
            Some((TID.to_string(), format!("media/{HASH}")))
        );
    }
}
