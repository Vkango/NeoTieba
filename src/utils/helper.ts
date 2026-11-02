import type { MediaBlocks } from './settings-policy';
import type { ContentElement } from '@/types';
import { sanitize } from './sanitizer';

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
    resolveUrl: (url: string) => string = (url: string) => url,
    replyTargetAvatar = ''
): string {
    let content = '';
    let targetAvatarUsed = false;
    elements.forEach((ele, index) => {
        switch (ele.type) {
            case 0: // text
                if (index === 0 && ele.text === '\n') {
                    break;
                }
                if (index !== 0 && elements[index - 1]?.type === 3) {
                    content += '<br>';
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
                if (blocked.images) { content += '<span class="media-placeholder">[配图已禁用]</span>'; break; }
                // image
                if (!dismissMedia) {
                    // console.log(ele);
                    // Tieba's big CDN source is the high-resolution display URL.
                    const imgSrc = ele.bigCdnSrc || ele.big_cdn_src || ele.bigSrc || ele.big_src
                        || ele.originSrc || ele.origin_src;
                    const fullSrc = imgSrc;
                    // data-remote-src keeps the ORIGINAL remote URL so that the
                    // archive fallback handler can swap it in when the archived
                    // copy is missing (e.g. avatars excluded from the archive).
                    content += (index !== 0 ? '<br>' : '') +
                        `<img class="thread-reply-img" style="max-height: 450px; max-width: 300px; border-radius: 5px;" src="${imgSrc ? resolveUrl(imgSrc) : imgSrc}" data-full-src="${fullSrc}" data-remote-src="${fullSrc}" referrerpolicy="no-referrer">`;
                }
                break;
            case 4: // at
                // "回复 XXX" 的目标用户前缀一个小头像，方便对上是回复谁（只装饰第一处）
                const prevEle = elements[index - 1];
                if (replyTargetAvatar && !blocked.avatars && !targetAvatarUsed
                    && prevEle?.type === 0 && String(prevEle.text ?? '').trim().endsWith('回复')) {
                    content += `<img class="at-avatar" src="${resolveUrl(replyTargetAvatar)}" referrerpolicy="no-referrer" alt="">`;
                    targetAvatarUsed = true;
                }
                content += `<button class="at-button" uid="${ele.uid}">${ele.text}</button>`;
                break;
            case 5:
                if (blocked.videos) { content += '<span class="media-placeholder">[视频已禁用]</span>'; break; }
                // video
                if (!dismissMedia) {
                    const prefix = (index !== 0 && elements[index - 1]?.type !== 0 && elements[index - 1]?.text !== '\n') ? '<br>' : '';
                    content += prefix +
                        `<video class="thread-reply-img" style="max-height: 450px; max-width: 300px; border-radius: 5px;" src="${resolveUrl(ele.link || '')}" data-remote-src="${ele.link || ''}" referrerpolicy="no-referrer" controls></video>`;
                }
                break;
            case 10: // voice
                content += blocked.audio ? '<span class="media-placeholder">[语音已禁用]</span>' : dismissMedia ? '' : `<audio src="${resolveUrl(ele.link || ele.voiceUrl || ele.src || '')}" data-remote-src="${ele.link || ele.voiceUrl || ele.src || ''}" controls preload="none"></audio>`;
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
