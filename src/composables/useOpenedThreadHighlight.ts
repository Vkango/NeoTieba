import { inject } from 'vue';
import { useTabStore } from '@/stores/tabs';
import { generateUniqueId } from '@/composables/useTabNavigation';

/** 列表页组件注入自己所属标签的 key（ViewBarThreads / User / Favourite / My），
 *  用于判断"本页处于激活状态"——只打开 tab 而未激活时不参与高亮 */
export const PAGE_TAB_KEY = 'pageTabKey';

/**
 * 帖子在分屏中已打开的列表条目高亮：
 * 该帖的 ViewThread 标签存在、正显示在某个可见分屏中（isTabVisibleInPane），
 * 且当前列表页自身是所在分屏的激活页。
 */
export function useOpenedThreadHighlight() {
  const tabStore = useTabStore();
  const pageTabKey = inject<string | number | null>(PAGE_TAB_KEY, null);

  function isOpenedInPane(tid?: string | number | null): boolean {
    if (!tid || !pageTabKey) return false;
    // 本页未激活（只是后台 tab）时不高亮
    if (!tabStore.isTabKeyVisibleInPane(String(pageTabKey))) return false;
    const key = String(generateUniqueId(`ViewThread${tid}`));
    const tab = tabStore.tabs.find(t => t.key === key);
    return !!tab && tabStore.isTabVisibleInPane(tab);
  }

  return { isOpenedInPane };
}
