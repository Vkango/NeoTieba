import decode from '@audio/decode-amr';

// 贴吧语音是 AMR 裸流（无文件头）或仅缺 '#' 的残缺头，解码前统一补全。
// 标准头：AMR-NB 为 "#!AMR\n"，AMR-WB 为 "#!AMR-WB\n"。
const NB_HEADER = '#!AMR\n';
const WB_HEADER = '#!AMR-WB\n';

// 帧总长（含 ToC 头字节），按 FT（帧类型）索引；FT 8-11 为特殊帧（坏帧/舒适噪声），12+ 为占位
const NB_SIZES = [13, 14, 16, 18, 20, 21, 27, 32, 6, 6, 6, 6, 1, 1, 1, 1];
const WB_SIZES = [18, 24, 33, 37, 41, 47, 51, 59, 61, 6, 1, 1, 1, 1, 1, 1];

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
    if (bytes.length < text.length) return false;
    for (let i = 0; i < text.length; i++) {
        if (bytes[i] !== text.charCodeAt(i)) return false;
    }
    return true;
}

function prependHeader(bytes: Uint8Array, header: string): Uint8Array {
    const out = new Uint8Array(bytes.length + header.length);
    for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
    out.set(bytes, header.length);
    return out;
}

/** 按帧长表走完整条帧链：能恰好走到末尾才算该采样率的合法裸流 */
function chainConsumesAll(bytes: Uint8Array, sizes: number[]): boolean {
    if (bytes.length < 2) return false;
    let offset = 0;
    while (offset < bytes.length) {
        const frameType = (bytes[offset] >> 3) & 0x0F;
        const size = sizes[frameType];
        if (!size || offset + size > bytes.length) return false;
        offset += size;
    }
    return true;
}

/** 裸流嗅探：先试帧链，两种都匹配时按首帧 FT 收敛（FT 8 仅存在于 WB，否则默认 NB） */
function detectHeaderlessFlavor(bytes: Uint8Array): string {
    const nb = chainConsumesAll(bytes, NB_SIZES);
    const wb = chainConsumesAll(bytes, WB_SIZES);
    if (nb && wb) return ((bytes[0] >> 3) & 0x0F) > 7 ? WB_HEADER : NB_HEADER;
    if (wb) return WB_HEADER;
    return NB_HEADER;
}

/**
 * 补全 AMR 文件头：标准头原样返回；缺 '#' / 缺 '#!' 的残缺头补齐；
 * 完全无头的裸流按帧长表嗅探 NB/WB 后补头。
 */
export function normalizeAmr(input: Uint8Array | ArrayBuffer): Uint8Array {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (startsWithAscii(bytes, NB_HEADER) || startsWithAscii(bytes, WB_HEADER)) return bytes;
    if (startsWithAscii(bytes, '!AMR-WB\n') || startsWithAscii(bytes, '!AMR\n')) return prependHeader(bytes, '#');
    if (startsWithAscii(bytes, 'AMR\n')) return prependHeader(bytes, '#!');
    return prependHeader(bytes, detectHeaderlessFlavor(bytes));
}

function swapFlavor(bytes: Uint8Array): Uint8Array {
    return prependHeader(bytes.subarray(startsWithAscii(bytes, WB_HEADER) ? WB_HEADER.length : NB_HEADER.length),
        startsWithAscii(bytes, WB_HEADER) ? NB_HEADER : WB_HEADER);
}

async function decodeWithHeader(bytes: Uint8Array): Promise<{ channelData: Float32Array; sampleRate: number } | null> {
    try {
        const { channelData, sampleRate } = await decode(bytes);
        const pcm = channelData[0];
        if (!pcm || !pcm.length || !sampleRate) return null;
        return { channelData: pcm, sampleRate };
    } catch {
        return null;
    }
}

/**
 * 解码 AMR（NB 8kHz / WB 16kHz）为单声道 Float32 PCM。
 * 嗅探失误或首尝失败时换另一种采样率重试一次。
 */
export async function decodeAmr(input: Uint8Array | ArrayBuffer): Promise<{ channelData: Float32Array; sampleRate: number }> {
    const normalized = normalizeAmr(input);
    const first = await decodeWithHeader(normalized);
    if (first) return first;
    const second = await decodeWithHeader(swapFlavor(normalized));
    if (second) return second;
    throw new Error('AMR 解码失败：帧数据损坏或格式不受支持');
}

/** 单声道 Float32 PCM → 16-bit PCM WAV（浏览器原生可播） */
export function pcmToWav(pcm: Float32Array, sampleRate: number): Uint8Array {
    const dataLength = pcm.length * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const writeTag = (offset: number, tag: string) => {
        for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
    };
    writeTag(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeTag(8, 'WAVE');
    writeTag(12, 'fmt ');
    view.setUint32(16, 16, true);       // fmt 块长度
    view.setUint16(20, 1, true);        // PCM
    view.setUint16(22, 1, true);        // 单声道
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // 字节率 = 采样率 × 2 字节
    view.setUint16(32, 2, true);        // 块对齐
    view.setUint16(34, 16, true);       // 位深
    writeTag(36, 'data');
    view.setUint32(40, dataLength, true);
    const samples = new Int16Array(buffer, 44, pcm.length);
    for (let i = 0; i < pcm.length; i++) {
        const clamped = Math.max(-1, Math.min(1, pcm[i]));
        samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }
    return new Uint8Array(buffer);
}
