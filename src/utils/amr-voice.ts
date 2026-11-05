import { fetchImage } from '@/core/request';
import { isArchiveUrl } from '@/composables/useOfflineMedia';
import { useSettingsStore } from '@/stores/settings';

// 解码结果（WAV blob URL）按原始 URL 缓存，同一条语音在楼中楼/多楼层复用不再重复取流解码
const CACHE_LIMIT = 24;
const resolvedCache = new Map<string, string>(); // 原始 URL -> blob: WAV URL（插入序即 LRU 序）
const inflight = new Map<string, Promise<string>>();

function cacheResolved(url: string, blobUrl: string): string {
    resolvedCache.delete(url);
    resolvedCache.set(url, blobUrl);
    if (resolvedCache.size > CACHE_LIMIT) {
        const oldest = resolvedCache.keys().next().value;
        if (oldest !== undefined && oldest !== url) URL.revokeObjectURL(resolvedCache.get(oldest)!);
        resolvedCache.delete(oldest!);
    }
    return blobUrl;
}

async function fetchVoiceBytes(url: string): Promise<Uint8Array> {
    if (isArchiveUrl(url)) {
        // 归档协议由 Rust 侧响应并带 CORS 头，前端直接取即可
        const response = await fetch(url);
        if (!response.ok) throw new Error(`归档语音读取失败（HTTP ${response.status}）`);
        return new Uint8Array(await response.arrayBuffer());
    }
    // 远程流经既有 Rust 命令取回（绕开 webview CORS 与防盗链），无需改 Rust
    const dataUrl = await fetchImage(url);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** 取流 → AMR 解码 → WAV blob URL（带缓存与并发去重） */
export function resolveVoiceUrl(url: string): Promise<string> {
    const cached = resolvedCache.get(url);
    if (cached) {
        resolvedCache.delete(url);
        resolvedCache.set(url, cached);
        return Promise.resolve(cached);
    }
    let pending = inflight.get(url);
    if (!pending) {
        pending = (async () => {
            // 按需加载：解码器含 ~350KB 内联 WASM，首次遇到语音才拉取分块
            const { decodeAmr, pcmToWav } = await import('./amr-codec');
            const bytes = await fetchVoiceBytes(url);
            const { channelData, sampleRate } = await decodeAmr(bytes);
            const blob = new Blob([pcmToWav(channelData, sampleRate) as BlobPart], { type: 'audio/wav' });
            return cacheResolved(url, URL.createObjectURL(blob));
        })();
        // 挂一个处理器避免暂无调用方时的 unhandled rejection，并在落定后清理并发表
        inflight.set(url, pending);
        pending.then(() => inflight.delete(url), () => inflight.delete(url));
    }
    return pending;
}

function archiveOnlineFallbackEnabled(): boolean {
    try { return useSettingsStore().archiveOnlineFallback; } catch { return false; }
}

/**
 * 为容器内 `<audio data-amr-src>` 语音元素解码注入 WAV 源（幂等，可重复调用）。
 * 归档副本缺失且开启联网回退时，退回原始远程 URL 重试一次。
 */
export function hydrateVoiceAudios(root: ParentNode | null | undefined): void {
    if (!root) return;
    root.querySelectorAll<HTMLAudioElement>('audio[data-amr-src]').forEach((audio) => {
        if (audio.dataset.voiceState) return;
        const source = audio.getAttribute('data-amr-src') || '';
        if (!source) return;
        hydrateOne(audio, source, true);
    });
}

function hydrateOne(audio: HTMLAudioElement, source: string, allowFallback: boolean): void {
    audio.dataset.voiceState = 'loading';
    resolveVoiceUrl(source)
        .then((wavUrl) => {
            if (!audio.isConnected) return;
            audio.dataset.voiceState = 'ready';
            audio.src = wavUrl;
        })
        .catch((error) => {
            console.warn('语音加载失败:', source, error);
            const remote = audio.getAttribute('data-remote-src') || '';
            if (allowFallback && isArchiveUrl(source) && remote && remote !== source && archiveOnlineFallbackEnabled()) {
                hydrateOne(audio, remote, false);
                return;
            }
            if (!audio.isConnected) return;
            const placeholder = document.createElement('span');
            placeholder.className = 'media-placeholder';
            placeholder.textContent = '[语音加载失败]';
            audio.replaceWith(placeholder);
        });
}
