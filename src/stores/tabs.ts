import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import type { SplitDropZone, SplitGroup, TabItem } from '@/types/common';

let tabIdCounter = 0;
let groupIdCounter = 0;

const nextGroupId = (): string => `group-${++groupIdCounter}`;

/** 分屏分隔条宽度（与 App.vue 的 grid 列定义保持一致） */
export const SPLIT_DIVIDER_WIDTH = 6;
/** 分屏最小宽度（px） */
export const SPLIT_MIN_PANE_WIDTH = 160;

export const useTabStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([]);
  const activeKey = ref<string | null>(null);

  /**
   * 分屏组（顺序即左右布局顺序）。每个标签通过 groupId 归属唯一的组，
   * 各组标签在 position 排序中保持连续（所有移组操作用 splice 保证）。
   */
  const groups = ref<SplitGroup[]>([]);
  /** 主分屏：新标签始终在这里打开 */
  const mainGroupId = ref<string>('');
  /** 分屏宽度（px，最后一列固定为 1fr 吸收余量；空数组 = 等分） */
  const groupWidths = ref<number[]>([]);
  /** 标签拖拽悬停内容区时的分屏落点（swap = 与该屏当前页交换，create = 右缘新建分屏） */
  const splitDropZone = ref<SplitDropZone | null>(null);

  const draggingTabId = ref<number | null>(null);
  const dragOffsetX = ref(0);
  /** 标签拖拽悬停于左侧集锦头像栏时为 true（用于头像栏高亮，松手入集锦） */
  const dragOverCollection = ref(false);
  /** 正在拖拽标签（与集锦头像栏交互提示联动） */
  const collectionDragActive = ref(false);
  /** 当前被拖拽的标签是否可加入集锦（决定头像栏提示框/胶囊与禁止光标） */
  const collectionDragEligible = ref(false);

  const visibleTabs = computed(() => {
    return [...tabs.value].sort((a, b) => a.position - b.position);
  });

  const currentTab = computed(() => {
    return tabs.value.find(t => t.key === activeKey.value) || null;
  });

  /* ------------------------------- 分屏组 ------------------------------- */

  function ensureMainGroup(): void {
    if (groups.value.length === 0) {
      groups.value = [{ id: nextGroupId(), activeKey: null }];
      groupWidths.value = [];
    }
    if (!groups.value.some(g => g.id === mainGroupId.value)) {
      mainGroupId.value = groups.value[0].id;
    }
  }

  function groupOfTab(tab: TabItem): SplitGroup | undefined {
    return groups.value.find(g => g.id === tab.groupId) ?? groups.value[0];
  }

  function groupById(groupId: string | undefined | null): SplitGroup | undefined {
    if (!groupId) return undefined;
    return groups.value.find(g => g.id === groupId);
  }

  function groupTabs(groupId: string): TabItem[] {
    return tabs.value.filter(t => t.groupId === groupId).sort((a, b) => a.position - b.position);
  }

  /** 标签是否为所在分屏的当前显示页（App.vue 的 v-show、Container 的滚动恢复都以它为准）；
   *  分屏被隐藏时其页面一律不可见 */
  function isTabVisibleInPane(tab: TabItem): boolean {
    const group = groupOfTab(tab);
    return !!group && !group.hidden && group.activeKey === tab.key;
  }

  function isTabKeyVisibleInPane(key: string | number): boolean {
    const tab = tabs.value.find(t => t.key === String(key));
    return !!tab && isTabVisibleInPane(tab);
  }

  /** 组内某个成员被移走后，激活页回退到它在组内的相邻"可见"标签
   *  （欢迎页等 show:false 的背景标签不参与回退，避免接管分屏显示） */
  function fallbackGroupActiveKey(group: SplitGroup, removedTab: TabItem): void {
    if (group.activeKey !== removedTab.key) return;
    const remaining = groupTabs(group.id).filter(t => t.show !== false);
    if (remaining.length === 0) {
      group.activeKey = null;
      return;
    }
    const before = remaining.filter(t => t.position < removedTab.position);
    group.activeKey = (before[before.length - 1] ?? remaining[0]).key;
  }

  /** 清理空分屏组：至少保留 1 组；主分组被清空时身份移交给第一组。
   *  占用判定只看可见标签：欢迎页这类 show:false 的背景标签不占分组，
   *  否则只剩欢迎页的分组永远无法回收，分屏收不回单屏（欢迎页还会以
   *  grid-column:1/-1 叠在整个内容区上面）。 */
  function cleanupEmptyGroups(): void {
    if (groups.value.length <= 1) return;
    const occupied = new Set(
      tabs.value.filter(t => t.show !== false).map(t => t.groupId)
    );
    const kept = groups.value.filter(g => occupied.has(g.id));
    if (kept.length === groups.value.length) return;
    // 连一个可见标签都不剩：只保留第一个可见分组（实在没有就保留第一组），
    // 让欢迎页以单屏全宽展示
    groups.value = kept.length ? kept : [groups.value.find(g => !g.hidden) ?? groups.value[0]];
    if (!groups.value.some(g => g.id === mainGroupId.value)) {
      mainGroupId.value = groups.value[0].id;
    }
    groupWidths.value = [];
    // 焦点修复：当前激活页是背景标签或其分组刚被移除时，切到存活分屏的当前页
    const cur = currentTab.value;
    const curGroupAlive = !!cur && groups.value.some(g => g.id === cur.groupId);
    if (!cur || cur.show === false || !curGroupAlive) {
      const target = groups.value.find(g => !g.hidden)
        ?? groups.value[0];
      const key = target
        && (target.activeKey ?? groupTabs(target.id).find(t => t.show !== false)?.key);
      if (key) switchTab(key);
    }
  }

  /** 在锚点组右侧新建一个空分屏组 */
  function createGroupAfter(anchorGroupId: string | null): SplitGroup {
    ensureMainGroup();
    const group: SplitGroup = { id: nextGroupId(), activeKey: null };
    const anchorIdx = anchorGroupId ? groups.value.findIndex(g => g.id === anchorGroupId) : groups.value.length - 1;
    groups.value.splice(Math.max(anchorIdx, 0) + 1, 0, group);
    groupWidths.value = [];
    return group;
  }

  /** 底层移组：把标签搬到目标组（beforeKey 提供时插到该标签前，否则放到组末尾）；不动激活页与焦点 */
  function relocateTabToGroup(tabId: number | string, groupId: string, beforeKey?: string): boolean {
    const tab = tabs.value.find(t => t.id === tabId || t.key === String(tabId));
    if (!tab || !groups.value.some(g => g.id === groupId) || tab.groupId === groupId) return false;
    const fromGroup = groupOfTab(tab);
    const arr = tabs.value;
    const fromIdx = arr.findIndex(t => t.id === tab.id);
    if (fromIdx < 0) return false;
    arr.splice(fromIdx, 1);
    let insertAt = arr.length;
    if (beforeKey) {
      const beforeIdx = arr.findIndex(t => t.key === beforeKey && t.groupId === groupId);
      if (beforeIdx >= 0) insertAt = beforeIdx;
    } else {
      for (let k = arr.length - 1; k >= 0; k--) {
        if (arr[k].groupId === groupId) {
          insertAt = k + 1;
          break;
        }
      }
    }
    arr.splice(insertAt, 0, tab);
    tab.groupId = groupId;
    tabs.value.forEach((t, index) => {
      t.position = index;
    });
    if (fromGroup) fallbackGroupActiveKey(fromGroup, tab);
    cleanupEmptyGroups();
    return true;
  }

  /** 跨分屏移动标签：移入目标组（可指定插入位置）并在该屏显示、聚焦 */
  function moveTabToGroup(tabId: number | string, groupId: string, beforeKey?: string): void {
    if (!relocateTabToGroup(tabId, groupId, beforeKey)) return;
    const tab = tabs.value.find(t => t.id === tabId || t.key === String(tabId));
    const target = groupById(groupId);
    if (tab && target) {
      target.activeKey = tab.key;
      switchTab(tab.key);
    }
  }

  /** 右键/拖到右缘：在锚点组右侧新建分屏并移入该标签 */
  function splitTabToNewGroup(tabId: number | string, anchorGroupId?: string): void {
    const tab = tabs.value.find(t => t.id === tabId || t.key === String(tabId));
    if (!tab) return;
    ensureMainGroup();
    const group = createGroupAfter(anchorGroupId ?? tab.groupId ?? mainGroupId.value);
    relocateTabToGroup(tab.id, group.id);
    group.activeKey = tab.key;
    switchTab(tab.key);
  }

  function setMainGroup(groupId: string): void {
    if (groups.value.some(g => g.id === groupId)) {
      mainGroupId.value = groupId;
    }
  }

  /** 关闭整个分屏：可关闭标签一并关闭，不可关闭的迁回主分组 */
  function closeGroup(groupId: string): void {
    if (groups.value.length <= 1) return;
    const group = groupById(groupId);
    if (!group) return;
    const doomed = groupTabs(groupId);
    const ids = doomed.filter(t => t.closable !== false).map(t => t.id);
    const pinned = doomed.filter(t => t.closable === false);
    const nextMainCandidate = groups.value.find(g => g.id !== groupId)
      ?? groups.value.find(g => g.id !== mainGroupId.value);
    const fallbackKey = nextMainCandidate
      ? (nextMainCandidate.activeKey ?? groupTabs(nextMainCandidate.id)[0]?.key ?? null)
      : null;
    pinned.forEach(t => relocateTabToGroup(t.id, mainGroupId.value));
    removeTabsByIds(ids, switchKeyIfActiveRemoved(ids, fallbackKey));
    cleanupEmptyGroups();
  }

  /** 聚焦某个分屏（点击分屏内容/标题条时调用），键盘与导航高亮跟随 */
  function focusGroup(groupId: string): void {
    const group = groupById(groupId);
    if (!group) return;
    const key = group.activeKey ?? groupTabs(groupId)[0]?.key;
    if (key && key !== activeKey.value) switchTab(key);
  }

  function setGroupWidths(widths: number[]): void {
    groupWidths.value = widths;
  }

  /* --------------------------- 分屏隐藏 / 相邻交换 --------------------------- */

  /** 批量隐藏分屏；焦点落在被隐藏分屏时回落到第一个可见分屏。
   *  目标集合包含全部可见分屏时拒绝执行（屏幕上至少要留一个页面）。 */
  function hideGroupsByIds(ids: string[]): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const visibleGroups = groups.value.filter(g => !g.hidden);
    if (visibleGroups.every(g => idSet.has(g.id))) return;
    let changed = false;
    groups.value.forEach(g => {
      if (idSet.has(g.id) && !g.hidden) {
        g.hidden = true;
        changed = true;
      }
    });
    if (changed && currentTab.value) {
      const g = groupOfTab(currentTab.value);
      if (g?.hidden) {
        const firstVisible = groups.value.find(x => !x.hidden);
        if (firstVisible?.activeKey) switchTab(firstVisible.activeKey);
      }
    }
  }

  /** 隐藏分屏；不做限制（恢复入口悬浮在相邻分屏顶角，随时可恢复）。 */
  function setHidden(groupId: string, hidden: boolean): void {
    if (!hidden) {
      const group = groupById(groupId);
      if (group) group.hidden = false;
      return;
    }
    hideGroupsByIds([groupId]);
  }

  /** 隐藏锚点分组左侧的全部分组 */
  function hideGroupsLeftOf(groupId: string): void {
    const idx = groups.value.findIndex(g => g.id === groupId);
    if (idx > 0) hideGroupsByIds(groups.value.slice(0, idx).map(g => g.id));
  }

  /** 隐藏锚点分组右侧的全部分组 */
  function hideGroupsRightOf(groupId: string): void {
    const idx = groups.value.findIndex(g => g.id === groupId);
    if (idx >= 0 && idx < groups.value.length - 1) {
      hideGroupsByIds(groups.value.slice(idx + 1).map(g => g.id));
    }
  }

  /** 隐藏锚点分组以外的全部分组 */
  function hideOtherGroups(groupId: string): void {
    hideGroupsByIds(groups.value.filter(g => g.id !== groupId).map(g => g.id));
  }

  /** 交换相邻两个分屏的布局位置：整组互换（各自标签、激活页、宽度跟着分组走）；
   *  有分屏隐藏时禁止 */
  function swapAdjacentGroups(leftGroupId: string, rightGroupId: string): void {
    const li = groups.value.findIndex(g => g.id === leftGroupId);
    const ri = groups.value.findIndex(g => g.id === rightGroupId);
    if (li < 0 || ri !== li + 1) return;
    const left = groups.value[li];
    const right = groups.value[ri];
    if (left.hidden || right.hidden || groups.value.some(g => g.hidden)) return;
    groups.value[li] = right;
    groups.value[ri] = left;
    // 宽度权重跟随分组互换，保持两屏各自的宽度
    if (groupWidths.value.length === groups.value.length) {
      const w = groupWidths.value[li];
      groupWidths.value[li] = groupWidths.value[ri];
      groupWidths.value[ri] = w;
    }
  }

  /** 新标签打开位置：auto = ViewThread 自动开到触发页以外最近的分屏（优先右侧），
   *  其余页面在当前分屏打开；main = 固定主分屏。右键标签可切换。 */
  const splitOpenMode = ref<'auto' | 'main'>('auto');

  function setSplitOpenMode(mode: 'auto' | 'main'): void {
    splitOpenMode.value = mode;
  }

  /** auto 模式下确定新标签的落组：ViewThread 优先开到触发页以外最近的"可见"分屏
   *  （距离相同优先右侧）；其余页面在当前分屏打开。当前分屏已隐藏时退到第一个
   *  可见分屏，实在没有可见分屏才落回隐藏分屏。 */
  function resolveAutoGroupId(component: TabItem['component']): string {
    const current = currentTab.value;
    const sourceGroup = current ? groupOfTab(current) : undefined;
    const componentName = (component as { __name?: string })?.__name;
    if (componentName === 'ViewThread' && groups.value.some(g => !g.hidden)) {
      const sourceIdx = groups.value.findIndex(g => g.id === sourceGroup?.id);
      let bestIdx = -1;
      let bestDist = Infinity;
      groups.value.forEach((g, i) => {
        if (g.hidden) return;
        if (sourceGroup && g.id === sourceGroup.id) return;
        if (sourceIdx < 0) {
          if (bestIdx < 0) bestIdx = i;
          return;
        }
        // 距离相同优先右侧
        const dist = Math.abs(i - sourceIdx) - (i > sourceIdx ? 0.5 : 0);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) return groups.value[bestIdx].id;
    }
    if (sourceGroup && !sourceGroup.hidden) return sourceGroup.id;
    const firstVisible = groups.value.find(g => !g.hidden);
    return firstVisible?.id ?? sourceGroup?.id ?? mainGroupId.value;
  }

  /* ------------------------------- 标签基础操作 ------------------------------- */

  function addTab(config: Partial<TabItem> & { key: string }) {
    ensureMainGroup();
    const id = ++tabIdCounter;
    const targetGroupId = splitOpenMode.value === 'main'
      ? mainGroupId.value
      : resolveAutoGroupId(config.component);
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
      if: true,
      groupId: targetGroupId
    } as TabItem;

    const existing = tabs.value.find(t => t.key === config.key);
    if (existing) {
      switchTab(existing.key);
      return id;
    }

    // 插到目标分组 run 的末尾，保证各组标签在 position 序中连续
    let insertAt = tabs.value.length;
    for (let k = tabs.value.length - 1; k >= 0; k--) {
      if (tabs.value[k].groupId === targetGroupId) {
        insertAt = k + 1;
        break;
      }
    }
    tabs.value.splice(insertAt, 0, newTab);
    tabs.value.forEach((tab, index) => {
      tab.position = index;
    });
    switchTab(config.key);
    return id;
  }

  function switchTab(key: string | number) {
    const keyStr = String(key);
    tabs.value.forEach(tab => {
      tab.selected = tab.key === keyStr;
    });
    activeKey.value = keyStr;
    const tab = tabs.value.find(t => t.key === keyStr);
    const group = tab ? groupOfTab(tab) : undefined;
    if (group) {
      group.activeKey = keyStr;
    }
  }

  function removeTab(id: number | string) {
    const tab = tabs.value.find(t => t.id === id || t.key === String(id));
    if (!tab) return;
    if (tab.closable === false) return;

    const wasActive = tab.selected || tab.key === activeKey.value;
    const group = groupOfTab(tab);
    const idx = tabs.value.findIndex(t => t.id === tab.id);

    tabs.value = tabs.value.filter(t => t.id !== tab.id);

    tabs.value.forEach((t, index) => {
      t.position = index;
    });

    if (group) fallbackGroupActiveKey(group, tab);

    if (wasActive) {
      if (group && groups.value.includes(group) && group.activeKey) {
        switchTab(group.activeKey);
      } else if (tabs.value.length > 0) {
        const nextIdx = Math.min(idx, tabs.value.length - 1);
        switchTab(tabs.value[nextIdx].key);
      } else {
        activeKey.value = null;
      }
    }

    cleanupEmptyGroups();
  }

  function updateTabMeta(key: string | number, meta: Partial<Pick<TabItem, 'title' | 'icon' | 'icon_invert' | 'renderKey' | 'authorIcon'>>) {
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
   *  隐藏标签（如欢迎页）与 closable === false 的标签始终保留。
   *  scopeGroupId 提供时只在同一分屏组内选取（组内位置序与全局 position 序一致）。 */
  function closeableTabIdsBetween(predicate: (tab: TabItem, index: number, targetIndex: number) => boolean, targetId: number | string, scopeGroupId?: string): number[] {
    const ordered = visibleTabs.value;
    const targetIndex = ordered.findIndex(t => t.id === targetId || t.key === String(targetId));
    if (targetIndex < 0) return [];
    return ordered
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab, index }) => tab.id !== targetId && tab.show !== false && tab.closable !== false
        && (!scopeGroupId || tab.groupId === scopeGroupId)
        && predicate(tab, index, targetIndex))
      .map(({ tab }) => tab.id);
  }

  function removeTabsByIds(ids: number[], switchToKey: string | null): void {
    if (!ids.length) return;
    const removed = new Set(ids);
    tabs.value = tabs.value.filter(t => !removed.has(t.id));
    tabs.value.forEach((t, index) => {
      t.position = index;
    });
    groups.value.forEach(group => {
      if (group.activeKey && !tabs.value.some(t => t.key === group.activeKey)) {
        const remaining = groupTabs(group.id);
        const realRemaining = remaining.filter(t => t.show !== false);
        group.activeKey = (realRemaining[0] ?? remaining[0])?.key ?? null;
      }
    });
    if (switchToKey !== null) switchTab(switchToKey);
    cleanupEmptyGroups();
  }

  /** 当前激活标签将被关闭时，批量关闭后回落到目标标签 */
  function switchKeyIfActiveRemoved(ids: number[], fallbackKey: string | null): string | null {
    return currentTab.value && ids.includes(currentTab.value.id) ? fallbackKey : null;
  }

  function closeOtherTabs(id: number | string): void {
    const target = getTab(id);
    if (!target) return;
    const ids = closeableTabIdsBetween(() => true, target.id);
    removeTabsByIds(ids, switchKeyIfActiveRemoved(ids, target.key));
  }

  /** 关闭左侧标签：只关闭同一分屏组内位于目标左侧的标签 */
  function closeLeftTabs(id: number | string): void {
    const target = getTab(id);
    if (!target) return;
    const ids = closeableTabIdsBetween((_tab, index, targetIndex) => index < targetIndex, target.id, target.groupId);
    removeTabsByIds(ids, switchKeyIfActiveRemoved(ids, target.key));
  }

  /** 关闭右侧标签：只关闭同一分屏组内位于目标右侧的标签 */
  function closeRightTabs(id: number | string): void {
    const target = getTab(id);
    if (!target) return;
    const ids = closeableTabIdsBetween((_tab, index, targetIndex) => index > targetIndex, target.id, target.groupId);
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
    groups,
    mainGroupId,
    groupWidths,
    splitDropZone,
    splitOpenMode,
    setSplitOpenMode,
    draggingTabId,
    dragOffsetX,
    dragOverCollection,
    collectionDragActive,
    collectionDragEligible,
    ensureMainGroup,
    groupOfTab,
    groupById,
    groupTabs,
    isTabVisibleInPane,
    isTabKeyVisibleInPane,
    createGroupAfter,
    relocateTabToGroup,
    moveTabToGroup,
    splitTabToNewGroup,
    setMainGroup,
    closeGroup,
    focusGroup,
    setGroupWidths,
    setHidden,
    hideGroupsLeftOf,
    hideGroupsRightOf,
    hideOtherGroups,
    swapAdjacentGroups,
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
