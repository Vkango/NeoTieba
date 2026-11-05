export type MediaKind = 'avatars' | 'images' | 'videos' | 'audio';
export interface MediaBlocks { avatars: boolean; images: boolean; videos: boolean; audio: boolean }
export function normalizeMediaBlocks(value: Partial<MediaBlocks> = {}): MediaBlocks {
 return { avatars: value.avatars ?? false, images: value.images ?? true, videos: value.videos ?? false, audio: value.audio ?? false };
}
export function mediaBlocked(enabled: boolean, blocks: MediaBlocks, kind: MediaKind): boolean { return enabled && blocks[kind]; }
export function validateProxy(enabled: boolean, value: string): string | undefined {
 if (!enabled) return undefined;
 const trimmed = value.trim();
 try { const url = new URL(trimmed); if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' && url.pathname !== '' || url.search || url.hash) throw new Error(); }
 catch { throw new Error('请输入有效代理地址，例如 http://127.0.0.1:7890'); }
 return trimmed;
}
export interface Release { name: string; html_url: string; body: string | null; published_at: string; draft: boolean }
export function releaseMetadata(release: Release): { builtAt: string; commit: string } | null {
 const match = release.body?.match(/<!-- neotieba-build: (.+?) -->/);
 try { const data = JSON.parse(match?.[1] ?? 'null'); return data && Number.isFinite(Date.parse(data.builtAt)) && typeof data.commit === 'string' && data.commit ? data : null; } catch { return null; }
}
export function assessRelease(release: Release, builtAt: string, commit: string): 'new' | 'current' | 'unknown' {
 const metadata = releaseMetadata(release);
 if (!metadata || !Number.isFinite(Date.parse(builtAt)) || !commit) return 'unknown';
 if (metadata.commit === commit) return 'current';
 return Date.parse(metadata.builtAt) > Date.parse(builtAt) ? 'new' : 'current';
}

export function connectionMessage(status: number, milliseconds: number): string {
 const elapsed = `用时 ${milliseconds}ms`;
 if (status >= 200 && status < 400) return `连接正常，${elapsed}`;
 return `网络已连通，站点返回 HTTP ${status}${status === 403 ? '（拒绝访问）' : ''}，${elapsed}`;
}

// Respect Tieba's HTTP-only image endpoints; never upgrade an explicit URL.
export function normalizeMediaUrl(value: string): string {
 return value.startsWith('//') ? `http:${value}` : value;
}

// Online images load over the `media` custom scheme (http://media.localhost/
// in the WebView2 mapping): the Rust handler streams raw bytes with Referer
// spoofing, app proxy support and cache headers — no base64 over IPC.
// Local schemes (archive://, its WebView2 http://archive.localhost/ mapping,
// and media:// itself) are passed through untouched. The encoded target goes
// in the path; retries may append `?r=1` to bust the WebView cache.
export function toMediaUrl(value: string): string {
 const url = normalizeMediaUrl(value);
 return /^https?:\/\//.test(url) && !/^https?:\/\/(archive|media)\.localhost\//.test(url)
  ? `http://media.localhost/${encodeURIComponent(url)}`
  : url;
}

/** 判断 URL 是否指向本机 media 协议（含 WebView2 的 http://media.localhost/ 映射形态）。 */
export function isMediaUrl(value: string): boolean {
 return value.startsWith('media://') || /^https?:\/\/media\.localhost\//.test(value);
}
