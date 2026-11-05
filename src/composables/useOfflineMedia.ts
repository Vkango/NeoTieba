import { inject } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { toMediaUrl } from '@/utils/settings-policy';

export type OfflineMediaResolver = (url: string) => string;

const ARCHIVE_URL_PREFIXES = ['http://archive.localhost/', 'https://archive.localhost/', 'archive://'];

/** 判断 URL 是否指向本机 tar 归档（archive:// 协议及其 WebView2 映射形态）。 */
export function isArchiveUrl(url: string): boolean {
    return ARCHIVE_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

/**
 * Returns a resolver that maps remote media URLs to their archived copies
 * (`archive://` protocol) when the component tree lives under a locally
 * archived thread. Returns an identity resolver outside local threads.
 */
export function useOfflineMedia(): OfflineMediaResolver {
    const resolver = inject<OfflineMediaResolver | undefined>('offlineMedia', undefined);
    return (url: string) => {
        if (!url || !/^https?:|^\/\//.test(url)) return url;
        return resolver ? resolver(url) : url;
    };
}

export function hasOfflineMedia(): boolean {
    return inject<OfflineMediaResolver | undefined>('offlineMedia', undefined) !== undefined;
}

/**
 * 归档资源加载失败时的联网回退：查看已保存帖子时，若某资源未归档
 * （例如用户没有保存头像），把元素换回原始远程 URL 尝试联网加载。
 * 元素需带有 data-remote-src（原始 URL）属性；由 processContentElements
 * 与 RemoteImage 等渲染层写入。
 */
export function useArchiveFallback(): (event: Event) => void {
    const settings = useSettingsStore();
    return (event: Event) => {
        if (!settings.archiveOnlineFallback) return;
        const element = event.target as HTMLImageElement & { dataset: DOMStringMap };
        const current = element.getAttribute('src') || '';
        if (!isArchiveUrl(current)) return;
        const remote = element.getAttribute('data-remote-src');
        if (!remote || element.dataset.remoteFallback) return;
        element.dataset.remoteFallback = '1';
        element.src = toMediaUrl(remote);
    };
}
