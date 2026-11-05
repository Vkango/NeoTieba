import type { MediaBlocks } from './settings-policy';
import { toMediaUrl } from './settings-policy';
import type { ContentElement } from '@/types';
import { sanitize } from './sanitizer';
import { useSettingsStore } from '@/stores/settings';

export function getTimeInterval(previousTimestamp: number): string {
    const currentTimestamp = Date.now();
    const diffInSeconds = (currentTimestamp - previousTimestamp) / 1000;

    if (diffInSeconds < 60) {
        return "刚刚";
    } else if (diffInSeconds < 60 * 60) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes}分钟前`;
    } else if (diffInSeconds < 60 * 60 * 24) {
        const hours = Math.floor(diffInSeconds / (60 * 60));
        return `${hours}小时前`;
    } else if (diffInSeconds < 60 * 60 * 24 * 7) {
        const days = Math.floor(diffInSeconds / (60 * 60 * 24));
        return `${days}天前`;
    } else if (diffInSeconds < 60 * 60 * 24 * 30) {
        const weeks = Math.floor(diffInSeconds / (60 * 60 * 24 * 7));
        return `${weeks}周前`;
    } else if (diffInSeconds < 60 * 60 * 24 * 365) {
        const months = Math.floor(diffInSeconds / (60 * 60 * 24 * 30));
        return `${months}个月前`;
    } else {
        const years = Math.floor(diffInSeconds / (60 * 60 * 24 * 365));
        return `${years}年前`;
    }
}

export function processContentElements(
    elements: ContentElement[],
    dismissMedia = false,
    blocked: MediaBlocks = { avatars: false, images: false, videos: false, audio: false },
    // 归档线程传 offlineMedia（远程 URL → archive://）；默认原样输出，
    // 图片输出点再统一包 toMediaUrl（视频/语音不走 image-only 的 media 协议）。
    resolveUrl: (url: string) => string = (url: string) => url,
    replyTargetAvatar = ''
): string {
    let content = '';
    let targetAvatarUsed = false;
    // "回复 @xxx :" 里跟在 @ 后的那条文本的下标：渲染它时吞掉冒号、改输出面包屑三角
    let colonAsSeparatorAt = -1;
    // 多图网格：开启后连续图片不再逐张换行，而是包进带间距的网格容器
    let imageGridLayout = false;
    try { imageGridLayout = useSettingsStore().imageGrid; } catch { /* pinia 未激活时按默认（关闭）处理 */ }

    // 连续图片缓冲：相邻的 type 3（中间仅隔空白文本）先收集，遇到其他内容时统一输出
    let imageRun: Array<{ index: number; src: string; fullSrc: string }> = [];
    // 上一段是否输出为块级网格容器（其后的文本/内联内容天然另起一行，无需再加 <br>）
    let afterGridBlock = false;

    const buildImageHtml = (src: string, fullSrc: string, grid: boolean): string => {
        // data-remote-src keeps the ORIGINAL remote URL so that the
        // archive fallback handler can swap it in when the archived
        // copy is missing (e.g. avatars excluded from the archive).
        return `<img class="thread-reply-img"${grid ? '' : ' style="max-height: 450px; max-width: 300px; border-radius: 5px;"'} src="${src ? toMediaUrl(resolveUrl(src)) : src}" data-full-src="${fullSrc}" data-remote-src="${fullSrc}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
    };

    const flushImageRun = () => {
        if (!imageRun.length) return;
        if (imageGridLayout && imageRun.length >= 2) {
            // 网格：去掉图片间的 <br>，由块级容器 + CSS gap 负责排布与换行
            content += `<div class="content-image-grid">${imageRun.map(item => buildImageHtml(item.src, item.fullSrc, true)).join('')}</div>`;
            afterGridBlock = true;
        } else {
            // 单图或未开网格：保持原有逐张换行的输出
            content += imageRun.map(item => (item.index !== 0 ? '<br>' : '') + buildImageHtml(item.src, item.fullSrc, false)).join('');
            afterGridBlock = false;
        }
        imageRun = [];
    };

    elements.forEach((ele, index) => {
        const blankText = ele.type === 0 && !String(ele.text ?? '').trim();
        // 网格收集期间夹在两张图片之间的空白文本（如换行符）直接吞掉，避免打断图片连排
        if (imageGridLayout && blankText && imageRun.length && elements[index + 1]?.type === 3) {
            return;
        }
        if (ele.type !== 3) flushImageRun();
        // 网格容器后的空白文本：块级换行已完成，吞掉避免多出空行
        if (blankText && elements[index - 1]?.type === 3 && afterGridBlock) {
            return;
        }
        switch (ele.type) {
            case 0: // text
                if (index === 0 && ele.text === '\n') {
                    break;
                }
                // 网格容器本身是块级元素，其后的文本天然另起一行，补 <br> 反而多出空行
                if (index !== 0 && elements[index - 1]?.type === 3 && !afterGridBlock) {
                    content += '<br>';
                }
                if (index === colonAsSeparatorAt) {
                    colonAsSeparatorAt = -1;
                    const text = String(ele.text ?? '').replace(/^\s*[:：]\s*/, '');
                    content += `<span class="name-separator" aria-hidden="true"></span>` + text;
                    break;
                }
                content += ele.text || '';
                break;
            case 1: // link
                const decodedLink = decodeURIComponent(
                    (ele.link || '')
                        .replace('https://tieba.baidu.com/mo/q/checkurl?url=', '')
                        .replace('http://tieba.baidu.com/mo/q/checkurl?url=', '')
                ).split('&urlrefer=')[0];
                content += `<a href="${decodedLink}" target="_blank" rel="noopener noreferrer">${ele.text}</a>`;
                break;
            case 2: // emoticon
                content += `<img class="emoticon" src="${'/assets/emoticons/' + ele.text + '.png'}" alt="${ele.c}" />`;
                break;
            case 3:
                if (blocked.images) { flushImageRun(); content += '<span class="media-placeholder">[配图已禁用]</span>'; break; }
                // image
                if (!dismissMedia) {
                    // Tieba's big CDN source is the high-resolution display URL.
                    const imgSrc = ele.bigCdnSrc || ele.big_cdn_src || ele.bigSrc || ele.big_src
                        || ele.originSrc || ele.origin_src;
                    imageRun.push({ index, src: imgSrc || '', fullSrc: imgSrc || '' });
                }
                break;
            case 4: { // at
                // "回复 XXX" 的目标用户前缀一个小头像，方便对上是回复谁（只装饰第一处）
                const prevEle = elements[index - 1];
                const isReplyPrefix = prevEle?.type === 0 && String(prevEle.text ?? '').trim().endsWith('回复');
                if (replyTargetAvatar && !blocked.avatars && !targetAvatarUsed && isReplyPrefix) {
                    content += `<img class="at-avatar" src="${toMediaUrl(resolveUrl(replyTargetAvatar))}" referrerpolicy="no-referrer" alt="">`;
                    targetAvatarUsed = true;
                }
                content += `<button class="at-button" uid="${ele.uid}">${ele.text}</button>`;
                // "回复 @xxx :" 的冒号不在 @ 元素里，而在紧随其后的文本元素开头：标记它，渲染时换成面包屑三角
                if (isReplyPrefix) {
                    const nextEle = elements[index + 1];
                    if (nextEle?.type === 0 && /^\s*[:：]/.test(String(nextEle.text ?? ''))) {
                        colonAsSeparatorAt = index + 1;
                    }
                }
                break;
            }
            case 5:
                if (blocked.videos) { content += '<span class="media-placeholder">[视频已禁用]</span>'; break; }
                // video
                if (!dismissMedia) {
                    const prevElement = elements[index - 1];
                    // 前面是网格容器时块级换行已完成，不再补 <br>，避免多出空行
                    const skipBreak = prevElement?.type === 3 && afterGridBlock;
                    const prefix = (index !== 0 && prevElement?.type !== 0 && prevElement?.text !== '\n' && !skipBreak) ? '<br>' : '';
                    content += prefix +
                        `<video class="thread-reply-img" style="max-height: 450px; max-width: 300px; border-radius: 5px;" src="${resolveUrl(ele.link || '')}" data-remote-src="${ele.link || ''}" referrerpolicy="no-referrer" controls></video>`;
                }
                break;
            case 10: // voice：贴吧语音是 AMR 裸流，WebView2 无法直接播放；
                     // 元素的 link/src 为空，播放地址由 voice_md5 拼接（客户端同款规则）；
                     // 先输出无 src 的占位元素，挂载后由 amr-voice 解码注入 WAV
                if (blocked.audio) { content += '<span class="media-placeholder">[语音已禁用]</span>'; break; }
                if (!dismissMedia) {
                    const voiceMd5 = ele.voice_md5 || '';
                    const voiceUrl = ele.link || ele.voiceUrl || ele.src
                        || (voiceMd5 ? `https://tiebac.baidu.com/c/p/voice?voice_md5=${voiceMd5}&play_from=pb_voice_play` : '');
                    if (voiceUrl) content += `<audio class="voice-audio" controls preload="none" data-amr-src="${resolveUrl(voiceUrl)}" data-remote-src="${voiceUrl}"></audio>`;
                }
                break;
            case 18: // tag
            case 40: // search_words
                content += ele.text || '';
                break;
            default:
                content += `<div style='color: red'>Failed to parse: ${JSON.stringify(ele)}</div>`;
                break;
        }
    });
    flushImageRun();
    return sanitize(content);
}

export function formatNumber(num: number): string {
    if (num >= 100000000) {
        return (num / 100000000).toFixed(1) + '亿';
    } else if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toString();
}
