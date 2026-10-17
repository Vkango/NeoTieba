import { writeImage } from 'tauri-plugin-clipboard-x-api';
import { writeFile, remove } from '@tauri-apps/plugin-fs';
import { tempDir, join } from '@tauri-apps/api/path';
import { fetchImage } from '@/core/request';
import { normalizeMediaUrl } from '@/utils/settings-policy';
import { isArchiveUrl } from '@/composables/useOfflineMedia';

interface ParsedDataUrl {
    mediaType: string;
    data: string;
}

/** 解析 data URL 头部。用 indexOf/slice 而非正则，避免对超大 base64 字符串回溯导致 OOM。 */
function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
    const prefix = 'data:';
    if (!dataUrl.startsWith(prefix)) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const meta = dataUrl.slice(prefix.length, comma);
    const semicolon = meta.indexOf(';');
    const mediaType = semicolon < 0 ? meta : meta.slice(0, semicolon);
    if (!mediaType.startsWith('image/')) return null;
    return { mediaType, data: dataUrl.slice(comma + 1) };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new Error('无效的图片 data URL');
    const binary = atob(parsed.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('图片数据读取失败'));
        reader.readAsDataURL(blob);
    });
}

/** 剪贴板 API 对 JPEG/WebP 等格式支持不稳定，统一经 canvas 重绘为 PNG。 */
function convertDataUrlToPng(dataUrl: string): Promise<string> {
    const parsed = parseDataUrl(dataUrl);
    if (parsed?.mediaType === 'image/png') return Promise.resolve(dataUrl);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas 2D 上下文不可用'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = dataUrl;
    });
}

/**
 * 按图片来源获取图片字节的 data URL：
 * - data: URL 直接返回；
 * - 归档协议由 Rust 端响应且带 CORS 头，可直接 fetch；
 * - 远程图片走 Rust 代理（fetchImage），绕开防盗链与 CORS，并复用应用代理设置。
 */
async function resolveImageDataUrl(src: string): Promise<string> {
    if (src.startsWith('data:')) return src;
    if (isArchiveUrl(src)) {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`归档图片读取失败（HTTP ${response.status}）`);
        return blobToDataUrl(await response.blob());
    }
    return fetchImage(normalizeMediaUrl(src));
}

/** 兜底：Web Clipboard API 不可用时，写临时 PNG 文件再由 clipboard-x 写入系统剪贴板。 */
async function copyViaTempFile(pngDataUrl: string): Promise<void> {
    const bytes = dataUrlToBytes(pngDataUrl);
    const path = await join(await tempDir(), `neotieba-clipboard-${Date.now()}.png`);
    await writeFile(path, bytes);
    try {
        await writeImage(path);
    } finally {
        void remove(path).catch(() => undefined);
    }
}

/** 复制图片到系统剪贴板。优先 Web Clipboard API，失败降级 clipboard-x。 */
export async function copyImageToClipboard(src: string): Promise<void> {
    const pngDataUrl = await convertDataUrlToPng(await resolveImageDataUrl(src));
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
            const blob = await (await fetch(pngDataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            return;
        } catch (error) {
            console.warn('Web 剪贴板 API 写入失败，降级 clipboard-x:', error);
        }
    }
    await copyViaTempFile(pngDataUrl);
}
