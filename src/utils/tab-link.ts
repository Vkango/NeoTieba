import type { TabItem } from '@/types/common';

/** 根据标签的 props 推导可分享链接；无法映射到贴吧页面时回退到 neotieba:// 协议。 */
export function getTabLink(tab: TabItem): string {
    const props = tab.props || {};
    let link = `neotieba://${(tab.component?.__name || 'container').toLowerCase()}`;
    if (props.tid) link = `https://tieba.baidu.com/p/${encodeURIComponent(String(props.tid))}`;
    else if (props.uid) link = `https://tieba.baidu.com/home/main?id=${encodeURIComponent(String(props.uid))}`;
    else if (props.barName) link = `https://tieba.baidu.com/f?kw=${encodeURIComponent(String(props.barName))}`;
    return link;
}
