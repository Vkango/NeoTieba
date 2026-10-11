import { reactive } from 'vue';

/**
 * 全局键盘控制 · 核心模块
 *
 * - HOTKEY_ACTIONS：动作注册表（默认键位 + 中文描述），帮助浮层与设置页共用，
 *   键位文档由注册表渲染，永远与实际行为同步。
 * - 组合键规范化：'Ctrl+Shift+Tab'、'J'、'G G'（空格分隔的序列键）。
 *   含 Ctrl/Alt/Meta 的组合键为「全局键」，输入框内也生效；其余为「单键」，
 *   仅在焦点不在输入框时生效。
 * - 滚动注册表：Container 按 tabKey 注册滚动句柄，引擎按当前标签取用。
 * - 光标模式：列表内条目级选择（卡片组件根节点标记 data-kb-item）。
 */

export type Combo = string;
export type HotkeyGroupId = 'tabs' | 'nav' | 'browse' | 'general';

export interface HotkeyAction {
  id: string;
  label: string;
  desc?: string;
  group: HotkeyGroupId;
  defaults: Combo[];
}

export const HOTKEY_GROUP_NAMES: Record<HotkeyGroupId, string> = {
  tabs: '标签页',
  nav: '导航',
  browse: '浏览',
  general: '通用',
};

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  // 标签页
  { id: 'tab.next', label: '下一个标签', group: 'tabs', defaults: ['Ctrl+Tab'] },
  { id: 'tab.prev', label: '上一个标签', group: 'tabs', defaults: ['Ctrl+Shift+Tab'] },
  { id: 'tab.close', label: '关闭当前标签', group: 'tabs', defaults: ['Ctrl+W'] },
  {
    id: 'tab.jump',
    label: '跳转到第 n 个标签',
    desc: 'Ctrl+9 为最后一个标签',
    group: 'tabs',
    defaults: ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9'],
  },
  { id: 'tab.refresh', label: '刷新当前标签', group: 'tabs', defaults: ['F5', 'R'] },
  // 导航
  { id: 'nav.search', label: '打开搜索', group: 'nav', defaults: ['Alt+1'] },
  { id: 'nav.home', label: '打开首页', group: 'nav', defaults: ['Alt+2'] },
  { id: 'nav.bar', label: '打开进吧', group: 'nav', defaults: ['Alt+3'] },
  { id: 'nav.my', label: '打开我的', group: 'nav', defaults: ['Alt+4'] },
  { id: 'nav.setting', label: '打开设置', group: 'nav', defaults: ['Alt+5'] },
  {
    id: 'search.focus',
    label: '聚焦页面搜索框',
    desc: '当前页没有搜索框时打开全局搜索',
    group: 'nav',
    defaults: ['Ctrl+F', '/'],
  },
  // 浏览
  {
    id: 'cursor.toggle',
    label: '切换 光标/滚动 模式',
    desc: '光标模式下 J/K 逐条选择，Enter 打开；当前列表没有条目时自动退回滚动',
    group: 'browse',
    defaults: ['V'],
  },
  { id: 'cursor.open', label: '打开光标所在条目', group: 'browse', defaults: ['Enter', 'O'] },
  { id: 'scroll.down', label: '向下滚动 / 下一条', group: 'browse', defaults: ['J'] },
  { id: 'scroll.up', label: '向上滚动 / 上一条', group: 'browse', defaults: ['K'] },
  { id: 'scroll.pageDown', label: '向下翻页', group: 'browse', defaults: ['Space'] },
  { id: 'scroll.pageUp', label: '向上翻页', group: 'browse', defaults: ['Shift+Space'] },
  { id: 'scroll.top', label: '回到顶部', desc: '连按两次 G', group: 'browse', defaults: ['G G'] },
  { id: 'scroll.bottom', label: '跳到底部', group: 'browse', defaults: ['Shift+G'] },
  // 通用
  {
    id: 'panel.close',
    label: '关闭面板 / 浮层',
    desc: '快捷键帮助、图片查看器、标签列表、通知面板',
    group: 'general',
    defaults: ['Esc'],
  },
  { id: 'help.toggle', label: '快捷键帮助', group: 'general', defaults: ['?'] },
];

export const HOTKEY_ACTION_MAP: ReadonlyMap<string, HotkeyAction> = new Map(
  HOTKEY_ACTIONS.map((action) => [action.id, action])
);

const MODIFIER_KEYS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta']);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/** 键名规范化：' ' → Space，Escape → Esc，方向键缩写，单字符统一大写。 */
export function normalizeKeyName(key: string): string {
  const alias = KEY_ALIASES[key];
  if (alias) return alias;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** 将 KeyboardEvent 转换为规范化组合键；纯修饰键返回 null。 */
export function comboFromEvent(event: KeyboardEvent): Combo | null {
  if (event.isComposing) return null;
  const key = normalizeKeyName(event.key);
  if (MODIFIER_KEYS.has(key) || key === 'CapsLock' || key === 'Dead' || key === 'Unidentified') {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  // '?'、'!' 等符号本身需要 Shift 才能输入，不记录 Shift 修饰；字母/数字保留。
  if (event.shiftKey && (key.length > 1 || /[a-zA-Z0-9]/.test(key))) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** 全局键（含 Ctrl/Alt/Meta）：输入框内也生效。 */
export function isComboGlobal(combo: Combo): boolean {
  return /(^|\+)(Ctrl|Alt|Meta)(\+|$)/.test(combo);
}

/** 序列键（如 'G G'）：以空格分隔。 */
export function isSequenceCombo(combo: Combo): boolean {
  return combo.includes(' ');
}

/** 展示用紧凑化：仅当 Ctrl+1 ~ Ctrl+9 九个键位齐全时合并为 'Ctrl+1~9'。 */
export function compactCombos(combos: Combo[]): Combo[] {
  if (combos.length !== 9) return combos;
  const parsed = combos.map((combo) => combo.match(/^(.+)\+([1-9])$/));
  if (!parsed.every(Boolean)) return combos;
  const prefixes = new Set(parsed.map((match) => match![1]));
  if (prefixes.size !== 1) return combos;
  return [`${[...prefixes][0]}+1~9`];
}

export interface ScrollerHandle {
  /** 滚动容器元素（getter，避免挂载时序问题） */
  readonly el: HTMLElement;
  scrollToTop(): void;
  scrollToElement(element: HTMLElement, offset?: number): void;
}

const scrollers = new Map<string, ScrollerHandle>();

export function registerScroller(key: string, handle: ScrollerHandle): void {
  scrollers.set(key, handle);
}

export function unregisterScroller(key: string, handle: ScrollerHandle): void {
  if (scrollers.get(key) === handle) scrollers.delete(key);
}

export function getScroller(key: string | null | undefined): ScrollerHandle | null {
  if (!key) return null;
  return scrollers.get(String(key)) ?? null;
}

/** 引擎的响应式状态（帮助浮层可见性、光标模式等），App 与组件直接读取。 */
export const hotkeyState = reactive({
  helpVisible: false,
  cursorMode: false,
  cursorActive: false,
  /** 外链确认对话框打开时置位，引擎随之静默（对话框自行处理 Esc/Tab） */
  externalDialogOpen: false,
});

/* ---------------------------------- 光标 ---------------------------------- */

let cursorElement: HTMLElement | null = null;
let cursorIndex = -1;

function collectCursorItems(handle: ScrollerHandle): HTMLElement[] {
  return Array.from(handle.el.querySelectorAll<HTMLElement>('[data-kb-item]'))
    .filter((el) => el.offsetParent !== null);
}

export function clearCursor(): void {
  if (cursorElement) cursorElement.classList.remove('kb-cursor');
  cursorElement = null;
  cursorIndex = -1;
  hotkeyState.cursorActive = false;
}

/** 应用光标到指定条目；follow 为 true 时滚动跟随（上下各留一屏的 1/4 作为缓冲）。 */
function setCursor(items: HTMLElement[], index: number, handle: ScrollerHandle, follow: boolean): void {
  const next = items[index];
  if (!next) {
    clearCursor();
    return;
  }
  if (cursorElement && cursorElement !== next) cursorElement.classList.remove('kb-cursor');
  cursorElement = next;
  cursorIndex = index;
  next.classList.add('kb-cursor');
  hotkeyState.cursorActive = true;

  if (!follow) return;
  const containerRect = handle.el.getBoundingClientRect();
  const rect = next.getBoundingClientRect();
  const margin = handle.el.clientHeight / 4;
  if (rect.top < containerRect.top + margin || rect.bottom > containerRect.bottom - margin) {
    const offset = Math.max(12, handle.el.clientHeight / 2 - rect.height / 2);
    handle.scrollToElement(next, offset);
  }
}

/** 找到当前视口顶部（含部分露出）的第一个条目下标；全部已滚过时取最后一个。 */
function findViewportIndex(items: HTMLElement[], containerTop: number): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i].getBoundingClientRect().bottom > containerTop + 1) return i;
  }
  return items.length - 1;
}

/** 移动光标并滚动跟随；返回 false 表示当前容器没有可选项（调用方可退回滚动）。
 *  光标未初始化时先落在当前视口内的元素上（而不是第 0 个），本次按键不移动。 */
export function moveCursor(handle: ScrollerHandle | null, delta: number): boolean {
  if (!handle || !handle.el) return false;
  const items = collectCursorItems(handle);
  if (!items.length) {
    clearCursor();
    return false;
  }
  if (cursorIndex < 0 || !cursorElement || !cursorElement.isConnected) {
    setCursor(items, findViewportIndex(items, handle.el.getBoundingClientRect().top), handle, true);
    return true;
  }
  setCursor(items, Math.min(items.length - 1, Math.max(0, cursorIndex + delta)), handle, true);
  return true;
}

/** 开启光标模式时调用：把光标直接放到当前视口内的元素上，不产生滚动。 */
export function placeCursorAtViewport(handle: ScrollerHandle | null): void {
  if (!handle || !handle.el) return;
  const items = collectCursorItems(handle);
  if (!items.length) return;
  setCursor(items, findViewportIndex(items, handle.el.getBoundingClientRect().top), handle, false);
}

/** 触发当前光标条目的点击行为（打开帖子/吧等）。 */
export function openCursor(handle: ScrollerHandle | null): boolean {
  if (!handle || cursorIndex < 0) return false;
  const target = collectCursorItems(handle)[cursorIndex];
  if (!target) {
    clearCursor();
    return false;
  }
  target.click();
  return true;
}
