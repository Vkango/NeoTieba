import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import type { TabItem } from '@/types/common';

let tabIdCounter = 0;

export const useTabStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([]);
  const activeKey = ref<string | null>(null);

  const draggingTabId = ref<number | null>(null);
  const dragOffsetX = ref(0);

  const visibleTabs = computed(() => {
    return [...tabs.value].sort((a, b) => a.position - b.position);
  });

  const currentTab = computed(() => {
    return tabs.value.find(t => t.key === activeKey.value) || null;
  });

  function addTab(config: Partial<TabItem> & { key: string }) {
    const id = ++tabIdCounter;
    const newTab: TabItem = {
      id,
      key: config.key,
      renderKey: config.key,
      selected: true,
      icon: config.icon || '',
      title: config.title || '',
      component: config.component ? markRaw(config.component) : null,
      props: config.props || {},
      icon_invert: config.icon_invert ?? false,
      show: config.show ?? true,
      closable: config.closable ?? true,
      position: tabs.value.length,
      desc: config.title || '',
      content: '',
      isClosing: false,
      origin: config.origin,
      if: true
    } as TabItem;

    const existing = tabs.value.find(t => t.key === config.key);
    if (existing) {
      switchTab(existing.key);
      return id;
    }

    tabs.value.push(newTab);
    switchTab(config.key);
    return id;
  }

  function switchTab(key: string | number) {
    tabs.value.forEach(tab => {
      tab.selected = tab.key === key;
    });
    activeKey.value = String(key);
  }

  function removeTab(id: number | string) {
    const tab = tabs.value.find(t => t.id === id || t.key === String(id));
    if (!tab) return;
    if (tab.closable === false) return;

    const wasActive = tab.selected;
    const idx = tabs.value.findIndex(t => t.id === tab.id);

    tabs.value = tabs.value.filter(t => t.id !== tab.id);

    tabs.value.forEach((t, index) => {
      t.position = index;
    });

    if (wasActive && tabs.value.length > 0) {
      const nextIdx = Math.min(idx, tabs.value.length - 1);
      switchTab(tabs.value[nextIdx].key);
    } else if (tabs.value.length === 0) {
      activeKey.value = null;
    }

  }

  function updateTabMeta(key: string | number, meta: Partial<Pick<TabItem, 'title' | 'icon' | 'icon_invert' | 'renderKey'>>) {
    const tab = tabs.value.find(t => t.key === String(key));
    if (tab) {
      Object.assign(tab, meta);
    }
  }

  function refreshTab(key: string | number) {
    const tab = tabs.value.find(t => t.key === key);
    if (tab) {
      tab.renderKey = `${key}-${Date.now()}`;
    }
  }

  function getTab(id: number | string) {
    return tabs.value.find(t => t.id === id || t.key === id);
  }

  function setTab(id: number | string, partial: Partial<TabItem>) {
    const tab = getTab(id);
    if (tab) Object.assign(tab, partial);
  }

  function reorderTabs(fromId: number, toId: number) {
    const fromIdx = tabs.value.findIndex(t => t.id === fromId);
    const toIdx = tabs.value.findIndex(t => t.id === toId);

    if (fromIdx < 0 || toIdx < 0) return;

    const [movedTab] = tabs.value.splice(fromIdx, 1);
    tabs.value.splice(toIdx, 0, movedTab);

    tabs.value.forEach((tab, idx) => {
      tab.position = idx;
    });
  }

  /** 批量关闭的目标选取：仅用户可见且可关闭的标签会被关闭（始终排除目标标签本身）；
   *  隐藏标签（如欢迎页）与 closable === false 的标签始终保留。 */
  function closeableTabIdsBetween(predicate: (tab: TabItem, index: number, targetIndex: number) => boolean, targetId: number | string): number[] {
    const ordered = visibleTabs.value;
    const targetIndex = ordered.findIndex(t => t.id === targetId || t.key === String(targetId));
    if (targetIndex < 0) return [];
    return ordered
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab, index }) => tab.id !== targetId && tab.show !== false && tab.closable !== false && predicate(tab, index, targetIndex))
      .map(({ tab }) => tab.id);
  }

  function removeTabsByIds(ids: number[], switchToKey: string | null): void {
    if (!ids.length) return;
    const removed = new Set(ids);
    tabs.value = tabs.value.filter(t => !removed.has(t.id));
    tabs.value.forEach((t, index) => {
      t.position = index;
    });
    if (switchToKey !== null) switchTab(switchToKey);
  }

  /** 当前激活标签将被关闭时，批量关闭后回落到目标标签 */
  function switchKeyIfActiveRemoved(ids: number[], fallbackKey: string): string | null {
    return currentTab.value && ids.includes(currentTab.value.id) ? fallbackKey : null;
  }

  function closeOtherTabs(id: number | string): void {
    const target = getTab(id);
    if (!target) return;
    const ids = closeableTabIdsBetween(() => true, target.id);
    removeTabsByIds(ids, switchKeyIfActiveRemoved(ids, target.key));
  }

  function closeLeftTabs(id: number | string): void {
    const target = getTab(id);
    if (!target) return;
    const ids = closeableTabIdsBetween((_tab, index, targetIndex) => index < targetIndex, target.id);
    removeTabsByIds(ids, switchKeyIfActiveRemoved(ids, target.key));
  }

  function closeRightTabs(id: number | string): void {
    const target = getTab(id);
    if (!target) return;
    const ids = closeableTabIdsBetween((_tab, index, targetIndex) => index > targetIndex, target.id);
    removeTabsByIds(ids, switchKeyIfActiveRemoved(ids, target.key));
  }

  function startDrag(tabId: number) {
    draggingTabId.value = tabId;
  }

  function updateDragOffset(offsetX: number) {
    dragOffsetX.value = offsetX;
  }

  function endDrag() {
    draggingTabId.value = null;
    dragOffsetX.value = 0;
  }

  return {
    tabs,
    visibleTabs,
    activeKey,
    currentTab,
    draggingTabId,
    dragOffsetX,
    addTab,
    switchTab,
    removeTab,
    updateTabMeta,
    refreshTab,
    getTab,
    setTab,
    reorderTabs,
    closeOtherTabs,
    closeLeftTabs,
    closeRightTabs,
    startDrag,
    updateDragOffset,
    endDrag
  };
});
