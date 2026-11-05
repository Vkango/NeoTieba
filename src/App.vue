<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, provide, nextTick, computed, type Ref, type Component, watch } from 'vue';
import type { NotificationComponent } from '@/components';
import type { TabItem } from '@/types/common';
import type { OpenSearchInBarPayload } from '@/types/navigation';
import FollowBar from './pages/user/FollowBar.vue';
import ViewBarThreads from './pages/threads/ViewBarThreads.vue';
import ViewThread from './pages/threads/ViewThread.vue';
import My from './pages/user/My.vue';
import User from './pages/user/User.vue';
import Search from './pages/search/Search.vue';
import Welcome from './pages/Welcome.vue';
import Setting from './pages/Setting.vue';
import { errorService, type ErrorReport as ErrorReportModel } from '@/core/error-service';
import Tip from '@/components/notification/Tip.vue';
import ErrorReportCard from '@/components/notification/ErrorReport.vue';
import Debug from './pages/Debug.vue';
import Home from './pages/Home.vue';
import { clipboardService } from '@/services/clipboard-service';
import { URLParser } from '@/services/url-parser';
import { useApiStore, useHistoryStore, useSettingsStore } from '@/stores';
import { SPLIT_DIVIDER_WIDTH, SPLIT_MIN_PANE_WIDTH, useTabStore } from '@/stores/tabs';
import { useCollectionStore } from '@/stores/collection';
import { useTabNavigation } from '@/composables/useTabNavigation';
import { useHotkeys } from '@/composables/useHotkeys';
import { useSplitDragOverlay } from '@/composables/useSplitDragOverlay';
import { hotkeyState } from '@/core/hotkeys';
import ExternalLinkDialog from '@/components/common/ExternalLinkDialog.vue';
import ImageHoverPreview from '@/components/common/ImageHoverPreview.vue';
import ContextMenu from '@/components/ui/ContextMenu.vue';
import CollectionRail from '@/components/layout/CollectionRail.vue';
import CollectionDrawer from '@/components/layout/CollectionDrawer.vue';
import CollectionDragOverlay from '@/components/layout/CollectionDragOverlay.vue';

interface NavItem {
  id: number;
  icon: string;
  title: string;
  selected: boolean;
}

interface TabInfo {
  key: string | number;
  title: string;
  icon: string;
  icon_invert?: boolean;
  authorIcon?: string;
}

interface ToastComponent {
  showToast: (title: string, duration: number) => void;
}

interface TitleBarComponent {
  updateAvatar: () => Promise<void>;
}

interface JumpResult {
  onClick: () => void;
  title: string;
  description: string;
}

const notificationComponent: Ref<NotificationComponent | null> = ref<NotificationComponent | null>(null);
const isNotificationReady: Ref<boolean> = ref<boolean>(false);
const imageViewerVisibility: Ref<boolean> = ref<boolean>(false);
const imageViewerSrc: Ref<string> = ref<string>('');
const ToastComponent: Ref<any> = ref<any>(null);
const activeTab: Ref<any> = ref<any>({});
const showTabList: Ref<boolean> = ref<boolean>(false);
const showNotificationBox: Ref<boolean> = ref<boolean>(false);
const titleBarRef: Ref<TitleBarComponent | null> = ref<TitleBarComponent | null>(null);
const processedUrls: Ref<string[]> = ref<string[]>([]);

const naviListItem: Ref<NavItem[]> = ref<NavItem[]>([]);
if (!import.meta.env.PROD) {
  naviListItem.value = [
    { id: 0, icon: 'search', title: '搜索', selected: false },
    { id: 1, icon: 'home', title: '首页', selected: false },
    { id: 2, icon: 'apps', title: '贴吧', selected: false },
    { id: 3, icon: 'person', title: '我的', selected: false },
    { id: 4, icon: 'settings', title: '设置', selected: false },
    { id: 5, icon: 'bug_report', title: '调试', selected: false }
  ];
} else {
  naviListItem.value = [
    { id: 0, icon: 'search', title: '搜索', selected: false },
    { id: 1, icon: 'home', title: '首页', selected: false },
    { id: 2, icon: 'apps', title: '贴吧', selected: false },
    { id: 3, icon: 'person', title: '我的', selected: false },
    { id: 4, icon: 'settings', title: '设置', selected: false },
  ];
}

const apiStore = useApiStore();
const Api = apiStore.getApi();
const tabStore = useTabStore();
const historyStore = useHistoryStore();
const settingsStore = useSettingsStore();
const collectionStore = useCollectionStore();
const splitOverlay = useSplitDragOverlay();

const containerStyle = computed(() => {
  if (settingsStore.wallpaperEffect !== 'image' || !settingsStore.wallpaperUrl) {
    return {} as Record<string, string>;
  }
  return {
    'background-image': `url(${settingsStore.wallpaperUrl})`,
    'background-size': 'cover',
    'background-position': 'center',
  } as Record<string, string>;
});

const overlayStyle = computed(() => {
  const base: Record<string, string> = {
    transition: 'all 0.3s ease',
  };

  const accent = Math.max(0, Math.min(100, settingsStore.wallpaperAccent));
  const overlayAlpha = 0.85 * (1 - accent / 100);

  base.background = `rgba(var(--wallpaper-overlay), ${overlayAlpha.toFixed(3)})`;

  if (settingsStore.wallpaperEffect === 'image') {
    const blur = Math.max(0, Math.min(200, settingsStore.wallpaperBlur));
    if (blur > 0) {
      base.backdropFilter = `blur(${blur}px)`;
      base.webkitBackdropFilter = `blur(${blur}px)`;
    }
  }

  return base;
});

const solidBackgroundStyle = computed(() =>
  settingsStore.wallpaperEffect === 'solid'
    ? { 'background-color': settingsStore.wallpaperSolidColor } as Record<string, string>
    : {} as Record<string, string>
);
const {
  openThread,
  openBar,
  openUser,
  openSearchInBar,
  openFavourite,
  openHistory,
  openLibrary
} = useTabNavigation();

/* ------------------------------- 分屏布局 ------------------------------- */

const containerRef = ref<HTMLElement | null>(null);

/**
 * 分屏动画的渲染插槽层：grid-template-columns 只在列数不变且各列类型兼容时
 * 才能插值，所以增删分组（列数变化）不能直接动画——
 * - 进场分组首帧以 0 宽列占位（列数变化为一次不可插值的跳变，但视觉与旧布局一致），
 *   下一帧再给真实宽度，浏览器即可在两个兼容模板间插值出展开动画；
 * - 退场分组从 store 删除后仍按原位置保留一个 0 宽"幽灵列"，邻居列在原位
 *   展宽收窄，动画结束再从渲染列表剔除（此时各列已为 0 宽，剔除不可见）。
 */
interface ExitingSlot { id: string; index: number }
const exitingSlots = ref<ExitingSlot[]>([]);
const enteringSlotIds = ref<string[]>([]);

watch(
  () => tabStore.groups.map(g => g.id),
  (ids, oldIds) => {
    const prev = oldIds ?? [];
    if (!prev.length) return; // 应用启动首建分组不做动画
    const added = ids.filter(id => !prev.includes(id));
    const removed = prev.filter(id => !ids.includes(id));
    if (added.length) {
      enteringSlotIds.value = [...enteringSlotIds.value, ...added];
      // 双 rAF 保证首帧 0 宽模板先绘制一帧再展开；页面后台时 rAF 会被节流，
      // 追加一个 setTimeout 兜底（操作幂等，重复清理无害），状态最终一致
      const clearEntering = () => {
        enteringSlotIds.value = enteringSlotIds.value.filter(id => !added.includes(id));
      };
      requestAnimationFrame(() => requestAnimationFrame(clearEntering));
      setTimeout(clearEntering, 150);
    }
    if (removed.length) {
      exitingSlots.value = [
        ...exitingSlots.value,
        ...removed.map(id => ({ id, index: prev.indexOf(id) }))
      ];
      narrowGroupIds.value = new Set([...narrowGroupIds.value].filter(id => !removed.includes(id)));
      setTimeout(() => {
        exitingSlots.value = exitingSlots.value.filter(ex => !removed.includes(ex.id));
      }, 360);
    }
  }
);

/* --------------------- 窄分屏：标签收成书签 --------------------- */

/** 进入窄模式的分屏（标签条退化为当前页只读展示，其余标签收成左缘书签） */
const narrowGroupIds = ref<Set<string>>(new Set());

function onPaneNarrowChange(groupId: string, narrow: boolean): void {
  const next = new Set(narrowGroupIds.value);
  if (narrow) next.add(groupId);
  else next.delete(groupId);
  narrowGroupIds.value = next;
}

/** 窄分屏的左右方向书签：当前页在组内的上一/下一个标签（无则该侧不显示） */
function paneNavChips(groupId: string): Array<{ side: 'left' | 'right'; tab: TabItem }> {
  if (!narrowGroupIds.value.has(groupId)) return [];
  const group = tabStore.groupById(groupId);
  if (!group || group.hidden) return [];
  const tabs = tabStore.groupTabs(groupId).filter(tab => tab.show !== false);
  const idx = tabs.findIndex(tab => tab.key === group.activeKey);
  if (idx < 0) return [];
  const result: Array<{ side: 'left' | 'right'; tab: TabItem }> = [];
  if (idx > 0) result.push({ side: 'left', tab: tabs[idx - 1] });
  if (idx < tabs.length - 1) result.push({ side: 'right', tab: tabs[idx + 1] });
  return result;
}

/** 方向书签定位：贴该分屏对应侧的顶角（与隐藏分屏书签同一套样式） */
function paneNavChipStyle(groupId: string, side: 'left' | 'right'): Record<string, string> {
  const si = Math.max(slotIndexOf(groupId), 0);
  return {
    gridColumn: String(si * 2 + 1),
    gridRow: '1',
    justifySelf: side === 'left' ? 'start' : 'end',
    marginTop: '10px',
    borderRadius: side === 'left' ? '0 20px 20px 0' : '20px 0 0 20px'
  };
}

interface RenderSlot { id: string; ghost: boolean; collapsed: boolean }

const renderSlots = computed<RenderSlot[]>(() => {
  const slots: RenderSlot[] = tabStore.groups.map(g => ({
    id: g.id,
    ghost: false,
    collapsed: !!g.hidden || enteringSlotIds.value.includes(g.id)
  }));
  for (const ex of exitingSlots.value) {
    slots.splice(Math.min(ex.index, slots.length), 0, { id: ex.id, ghost: true, collapsed: true });
  }
  return slots;
});

/** 分组在渲染列表（含幽灵列）中的下标：所有 grid 列号都以它为准，
 *  幽灵列插在中间时不能直接用 store 下标 */
function slotIndexOf(groupId: string): number {
  return renderSlots.value.findIndex(s => s.id === groupId);
}

function storeIndexOf(groupId: string): number {
  return tabStore.groups.findIndex(g => g.id === groupId);
}

/** si 之后是否还有可见分屏（决定分隔条是否"功能可用"） */
function slotVisibleAfter(si: number): boolean {
  return renderSlots.value.some((s, j) => j > si && !s.collapsed);
}

/** si 之后最近的可见分屏插槽，无则 null */
function nearestVisibleSlotAfter(si: number): RenderSlot | null {
  for (let j = si + 1; j < renderSlots.value.length; j++) {
    if (!renderSlots.value[j].collapsed) return renderSlots.value[j];
  }
  return null;
}

/** gi 之后最近的可见分屏下标（store 下标，拖宽调权用），无则 -1 */
function nearestVisibleAfter(gi: number): number {
  for (let i = gi + 1; i < tabStore.groups.length; i++) {
    if (!tabStore.groups[i].hidden) return i;
  }
  return -1;
}

/**
 * Grid 列模板：分屏列与分隔列交错。列宽用 fr 表达（调宽时保持总权重不变，
 * fr 归一化后与 px 目标值一致），这样内容区与顶部标签条共用同一模板、
 * 比例始终对齐（标签条区域更窄，按相同占比分配）。
 * 隐藏/进场/退场的分屏列都是 minmax(0px, 0fr)（而非 0px）：
 * 与可见列 minmax(160px, Nfr) 类型兼容，列宽变化才能插值出动画；
 * 两个可见分屏之间夹着不可见分屏时分隔条仍然有效（6px）。
 */
const gridColumnsStyle = computed(() => {
  const slots = renderSlots.value;
  if (slots.length <= 1) return {};
  const widths = tabStore.groupWidths;
  const useWeights = widths.length === tabStore.groups.length;
  const cols: string[] = [];
  slots.forEach((slot, i) => {
    if (slot.collapsed) {
      cols.push('minmax(0px, 0fr)');
    } else {
      const li = storeIndexOf(slot.id);
      cols.push(useWeights && li >= 0
        ? `minmax(${SPLIT_MIN_PANE_WIDTH}px, ${Math.max(widths[li], SPLIT_MIN_PANE_WIDTH)}fr)`
        : `minmax(${SPLIT_MIN_PANE_WIDTH}px, 1fr)`);
    }
    if (i < slots.length - 1) {
      const functional = !slot.collapsed && slotVisibleAfter(i);
      cols.push(functional ? `${SPLIT_DIVIDER_WIDTH}px` : '0px');
    }
  });
  return { gridTemplateColumns: cols.join(' ') };
});

function tabPaneStyle(tab: TabItem): Record<string, string> {
  // Welcome 是欢迎页而非普通分屏页：横跨整个内容区展示，不落入任何分屏列
  const componentName = (tab.component as { __name?: string })?.__name;
  if (componentName === 'Welcome') {
    return { gridColumn: '1 / -1', zIndex: '1' };
  }
  const group = tabStore.groupOfTab(tab);
  const si = group ? slotIndexOf(group.id) : 0;
  return { gridColumn: String(Math.max(si, 0) * 2 + 1) };
}

function dividerTrackStyle(si: number): Record<string, string> {
  return { gridColumn: String(si * 2 + 2) };
}

/** 点击某个分屏（内容区）时聚焦它，键盘与左侧导航高亮跟随 */
function focusGroupPane(groupId: string | undefined): void {
  if (groupId) tabStore.focusGroup(groupId);
}

/* --------------------------- 分屏隐藏 / 相邻交换 --------------------------- */

const anyHiddenGroups = computed(() => tabStore.groups.some(g => g.hidden));

/** 分组当前页的图标（恢复书签展示用） */
function groupIconUrl(group: { activeKey: string | null }): string {
  const tab = group.activeKey ? tabStore.tabs.find(t => t.key === group.activeKey) : undefined;
  return resolveIconUrl(tab?.icon || '');
}

function resolveIconUrl(icon: string): string {
  if (!icon) return '';
  if (icon.startsWith('http') || icon.startsWith('data:') || icon.startsWith('/')) return icon;
  try {
    return new URL(icon, import.meta.url).href;
  } catch {
    return icon;
  }
}

/** 是否为最后一个可见分屏的标签条槽位（需要在标题栏公摊前截断） */
function isLastVisibleSlot(si: number): boolean {
  if (renderSlots.value[si]?.collapsed) return false;
  return !renderSlots.value.some((s, j) => j > si && !s.collapsed);
}

/** 隐藏分屏恢复书签的锚点布局：最近的可见邻屏、靠近隐藏侧的顶角 */
function hiddenChipLayout(group: { id: string; hidden?: boolean }): {
  anchorGi: number; useLeft: boolean; stackIndex: number; isolated: boolean;
} {
  const gi = tabStore.groups.findIndex(g => g.id === group.id);
  let leftGi = -1;
  let rightGi = -1;
  for (let i = gi - 1; i >= 0; i--) {
    if (!tabStore.groups[i].hidden) { leftGi = i; break; }
  }
  for (let i = gi + 1; i < tabStore.groups.length; i++) {
    if (!tabStore.groups[i].hidden) { rightGi = i; break; }
  }
  if (leftGi < 0 && rightGi < 0) return { anchorGi: -1, useLeft: false, stackIndex: 0, isolated: true };
  // 距离相同取左侧：书签贴在邻屏朝向隐藏侧的顶角
  const useLeft = leftGi >= 0 && (rightGi < 0 || (gi - leftGi) <= (rightGi - gi));
  const anchorGi = useLeft ? leftGi : rightGi;
  // 同一角按拓扑顺序堆叠：同一段隐藏区间内，数组靠前的胶囊在上
  const stackIndex = useLeft ? gi - leftGi - 1 : gi;
  return { anchorGi, useLeft, stackIndex, isolated: false };
}

/** 贴右缘的书签（锚定左侧邻屏）内容行反转：图标固定在贴边一侧，标题向屏内展开 */
function hiddenChipFlips(group: { id: string; hidden?: boolean }): boolean {
  return hiddenChipLayout(group).useLeft;
}

function hiddenChipStyle(group: { id: string; hidden?: boolean }): Record<string, string> {
  const layout = hiddenChipLayout(group);
  if (layout.isolated) {
    return { position: 'fixed', top: '55px', left: '80px', zIndex: '30' };
  }
  // 锚点列号按渲染插槽下标换算（幽灵列存在时与 store 下标不同）
  const anchorId = tabStore.groups[layout.anchorGi]?.id;
  const anchorSi = anchorId ? slotIndexOf(anchorId) : 0;
  // 锚点分屏处于窄屏模式时顶角被方向书签占用，隐藏书签顺延下移一格
  const stackOffset = anchorId && narrowGroupIds.value.has(anchorId) ? 1 : 0;
  // 书签样式：平贴的一侧直角，外侧圆角（贴左缘 0 20px 20px 0，贴右缘反向）
  return {
    gridColumn: String(Math.max(anchorSi, 0) * 2 + 1),
    gridRow: '1',
    justifySelf: layout.useLeft ? 'end' : 'start',
    marginTop: `${10 + (layout.stackIndex + stackOffset) * 38}px`,
    borderRadius: layout.useLeft ? '20px 0 0 20px' : '0 20px 20px 0'
  };
}

/** 书签悬停展宽后显示的标题：隐藏书签统一标注"分屏"，
 *  与窄分屏的标签书签（悬停显示标签标题）区分 */
function groupActiveTitle(): string {
  return '分屏';
}

/** 缝隙工具条：交换左右两个可见分屏的布局位置（有分屏隐藏时禁用，store 内兜底） */
function swapSides(leftId: string, rightId: string | null): void {
  if (anyHiddenGroups.value || !rightId) return;
  tabStore.swapAdjacentGroups(leftId, rightId);
}

/** 缝隙工具条：隐藏某侧分屏（主分屏与最后一个可见分屏不可隐藏，store 内兜底） */
function hideSide(groupId: string | null): void {
  if (groupId) tabStore.setHidden(groupId, true);
}

/* 分屏分隔条拖拽调宽（沿用集锦抽屉的 mousedown + window mousemove 模式） */
interface PaneResizeSession {
  startX: number;
  /** 左右两个"可见"分屏的下标（中间可夹隐藏分屏） */
  li: number;
  ri: number;
  widths: number[];
  avail: number;
}
let paneResizeSession: PaneResizeSession | null = null;
/** 拖宽进行中：禁用列宽过渡，实时跟随鼠标（同集锦抽屉 drawer-resizing） */
const paneResizing = ref(false);

function startPaneResize(event: MouseEvent, li: number): void {
  if (event.button !== 0) return;
  const el = containerRef.value;
  if (!el) return;
  const ri = nearestVisibleAfter(li);
  if (ri < 0) return;
  const n = tabStore.groups.length;
  const avail = el.getBoundingClientRect().width - SPLIT_DIVIDER_WIDTH * (n - 1);
  const widths = tabStore.groupWidths.length === n
    ? [...tabStore.groupWidths]
    : Array.from({ length: n }, () => avail / n);
  paneResizeSession = { startX: event.clientX, li, ri, widths, avail };
  paneResizing.value = true;
  window.addEventListener('mousemove', onPaneResize);
  window.addEventListener('mouseup', endPaneResize);
  document.body.style.cursor = 'col-resize';
  event.preventDefault();
}

function onPaneResize(event: MouseEvent): void {
  const session = paneResizeSession;
  if (!session) return;
  const n = tabStore.groups.length;
  if (session.widths.length !== n) {
    endPaneResize();
    return;
  }
  const { li, ri } = session;
  // 列宽用 fr 表达：拖拽只在左右两个可见分屏间转移权重，总和保持等于可用宽度，
  // 这样 fr 归一化后渲染宽度与目标 px 一致，内容区与顶部标签条比例同步
  const upper = session.widths[li] + session.widths[ri] - SPLIT_MIN_PANE_WIDTH;
  const newLeft = Math.min(
    Math.max(session.widths[li] + (event.clientX - session.startX), SPLIT_MIN_PANE_WIDTH),
    Math.max(upper, SPLIT_MIN_PANE_WIDTH)
  );
  const applied = newLeft - session.widths[li];
  const widths = [...session.widths];
  widths[li] = newLeft;
  widths[ri] -= applied;
  tabStore.setGroupWidths(widths);
}

function endPaneResize(): void {
  paneResizeSession = null;
  paneResizing.value = false;
  document.body.style.cursor = '';
  window.removeEventListener('mousemove', onPaneResize);
  window.removeEventListener('mouseup', endPaneResize);
}

watch(
  () => tabStore.activeKey,
  (newActiveKey) => {
    if (!newActiveKey) return;
    const tab = tabStore.tabs.find((t: TabItem) => t.key === newActiveKey);
    if (tab && typeof tab.id === 'number') {
      onSwitchTabs(tab.id);
    }
  },
  { immediate: false }
);

interface QueuedNotification {
  title: string;
  source: string;
  component: Component;
  clickHandler: (() => void) | null;
  props: Record<string, unknown>;
  duration: number;
}

const MAX_QUEUED_NOTIFICATIONS = 20;
const queuedNotifications: QueuedNotification[] = [];

const flushQueuedNotifications = async (): Promise<void> => {
  const target = notificationComponent.value;
  if (!target || !target.addNotification) {
    return;
  }

  while (queuedNotifications.length > 0) {
    const item = queuedNotifications.shift();
    if (!item) break;
    try {
      await target.addNotification(item.title, item.source, item.component, item.clickHandler, item.props, item.duration);
    } catch (e) {
      console.error('Failed to flush queued notification:', e);
    }
  }
};

const safeAddNotification = async (
  title: string,
  source: string,
  component: Component,
  clickHandler: (() => void) | null,
  props: Record<string, unknown> = {},
  duration = 5000
): Promise<void> => {
  const target = notificationComponent.value;
  if (!target || !target.addNotification) {
    if (queuedNotifications.length < MAX_QUEUED_NOTIFICATIONS) {
      queuedNotifications.push({ title, source, component, clickHandler, props, duration });
    } else {
      console.error('Notification queue full, dropping notification:', title);
    }
    return;
  }

  try {
    await target.addNotification(title, source, component, clickHandler, props, duration);
  } catch (e) {
    console.error('Failed to add notification:', e);
  }
};

provide('sendNotification', safeAddNotification);

// Registered in setup scope (not onMounted) so even pre-mount errors show UI;
// safeAddNotification queues them until the notification component is ready.
errorService.addHandler(async (report: ErrorReportModel): Promise<void> => {
  try {
    await safeAddNotification(
      '应用发生错误',
      '<span class="material-symbols-outlined" style="font-size: 17px;">bug_report</span>错误管理',
      ErrorReportCard,
      null,
      { report },
      60000
    );
  } catch (e) {
    console.error('Failed to show error notification:', e);
  }
});

provide('sendToast', (title: string, duration = 3000): void => {
  if (ToastComponent.value) {
    ToastComponent.value.showToast(title, duration);
  }
});

provide('openImageViewer', (url: string): void => {
  imageViewerVisibility.value = true;
  imageViewerSrc.value = url;
});

provide('deleteTab', (key: string | number): void => {
  tabStore.removeTab(key);
});

provide('activeTabKey', computed(() => String(activeTab.value?.key ?? '')));

function generateUniqueId(text: string): number {
  let hash = 0;
  if (text.length === 0) return hash;

  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

const addHistoryFromTabMeta = (tab: TabItem, meta: TabInfo): void => {
  const props = tab.props || {};
  const component = tab.component;
  const componentName = (tab.component as { __name?: string })?.__name;

  if ((component === ViewThread || componentName === 'ViewThread') && props.tid !== undefined && !props.local && meta.title !== '贴子已被删除') {
    historyStore.addHistory({
      type: 'thread',
      target: String(props.tid),
      title: meta.title,
      icon: meta.icon || '/assets/apps.svg',
    });
    return;
  }

  if ((component === ViewBarThreads || componentName === 'ViewBarThreads') && props.barName !== undefined) {
    historyStore.addHistory({
      type: 'bar',
      target: String(props.barName),
      title: meta.title,
      icon: meta.icon || '/assets/apps.svg',
    });
    return;
  }

  if ((component === User || componentName === 'User') && props.uid !== undefined) {
    historyStore.addHistory({
      type: 'user',
      target: String(props.uid),
      title: meta.title,
      icon: meta.icon || '/assets/user.svg',
    });
  }
};

const setTabInfo = (info: TabInfo): void => {
  const keyStr = String(info.key);
  const tab = tabStore.tabs.find((t: TabItem) => t.key === keyStr);
  tabStore.updateTabMeta(keyStr, {
    title: info.title,
    icon: info.icon,
    icon_invert: info.icon_invert ?? tab?.icon_invert ?? false,
    ...(info.authorIcon !== undefined ? { authorIcon: info.authorIcon } : {})
  });
  if (tab) {
    addHistoryFromTabMeta(tab, info);
  }

  if (String(activeTab.value.key) === keyStr) {
    const updatedTab = tabStore.tabs.find((t: TabItem) => t.key === keyStr);
    if (updatedTab) {
      activeTab.value = {
        component: updatedTab.component,
        props: updatedTab.props,
        key: updatedTab.key,
        renderKey: updatedTab.renderKey || String(updatedTab.key),
        if: true,
        origin: {
          icon: updatedTab.origin?.icon,
          title: updatedTab.origin?.title
        }
      };
    }
  }
};

provide('updateTabMeta', setTabInfo);

function onSwitchTabs(id: number): void {
  const tabItem = tabStore.getTab(id);
  if (!tabItem) return;
  activeTab.value = {
    component: tabItem.component,
    props: tabItem.props,
    key: tabItem.key,
    renderKey: tabItem.renderKey || String(tabItem.key),
    if: true,
    origin: {
      icon: tabItem.origin?.icon,
      title: tabItem.origin?.title
    }
  };

  naviListItem.value.forEach(element => {
    element.selected = false;
  });

  const componentName = (tabItem.component as { __name?: string }).__name;
  switch (componentName) {
    case 'Home':
      naviListItem.value[1].selected = true;
      break;
    case 'User':
    case 'ViewThread':
    case 'ViewBarThreads':
    case 'FollowBar':
      naviListItem.value[2].selected = true;
      break;
    case 'Favourite':
    case 'My':
      naviListItem.value[3].selected = true;
      break;
    case 'Search':
    case 'SearchInBar':
      naviListItem.value[0].selected = true;
      break;
    case 'Setting':
      naviListItem.value[4].selected = true;
      break;
    case 'Debug':
      if (naviListItem.value.length > 5) {
        naviListItem.value[5].selected = true;
      }
      break;
    default:
      break;
  }
}

function onRefreshTab(id: number): void {
  const tabItem = tabStore.getTab(id);
  if (!tabItem) return;
  const key = tabItem.key;
  const isActiveTab = (activeTab.value as TabItem).key === key;
  const newRenderKey = `${key}-${Date.now()}`;

  tabStore.setTab(id, { renderKey: newRenderKey });

  if (isActiveTab && activeTab.value && typeof activeTab.value === 'object') {
    activeTab.value = {
      ...activeTab.value,
      renderKey: newRenderKey
    } as TabItem;
  }
}

const onDeactivated = (key: string | number): void => {
  console.log('Tab deactivated:', key);
};

const addBar = async (id: number): Promise<void> => {
  naviListItem.value.forEach(element => {
    element.selected = false;
  });
  naviListItem.value[id].selected = true;

  let key: number;
  switch (id) {
    case 0:
      key = generateUniqueId('Search');
      tabStore.addTab({
        key: `${key}`,
        icon: '/assets/search.svg',
        title: '搜索',
        component: Search,
        props: { key_: key },
        icon_invert: true
      });
      break;
    case 1:
      key = generateUniqueId('Home');
      tabStore.addTab({
        key: `${key}`,
        icon: '/assets/home.svg',
        title: '首页',
        component: Home,
        props: { key_: key },
        icon_invert: true
      });
      break;
    case 2:
      key = generateUniqueId('FollowBar');
      tabStore.addTab({
        key: `${key}`,
        icon: '/assets/apps.svg',
        title: '进吧',
        component: FollowBar,
        props: { key_: key },
        icon_invert: true
      });
      break;
    case 3:
      key = generateUniqueId('My');
      tabStore.addTab({
        key: `${key}`,
        icon: '/assets/user.svg',
        title: '我的',
        component: My,
        props: { key_: key },
        icon_invert: true
      });
      break;
    case 4:
      key = generateUniqueId('Setting');
      tabStore.addTab({
        key: `${key}`,
        icon: '/assets/settings.svg',
        title: '设置',
        component: Setting,
        props: { key_: key },
        icon_invert: true
      });
      break;
    case 5:
      key = generateUniqueId('Debug');
      tabStore.addTab({
        key: `${key}`,
        icon: '/assets/bug.svg',
        title: '调试',
        component: Debug,
        props: { key_: key },
        icon_invert: true
      });
      break;
    default:
      break;
  }
};

const onShowTabs = (): void => {
  showTabList.value = !showTabList.value;
  showNotificationBox.value = false;
};

const onShowNotificationBox = (): void => {
  showNotificationBox.value = !showNotificationBox.value;
  showTabList.value = false;
};

// 全局键盘控制：逐层关闭浮层（帮助 → 图片查看器 → 右侧面板）
const closeTopOverlay = (): boolean => {
  if (hotkeyState.helpVisible) {
    hotkeyState.helpVisible = false;
    return true;
  }
  if (imageViewerVisibility.value) {
    imageViewerVisibility.value = false;
    return true;
  }
  if (collectionStore.drawerOpen) {
    collectionStore.closeDrawer();
    return true;
  }
  if (showTabList.value || showNotificationBox.value) {
    showTabList.value = false;
    showNotificationBox.value = false;
    return true;
  }
  return false;
};

const showToastMessage = (title: string, duration = 3000): void => {
  ToastComponent.value?.showToast(title, duration);
};

useHotkeys({
  addBar: (id: number): void => {
    void addBar(id);
  },
  refreshActiveTab: (): void => {
    const key = (activeTab.value as TabItem)?.key;
    if (key === undefined || key === null) return;
    const tab = tabStore.getTab(String(key));
    if (tab) onRefreshTab(tab.id);
  },
  isViewerOpen: (): boolean => imageViewerVisibility.value,
  closeTopOverlay,
  toast: showToastMessage,
});

const handleUserChanged = async (): Promise<void> => {
  if (titleBarRef.value) {
    await titleBarRef.value.updateAvatar();
  }
};

const handleOpenSearchInBar = (data: OpenSearchInBarPayload): void => {
  openSearchInBar(data);
};

onBeforeUnmount(() => {
  endPaneResize();
});

onMounted(async (): Promise<void> => {
  await nextTick();
  isNotificationReady.value = true;
  await flushQueuedNotifications();
  void settingsStore.setWallpaperEffect(settingsStore.wallpaperEffect);
  settingsStore.applyTheme(settingsStore.theme);
  settingsStore.initWallpaper();

  clipboardService.addHandler(async (url: string): Promise<void> => {
    try {
      if (processedUrls.value.find((u: string) => u === url)) return;

      // Clipboard jump for ordinary Tieba thread links.
      const tiebaThread = url.trim().match(/^https?:\/\/tieba\.baidu\.com\/p\/([1-9]\d*)\/?(?:[?#].*)?$/i);
      if (tiebaThread) {
        const tid = tiebaThread[1];
        await safeAddNotification(
          '打开贴吧帖子',
          '<span class="material-symbols-outlined" style="font-size: 17px;">content_paste</span>Clipboard 跳转',
          Tip,
          () => openThread(tid),
          { Tip: `检测到帖子链接（ID: ${tid}），点击此处跳转` },
          60000
        );
        return;
      }

      const parser = new URLParser(url);
      if (parser.getProtocol().toLowerCase() === 'neotieba') {
        const params = parser.toObject().params;
        let jump_result: JumpResult | null = null;

        switch (parser.getPathname().toLowerCase()) {
          case 'viewthread': {
            const thread = await Api.get_post(Number(params?.tid), 1);
            jump_result = {
              onClick: (): void => {
                if (params?.tid !== undefined) {
                  openThread(params.tid);
                }
              },
              title: thread.data.thread.title,
              description: `来自 ${thread.data.forum.name} 吧`
            };
            break;
          }
        }

        if (jump_result !== null) {
          await safeAddNotification(
            jump_result.title,
            '<span class="material-symbols-outlined" style="font-size: 17px;">content_paste</span>Clipboard 跳转',
            Tip,
            jump_result.onClick,
            { Tip: jump_result.description },
            60000
          );
        }
      }
    } catch (e) {
      // console.error('Clipboard handler error:', e);
    } finally {
      processedUrls.value.push(url);
    }
  });

  const key = generateUniqueId('Welcome');
  tabStore.addTab({
    key: String(key),
    icon: '/assets/apps.svg',
    title: '欢迎',
    component: Welcome,
    props: { key_: key },
    show: false,
    closable: false,
    icon_invert: true,
    origin: ({ icon: '/assets/apps.svg', title: '欢迎' } as unknown) as import('@/types/common').TabItem
  });
});
</script>

<template>
  <div id="container"
    :class="{ 'drawer-open': collectionStore.drawerOpen, 'drawer-resizing': collectionStore.resizing, 'pane-resizing': paneResizing }"
    :style="{ ...containerStyle, ...solidBackgroundStyle, '--collection-drawer-width': collectionStore.drawerWidthCss }">
    <div id="container-overlay" :style="overlayStyle"></div>
    <div class="navi">
      <div class="navi-fixed">
        <RippleButtonWithIcon @click="addBar(item.id)" class="navi-button" v-for="item in naviListItem"
          :class="{ 'selected': item.selected }" :icon="item.icon" :title="item.title"></RippleButtonWithIcon>
      </div>
      <CollectionRail class="navi-collection" />
    </div>
    <!-- 顶部标签栏：每个分屏一个标签条，列模板与内容区分屏一致（按占比分配）；
         空白处 data-tauri-drag-region 可拖动窗口。列号按渲染插槽（含进出场幽灵列）计算 -->
    <div class="tabs-bar" data-tauri-drag-region :style="gridColumnsStyle">
      <template v-for="(slot, si) in renderSlots" :key="slot.id">
        <!-- 显式列号：隐藏/幽灵分屏的槽位不渲染时，后续标签条绝不能自动左移落进 0 宽列 -->
        <div v-if="!slot.collapsed" class="tabs-bar-slot" :data-group-id="slot.id"
          :style="{ gridColumn: String(si * 2 + 1) }" :class="{ 'last-visible': isLastVisibleSlot(si) }">
          <TabStrip v-if="!slot.ghost" :group-id="slot.id" @narrow-change="onPaneNarrowChange" />
        </div>
        <div v-if="si < renderSlots.length - 1 && !slot.collapsed && slotVisibleAfter(si)" class="tabs-bar-gap"
          :style="{ gridColumn: String(si * 2 + 2) }"
          @mousedown.prevent="startPaneResize($event, storeIndexOf(slot.id))"></div>
      </template>
    </div>
    <!-- 内容分屏：所有标签常驻挂载（keep-alive），同列同格堆叠、v-show 控制可见，
         移动分屏只改 grid 位置，组件实例不重建 -->
    <div ref="containerRef" class="container" :style="gridColumnsStyle">
      <!-- 分隔条：拖拽调宽；悬停显示分屏互动工具条（交换 / 隐藏左 / 隐藏右）。
           中间夹着隐藏分屏的两个可见分屏之间，分隔条照常工作（不特殊化） -->
      <template v-for="(slot, si) in renderSlots" :key="`div-${slot.id}`">
        <div v-if="si < renderSlots.length - 1 && !slot.collapsed && slotVisibleAfter(si)" class="pane-divider"
          :style="dividerTrackStyle(si)" @mousedown.prevent="startPaneResize($event, storeIndexOf(slot.id))">
          <div class="divider-toolbar" @mousedown.stop @click.stop>
            <span class="divider-btn material-symbols-outlined" title="交换两屏页面" :class="{ disabled: anyHiddenGroups }"
              @click="swapSides(slot.id, nearestVisibleSlotAfter(si)?.id ?? null)">swap_horiz</span>
            <span class="divider-btn material-symbols-outlined" title="隐藏左边分屏"
              @click="hideSide(slot.id)">keyboard_double_arrow_left</span>
            <span class="divider-btn material-symbols-outlined" title="隐藏右边分屏"
              @click="hideSide(nearestVisibleSlotAfter(si)?.id ?? null)">keyboard_double_arrow_right</span>
          </div>
        </div>
      </template>
      <!-- 拖拽标签期间：所有可用落区提前高亮，提示胶囊锚定在各落区旁，悬停的目标加强 -->
      <template v-for="slot in renderSlots" :key="`hl-${slot.id}`">
        <div v-if="splitOverlay.zonesActive && !slot.ghost && !slot.collapsed && slot.id !== splitOverlay.sourceGroupId"
          class="pane-drop-highlight" :data-group-id="slot.id"
          :class="{ hovered: tabStore.splitDropZone?.type === 'move' && tabStore.splitDropZone.groupId === slot.id }"
          :style="{ gridColumn: String(Math.max(slotIndexOf(slot.id), 0) * 2 + 1) }">
          <div class="pane-drop-label dynamic-island-pill"
            :class="{ hovered: tabStore.splitDropZone?.type === 'move' && tabStore.splitDropZone.groupId === slot.id }">
            <span class="material-symbols-outlined">drag_pan</span>
            <span>移动到此分屏</span>
          </div>
        </div>
      </template>
      <div v-if="splitOverlay.zonesActive" class="pane-drop-create-bar"
        :class="{ hovered: tabStore.splitDropZone?.type === 'create' }">
        <div class="pane-drop-label dynamic-island-pill"
          :class="{ hovered: tabStore.splitDropZone?.type === 'create' }">
          <span class="material-symbols-outlined">drag_pan</span>
          <span>新建分屏</span>
        </div>
      </div>
      <!-- 隐藏分屏的恢复入口：书签式图标贴在相邻可见分屏朝向隐藏侧的顶角，
           悬停沿锚定边反向展宽露出"分屏"标注，点击重新显示 -->
      <template v-for="group in tabStore.groups" :key="`chip-${group.id}`">
        <div v-if="group.hidden" class="hidden-chip"
          :class="{ 'flip': hiddenChipFlips(group), 'edge-right': hiddenChipFlips(group), 'edge-left': !hiddenChipFlips(group) }"
          :style="hiddenChipStyle(group)" @click="tabStore.setHidden(group.id, false)">
          <img v-if="groupIconUrl(group)" class="hidden-chip-icon" :src="groupIconUrl(group)"
            referrerpolicy="no-referrer" />
          <span v-else class="material-symbols-outlined hidden-chip-icon">visibility</span>
          <span class="hidden-chip-title">{{ groupActiveTitle() }}</span>
        </div>
      </template>
      <!-- 窄分屏的左右方向书签：平时只显示箭头，悬停展宽露出相邻标签的图标和标题，
           点击切换为该分屏当前页；与隐藏分屏的恢复书签共用顶角并纵向堆叠 -->
      <template v-for="group in tabStore.groups" :key="`pnav-${group.id}`">
        <div v-for="nav in paneNavChips(group.id)" :key="`pane-nav-${nav.side}`" class="hidden-chip pane-nav-chip"
          :class="{ 'flip': nav.side === 'right', 'edge-left': nav.side === 'left', 'edge-right': nav.side === 'right' }"
          :style="paneNavChipStyle(group.id, nav.side)" @click="tabStore.switchTab(nav.tab.key)">
          <span class="material-symbols-outlined hidden-chip-icon pane-nav-arrow">{{ nav.side === 'left'
            ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right' }}</span>
          <img v-if="nav.tab.icon" class="hidden-chip-icon" :src="resolveIconUrl(nav.tab.icon)"
            referrerpolicy="no-referrer" />
          <span v-else class="material-symbols-outlined hidden-chip-icon">tab</span>
          <span class="hidden-chip-title">{{ nav.tab.title }}</span>
        </div>
      </template>
      <div v-for="tab in tabStore.tabs" v-show="tabStore.isTabVisibleInPane(tab)" :key="tab.key" class="tab-pane"
        :style="tabPaneStyle(tab)" :data-tab-key="tab.key" :data-group-id="tab.groupId"
        @mousedown.capture="focusGroupPane(tabStore.groupOfTab(tab)?.id)">
        <keep-alive>
          <component @deactivated="onDeactivated(tab.key)" :is="tab.component" :key="tab.renderKey || tab.key"
            v-if="tab.if" v-bind="tab.props" @openThread="openThread" @openUser="openUser" @openBar="openBar"
            @openSearchInBar="handleOpenSearchInBar" @openFavourite="openFavourite" @openHistory="openHistory"
            @openLibrary="openLibrary" @userChanged="handleUserChanged" />
        </keep-alive>
      </div>
    </div>
    <TitleBar ref="titleBarRef" @showTabs="onShowTabs" @showNotificationBox="onShowNotificationBox"
      :msgCount="(notificationComponent?.notifications?.length || 0) + (notificationComponent?.hiddenNotifications?.length || 0)" />
    <Transition name="notification-box">
      <TabList class="notification-box" v-if="showTabList" @refresh="onRefreshTab"></TabList>
    </Transition>
    <Transition name="notification-box">
      <Notification ref="notificationComponent" v-show="!showNotificationBox && !showTabList" />
    </Transition>
    <Transition name="notification-box">
      <NotificationBox class="notification-box" v-if="showNotificationBox && !showTabList && notificationComponent"
        :tabsRef="notificationComponent">
      </NotificationBox>
    </Transition>
    <CollectionDrawer />
    <!-- 集锦拖拽浮层：分组名胶囊 + 拖拽删除高亮区（头像栏/集锦面板共用） -->
    <CollectionDragOverlay />
    <!-- 图片查看器与 Toast 必须盖过楼中楼卡片等弹窗（3200 层）。
         传送至 body，与楼中楼卡片同处根层叠上下文，避免被容器内的层叠上下文压住。 -->
    <Teleport to="body">
      <!-- 悬停快速预览：利用阅读区右侧空白浮动展示，层级低于图片查看器 -->
      <ImageHoverPreview />
      <ImageViewer :imageSrc="imageViewerSrc" :visible="imageViewerVisibility" @close="imageViewerVisibility = false">
      </ImageViewer>
      <Toast ref="ToastComponent" />
      <HotkeyHelp />
      <!-- 全局右键菜单宿主：任意组件通过 openContextMenu() 弹出 -->
      <ContextMenu />
    </Teleport>
    <ExternalLinkDialog @openThread="openThread" />
  </div>
</template>

<style scoped>
.notification-box-enter-active,
.notification-box-leave-active {
  transition: all 0.3s ease;
}

.notification-box-enter-from,
.notification-box-leave-to {
  transform: translateX(100%);
}

.notification-box {
  position: absolute;
  right: 10px;
  top: 55px;
  width: min(320px, calc(100vw - 100px));
  background-color: rgba(var(--background-color), 0.2);
  padding: 0 10px;
  border-radius: 7px;
  backdrop-filter: blur(20px);
  max-height: calc(100% - 70px);
  overflow-y: auto;
  border: 1.5px solid rgba(var(--text-color), 0.1);
  z-index: 2000;
}

.navi-button {
  opacity: 0.5;
  transition: opacity 0.2s ease;
  width: 100%;
}

.navi-button:hover {
  opacity: 0.8;
}

.navi-button.selected {
  opacity: 1;
}

#container {
  background-size: cover;
  background-position: center;
  width: 100%;
  height: 100%;
  position: fixed;
}

#container-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.flex-content {
  width: 100%;
  height: 100%;
}

.container {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  position: absolute;
  width: calc(100% - 70px);
  top: 45px;
  left: 70px;
  height: calc(100% - 45px);
  border-radius: 5px 0 0 0;
  /* 列模板动画与集锦抽屉同款 0.3s ease：开/关/隐藏分屏时列宽平滑插值
     （grid-template-columns 仅在列数不变且列类型兼容时插值，
     增删分组的动画由渲染插槽层的幽灵列/首帧零宽机制保证兼容） */
  transition: left 0.3s ease, width 0.3s ease, grid-template-columns 0.3s ease;
}

/* 集锦分屏：内容区向右避让，给左侧面板留出区域 */
#container.drawer-open .container {
  left: calc(70px + var(--collection-drawer-width, 380px));
  width: calc(100% - 70px - var(--collection-drawer-width, 380px));
}

/* 拖拽尺寸调节器时禁用过渡，实时跟随 */
#container.drawer-resizing .container {
  transition: none;
}

/* 拖拽分屏分隔条时禁用列宽过渡，实时跟随（与集锦抽屉的 drawer-resizing 同理） */
#container.pane-resizing .container,
#container.pane-resizing .tabs-bar {
  transition: none;
}

.navi {
  top: 0px;
  width: 70px;
  height: 100%;
  /* border-box：避免 padding 撑出窗口底部导致集锦栏底边框被截断 */
  box-sizing: border-box;
  position: fixed;
  display: flex;
  flex-direction: column;
  padding: 5px 0;
  background-color: rgba(30, 31, 32, 0);
  overflow: hidden;
}

.navi-fixed {
  flex: 0 0 auto;
}

.navi-collection {
  flex: 1 1 auto;
  min-height: 0;
}

.list {
  top: 0;
  height: 100%;
  position: relative;
  width: 220px;
  padding: 5px 10px;
  background-color: rgba(30, 31, 32, 0.3);
}

.tab {
  position: relative;
  top: 0px;
  width: 100%;
  height: 48px;
}
</style>
<style>
.tab-pane {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  position: relative;
  /* 显式钉在第 1 行：同列多个 pane 必须堆叠在同一格，
     否则 grid 自动放置会把后续 pane 挤到新行导致布局错乱 */
  grid-row: 1;
  /* 分屏格级查询容器：页面根不是 Container 的页（如 ViewThread 看图模式）
     用 @container pane (…) 取整格宽度 */
  container: pane / inline-size;
}

/* 顶部标签栏：与内容区完全同宽同列模板，每个分屏的标签条与内容格左边对齐；
   空白处可拖动窗口（data-tauri-drag-region）。层级低于标题栏（1100），
   最右分屏标签过多时滑入标题栏下方而非遮挡窗口按钮 */
.tabs-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  position: fixed;
  top: 0;
  left: 70px;
  width: calc(100% - 70px);
  /* 顶到 0px 并用 padding 补出原 5px 空隙：标签栏上缘的空白也属于
     data-tauri-drag-region，鼠标移到窗口最顶端仍可拖动窗口 */
  height: 45px;
  box-sizing: border-box;
  z-index: 1090;
  transition: left 0.3s ease, width 0.3s ease, grid-template-columns 0.3s ease;
}

/* 集锦抽屉打开：与内容区同步右移避让 */
#container.drawer-open .tabs-bar {
  left: calc(70px + var(--collection-drawer-width, 380px));
  width: calc(100% - 70px - var(--collection-drawer-width, 380px));
}

#container.drawer-resizing .tabs-bar {
  transition: none;
}

.tabs-bar-slot {
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: stretch;
}

/* 公摊：最后一个可见分屏的标签条在标题栏区域（右侧 --titlebar-reserve）前截断，
   不压窗口按钮；其余分屏标签条仍与内容格左边对齐 */
.tabs-bar-slot.last-visible {
  margin-right: var(--titlebar-reserve, 330px);
}

.tabs-bar-gap {
  width: 6px;
}

.pane-divider {
  cursor: col-resize;
  background-color: transparent;
  position: relative;
  z-index: 5;
  grid-row: 1;
}

/* 调节器位于两分屏交界处：平时不显示，移入时浮现细分隔线 */
.pane-divider::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 12px;
  bottom: 12px;
  width: 1px;
  transform: translateX(-50%);
  background-color: transparent;
  transition: background-color 0.2s;
  pointer-events: none;
}

.pane-divider:hover {
  background-color: rgba(var(--text-color), 0.08);
}

.pane-divider:hover::after {
  background-color: rgba(var(--text-color), 0.45);
}

/* 缝隙互动工具条：悬停分隔条时浮现，纵向排列，操作两屏（交换 / 隐藏左 / 隐藏右） */
.divider-toolbar {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border-radius: 10px;
  border: 1px solid rgba(var(--primary-color), 0.45);
  background-color: rgba(var(--background-color), 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  opacity: 0;
  pointer-events: none;
  z-index: 20;
  transition: opacity 0.15s ease;
}

.pane-divider:hover .divider-toolbar {
  opacity: 1;
  pointer-events: auto;
}

.divider-btn {
  font-size: 17px;
  color: rgb(var(--primary-color));
  opacity: 0.75;
  cursor: pointer;
  border-radius: 6px;
  padding: 3px;
}

.divider-btn:hover {
  opacity: 1;
  background-color: rgba(var(--primary-color), 0.12);
}

.divider-btn.disabled {
  opacity: 0.2;
  pointer-events: none;
}

/* 隐藏分屏的恢复书签：同统一胶囊的布局（图标+标题、模糊底、细描边），
   内容始终完整排布，仅用 max-width 做裁切窗口，悬停平滑展开 */
.hidden-chip {
  align-self: start;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: auto;
  min-width: 40px;
  max-width: 40px;
  height: 32px;
  padding: 0 8px;
  overflow: hidden;
  background-color: rgba(var(--text-color), 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(var(--text-color), 0.12);
  cursor: pointer;
  user-select: none;
  z-index: 30;
  transition: max-width 0.18s ease, background-color 0.15s ease;
}

.hidden-chip:hover {
  max-width: 900px;
}

.hidden-chip.flip {
  flex-direction: row-reverse;
}

/* 平贴分屏边缘的一侧不画竖向边框：只保留上下横线与圆弧侧 */
.hidden-chip.edge-left {
  border-width: 1px 1px 1px 0;
}

.hidden-chip.edge-right {
  border-width: 1px 0 1px 1px;
}

.hidden-chip .material-symbols-outlined {
  font-size: 16px;
}

/* 图标与标签一致做圆形化：方形图标被裁成纯圆形，本来就是圆形的不受影响 */
.hidden-chip-icon {
  width: 20px;
  height: 20px;
  border-radius: 16px;
  flex: 0 0 auto;
}

.hidden-chip-title {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: rgb(var(--text-color));
}

.hidden-chip .hidden-chip-title {
  margin: 0 12px 0 8px;
}

.hidden-chip.flip .hidden-chip-title {
  margin: 0 8px 0 12px;
}

/* 窄分屏方向书签：折叠态只显示方向箭头，悬停展宽露出目标标签的图标和标题 */
.hidden-chip.pane-nav-chip .hidden-chip-icon:not(.pane-nav-arrow),
.hidden-chip.pane-nav-chip .hidden-chip-title {
  max-width: 0;
  width: 0;
  opacity: 0;
  overflow: hidden;
  margin: 0;
  transition: max-width 0.18s ease, opacity 0.15s ease;
}

.hidden-chip.pane-nav-chip:hover .hidden-chip-icon:not(.pane-nav-arrow) {
  max-width: 20px;
  width: 20px;
  opacity: 1;
}

.hidden-chip.pane-nav-chip:hover .hidden-chip-title {
  max-width: 200px;
  width: auto;
  opacity: 1;
}

.hidden-chip.pane-nav-chip:not(.flip):hover .hidden-chip-title {
  margin: 0 12px 0 6px;
}

.hidden-chip.pane-nav-chip.flip:hover .hidden-chip-title {
  margin: 0 6px 0 12px;
}

.pane-nav-arrow {
  opacity: 0.75;
}

/* 拖拽期间的基础落区高亮（所有可用目标），hovered = 光标悬停的当前目标 */
.pane-drop-highlight {
  /* 胶囊的定位基准：必须自身为定位元素，否则胶囊会跑到整个容器中间 */
  position: relative;
  pointer-events: none;
  background-color: rgba(70, 160, 255, 0.05);
  outline: 1px solid rgba(70, 160, 255, 0.22);
  outline-offset: -1px;
  border-radius: 5px;
  z-index: 10;
  grid-row: 1;
}

.pane-drop-highlight.hovered {
  background-color: rgba(70, 160, 255, 0.12);
  outline: 1.5px solid rgba(70, 160, 255, 0.65);
}

/* 锚定在各分屏顶部的提示胶囊：外观走全局 .dynamic-island-pill（同集锦引导），这里只管定位 */
.pane-drop-label {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  white-space: nowrap;
  /* 胶囊本身是投放热区（父级高亮层 pointer-events:none，这里重新开启） */
  pointer-events: auto;
  z-index: 11;
  transition: transform 0.15s ease;
}

.pane-drop-label .material-symbols-outlined {
  font-size: 14px;
}

.pane-drop-label.hovered {
  transform: translateX(-50%) scale(1.06);
}

/* 右缘新建区的胶囊：锚在屏内右缘居中，不超出屏幕 */
.pane-drop-create-bar .pane-drop-label {
  left: auto;
  right: 18px;
  transform: translateY(-50%);
}

.pane-drop-create-bar .pane-drop-label.hovered {
  transform: translateY(-50%) scale(1.06);
}

.pane-drop-create-bar {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background-color: rgba(70, 160, 255, 0.35);
  pointer-events: none;
  z-index: 10;
  grid-row: 1;
}

.pane-drop-create-bar.hovered {
  background-color: rgba(70, 160, 255, 0.8);
  box-shadow: -2px 0 8px rgba(70, 160, 255, 0.4);
}

.icon_ {
  filter: invert(var(--invert));
}

.thread .avatar {
  width: 35px;
  height: 35px;
  border-radius: 50%;
  overflow: hidden;
}

.user-info {
  margin-top: 5px;
}


.at-button {
  background-color: transparent;
  box-shadow: none;
  padding: 0;
  color: #46a0ff;
  font-weight: bold;
  border: none;
  transition: all 0.3s ease;
}

.at-button:hover {
  border: none;
  opacity: 0.5;
}

.desc {
  opacity: 0.5;
}

.user-name {
  font-weight: bold;
  font-size: 110%;
}

input {
  border: none;
  outline-style: none;
  border-radius: 5px;
  height: 100%;
  padding: 10px 15px;
  box-sizing: border-box;
}

.notification-container {
  position: fixed;
  display: flex;
  flex-direction: column;
  z-index: 2000;
  overflow-y: auto;
  overflow-x: hidden;
  right: 0px;
  top: 50px;
  padding-right: 10px;
  height: calc(100% - 50px);
  pointer-events: none;
  width: 300px;
}

.notification {
  pointer-events: all;
  background-color: rgba(var(--background-color), 0.5);
  backdrop-filter: blur(var(--blur-value));
  border-radius: 4px;
  box-shadow: 0px 3px 10px -3px rgba(0, 0, 0, 0.6);
  width: calc(100% - 10px);
  margin: 10px;
  margin-top: 0px;
}

.notification-source {
  font-size: 12px;
  margin-bottom: 4px;
  text-align: left;
  width: 210px;
  opacity: 0.5;
  word-wrap: break-word;
  align-items: center;
  display: flex;
  gap: 5px;
}

.notification-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 4px;
  text-align: left;
  width: 250px;
  color: rgba(var(--text-color));
  word-wrap: break-word;
}

.notification-message {
  font-size: 14px;
  color: rgba(var(--text-color), 0.5);
  text-align: left;
  width: 100%;
  margin-top: 5px;
  height: fit-content;
}

.notification-content {
  width: 100%;
  background-color: rgba(var(--background-color), 0.2);
}

.notification-close {
  border: none;
  background: none;
  display: flex;
  justify-content: center;
  align-items: center;
  position: absolute;
  right: 0px;
  top: 0px;
  box-shadow: none;
  width: 32px;
  padding: 0;
  height: 32px;
  opacity: 0.5;
}

.notification-hide {
  border: none;
  background: none;
  display: flex;
  justify-content: center;
  align-items: center;
  position: absolute;
  right: 30px;
  top: 0px;
  box-shadow: none;
  width: 32px;
  padding: 0;
  height: 32px;
  opacity: 0.5;
}

.notification-hide:hover {
  opacity: 1;
}

.notification-close:hover {
  opacity: 1;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, bottom 0.3s ease;

}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  bottom: 5px;
}

.fade-notify-enter-active,
.fade-notify-leave-active,
.fade-notify-move {
  transition: all 0.3s ease;
}

.fade-notify-enter-from,
.fade-notify-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

.thread-content {
  font-size: 120%;
  white-space: break-spaces;
  line-height: 200%;
}

.user-info {
  display: flex;
  gap: 10px;
  align-items: center;
  width: fit-content;
  transition: background-color 0.3s ease;
  border-radius: 5px;
}

.user-info:hover {
  background-color: rgba(var(--text-color), 0.1);
}

.level.color1 {
  background-color: rgba(0, 255, 166, 0.1);
}

.level.color2 {
  background-color: rgba(0, 119, 255, 0.1);
}

.level.color3 {
  background-color: rgba(255, 255, 0, 0.1);
}

.level.color4 {
  background-color: rgba(255, 0, 0, 0.1);
}

.level {
  background-color: rgba(0, 0, 0, 0.1);
  padding: 3px 10px;
  margin-left: 10px;
  border-radius: 5px;
  width: fit-content;
  margin-bottom: 5px;
}

.emoticon {
  width: 32px;
  height: 32px;
}

.loading-box {
  position: absolute;
  left: 30px;
  bottom: 20px;
}

.fade1-enter-active,
.fade1-leave-active {
  transition: opacity 0.5s ease;
}

.fade1-enter-from,
.fade1-leave-to {
  opacity: 0;
}

::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}

::-webkit-scrollbar-track {
  border-radius: 0;
}

::-webkit-scrollbar-thumb {
  background-color: rgba(var(--text-color), 0.3);
  border-radius: 0;
  transition: background-color 0.2s;
  cursor: pointer;
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(var(--text-color), 0.5);
}

a {
  font-weight: 500;
  color: rgb(0, 179, 255);
  text-decoration: inherit;
  transition: color 0.25s;
}

a:hover {
  color: rgb(83, 91, 242);
}

h1 {
  text-align: center;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  color: #0f0f0f;
  transition: border-color 0.25s;
  box-shadow: 0 2px 2px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  outline: none;
}

button:hover {
  border-color: #396cd8;
}

button:active {
  border-color: #396cd8;
  background-color: #e8e8e8;
}

input,
button {
  outline: none;
}

#greet-input {
  margin-right: 5px;
}

:root.dark a:hover {
  color: #24c8db;
}

:root.dark input,
:root.dark button {
  color: #ffffff;
}
</style>
