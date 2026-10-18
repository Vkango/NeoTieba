import type { TabItem } from '@/types/common';
import type { CollectionItemPayload, CollectionTargetType } from '@/stores/collection';

interface ComponentNamed {
  __name?: string;
}

const componentName = (tab: TabItem): string =>
  (tab.component as ComponentNamed | null)?.__name || '';

/** 标题尚未加载完成（如“正在加载”）时不允许加入集锦，保证与标签标题一致 */
const isTitleReady = (title: string): boolean =>
  !!title && title !== '正在加载' && title !== '贴子已被删除';

/**
 * 从标签推导集锦条目：
 * - ViewThread + props.tid  → thread（大头像=楼主头像 authorIcon，角标=吧头像 tab.icon）
 * - ViewBarThreads + props.barName → bar（仅吧头像）
 * - User + props.uid → user（仅用户头像）
 * 非这三类页面或标题未加载完成时返回 null。
 */
export function tabToCollectionPayload(tab: TabItem): CollectionItemPayload | null {
  const props = (tab.props || {}) as Record<string, unknown>;
  const name = componentName(tab);
  const title = tab.title || '';

  if (!isTitleReady(title)) return null;

  let type: CollectionTargetType;
  let target: string;
  if (name === 'ViewThread' && props.tid !== undefined) {
    type = 'thread';
    target = String(props.tid);
  } else if (name === 'ViewBarThreads' && props.barName !== undefined) {
    type = 'bar';
    target = String(props.barName);
  } else if (name === 'User' && props.uid !== undefined) {
    type = 'user';
    target = String(props.uid);
  } else {
    return null;
  }

  return {
    type,
    target,
    title,
    ...(type === 'thread'
      ? { userIcon: tab.authorIcon || '/assets/user.svg', barIcon: tab.icon || '/assets/apps.svg' }
      : type === 'bar'
        ? { barIcon: tab.icon || '/assets/apps.svg' }
        : { userIcon: tab.icon || '/assets/user.svg' })
  };
}

/** 当前标签对应的集锦条目 id（thread:{tid} / bar:{barName} / user:{uid}），用于头像栏高亮 */
export function activeTabCollectionId(tab: TabItem): string | null {
  const props = (tab.props || {}) as Record<string, unknown>;
  const name = componentName(tab);
  if (name === 'ViewThread' && props.tid !== undefined) return `thread:${String(props.tid)}`;
  if (name === 'ViewBarThreads' && props.barName !== undefined) return `bar:${String(props.barName)}`;
  if (name === 'User' && props.uid !== undefined) return `user:${String(props.uid)}`;
  return null;
}
