import { computed, onBeforeUnmount, watch, type ComputedRef } from 'vue';
import {
  clearCursor,
  comboFromEvent,
  getScroller,
  hotkeyState,
  HOTKEY_ACTIONS,
  isComboGlobal,
  isSequenceCombo,
  moveCursor,
  openCursor,
  placeCursorAtViewport,
  type Combo,
  type ScrollerHandle,
} from '@/core/hotkeys';
import { useSettingsStore } from '@/stores/settings';
import { useTabStore } from '@/stores/tabs';

export interface HotkeyContext {
  /** 侧边栏导航（搜索/首页/进吧/我的/设置），由 App.vue 提供以复用现有去重逻辑 */
  addBar: (id: number) => void;
  /** 刷新当前标签（复用 App.vue 的 onRefreshTab，保证 renderKey 同步） */
  refreshActiveTab: () => void;
  /** 图片查看器是否打开 */
  isViewerOpen: () => boolean;
  /** 逐层关闭浮层（帮助 → 图片查看器 → 右侧面板），返回是否有关闭动作 */
  closeTopOverlay: () => boolean;
  toast: (title: string, duration?: number) => void;
}

const SEQUENCE_TIMEOUT = 1200;

/** 焦点是否处于文本输入控件（此时所有「单键」放行，不拦截不阻止默认行为）。 */
function isTextInputTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * 全局键盘控制引擎。在 App.vue 的 setup 中安装一次即可。
 * 监听 window keydown（冒泡阶段）：ExternalLinkDialog 在捕获阶段对 Esc 的
 * stopImmediatePropagation 会先于本引擎执行，因此对话框打开时引擎天然静默。
 */
export function useHotkeys(ctx: HotkeyContext): void {
  const settingsStore = useSettingsStore();
  const tabStore = useTabStore();

  let sequenceBuffer: Combo[] = [];
  let sequenceTimer = 0;

  /** id → 生效键位（覆盖优先，空数组表示禁用） */
  const effectiveBindings: ComputedRef<Map<string, Combo[]>> = computed(() => {
    const map = new Map<string, Combo[]>();
    for (const action of HOTKEY_ACTIONS) {
      const override = settingsStore.hotkeyOverrides[action.id];
      map.set(action.id, Array.isArray(override) ? override : action.defaults);
    }
    return map;
  });

  /** 组合键 → 动作 id（不含序列键） */
  const immediateIndex = computed(() => {
    const map = new Map<Combo, string>();
    for (const [id, combos] of effectiveBindings.value) {
      for (const combo of combos) {
        if (combo && !isSequenceCombo(combo)) map.set(combo, id);
      }
    }
    return map;
  });

  /** 序列键 → 动作 id（如 'G G'） */
  const sequenceIndex = computed(() => {
    const map = new Map<Combo, string>();
    for (const [id, combos] of effectiveBindings.value) {
      for (const combo of combos) {
        if (combo && isSequenceCombo(combo)) map.set(combo, id);
      }
    }
    return map;
  });

  function hasSequencePrefix(candidate: Combo): boolean {
    const prefix = `${candidate} `;
    for (const key of sequenceIndex.value.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  function resetSequence(): void {
    sequenceBuffer = [];
    if (sequenceTimer) {
      window.clearTimeout(sequenceTimer);
      sequenceTimer = 0;
    }
  }

  function pushSequence(combo: Combo): void {
    sequenceBuffer = [...sequenceBuffer, combo];
    if (sequenceTimer) window.clearTimeout(sequenceTimer);
    sequenceTimer = window.setTimeout(resetSequence, SEQUENCE_TIMEOUT);
  }

  /* ------------------------------- 动作实现 ------------------------------- */

  function cycleTab(direction: number): boolean {
    const tabs = tabStore.visibleTabs;
    if (tabs.length < 2) return false;
    const index = tabs.findIndex((tab) => tab.key === tabStore.activeKey);
    const next = (index + direction + tabs.length) % tabs.length;
    tabStore.switchTab(tabs[next].key);
    return true;
  }

  function jumpToTab(n: number): boolean {
    const tabs = tabStore.visibleTabs;
    if (!tabs.length || n < 1) return false;
    const target = n >= 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (!target) return false;
    tabStore.switchTab(target.key);
    return true;
  }

  function activeScroller(): ScrollerHandle | null {
    return getScroller(tabStore.activeKey);
  }

  function scrollStep(direction: number, handle: ScrollerHandle | null): boolean {
    if (!handle?.el) return false;
    const step = Math.max(120, Math.round(handle.el.clientHeight / 4));
    handle.el.scrollBy({ top: direction * step, behavior: 'smooth' });
    return true;
  }

  function scrollPage(direction: number, handle: ScrollerHandle | null): boolean {
    if (!handle?.el) return false;
    handle.el.scrollBy({ top: direction * handle.el.clientHeight * 0.9, behavior: 'smooth' });
    return true;
  }

  /** J/K：光标模式下移动条目，列表无条目时退回固定步长滚动。 */
  function browseMove(direction: number, handle: ScrollerHandle | null): boolean {
    if (hotkeyState.cursorMode && moveCursor(handle, direction)) return true;
    return scrollStep(direction, handle);
  }

  function focusPageSearch(): boolean {
    const panes = Array.from(document.querySelectorAll<HTMLElement>('.tab-pane'));
    const activePane = panes.find((pane) => pane.style.display !== 'none');
    const input = activePane?.querySelector<HTMLElement>('[data-kb-search]');
    if (input) {
      input.focus();
      if (input instanceof HTMLInputElement) input.select();
      return true;
    }
    ctx.addBar(0);
    return true;
  }

  function toggleCursorMode(): void {
    hotkeyState.cursorMode = !hotkeyState.cursorMode;
    if (hotkeyState.cursorMode) {
      // 直接选中当前视口内的元素，避免从列表头开始
      placeCursorAtViewport(activeScroller());
    } else {
      clearCursor();
    }
    ctx.toast(hotkeyState.cursorMode ? '光标模式：J/K 选择，Enter 打开' : '光标模式：已关闭', 2200);
  }

  /** 执行动作；返回 false 表示未生效（不阻止默认行为）。 */
  function execute(id: string, combo: Combo): boolean {
    const handle = activeScroller();
    switch (id) {
      case 'tab.next':
        return cycleTab(1);
      case 'tab.prev':
        return cycleTab(-1);
      case 'tab.close': {
        const current = tabStore.currentTab;
        if (!current) return false;
        tabStore.removeTab(current.id);
        return true;
      }
      case 'tab.jump':
        return jumpToTab(Number(combo.slice(-1)));
      case 'tab.refresh':
        ctx.refreshActiveTab();
        return true;
      case 'nav.search':
        ctx.addBar(0);
        return true;
      case 'nav.home':
        ctx.addBar(1);
        return true;
      case 'nav.bar':
        ctx.addBar(2);
        return true;
      case 'nav.my':
        ctx.addBar(3);
        return true;
      case 'nav.setting':
        ctx.addBar(4);
        return true;
      case 'search.focus':
        return focusPageSearch();
      case 'cursor.toggle':
        toggleCursorMode();
        return true;
      case 'cursor.open':
        return openCursor(handle);
      case 'scroll.down':
        return browseMove(1, handle);
      case 'scroll.up':
        return browseMove(-1, handle);
      case 'scroll.pageDown':
        return scrollPage(1, handle);
      case 'scroll.pageUp':
        return scrollPage(-1, handle);
      case 'scroll.top':
        if (!handle) return false;
        handle.scrollToTop();
        return true;
      case 'scroll.bottom':
        if (!handle?.el) return false;
        handle.el.scrollTo({ top: handle.el.scrollHeight, behavior: 'smooth' });
        return true;
      case 'panel.close': {
        if (ctx.closeTopOverlay()) return true;
        if (hotkeyState.cursorActive) {
          clearCursor();
          return true;
        }
        return false;
      }
      case 'help.toggle':
        hotkeyState.helpVisible = !hotkeyState.helpVisible;
        return true;
      default:
        return false;
    }
  }

  /* ------------------------------- 事件入口 ------------------------------- */

  function onKeydown(event: KeyboardEvent): void {
    if (!settingsStore.keyboardEnabled) return;
    if (event.isComposing || event.keyCode === 229) return;
    const combo = comboFromEvent(event);
    if (!combo) return;

    // 浮层/模态打开时仅放行「关闭面板」与「帮助」，其余静默
    if (ctx.isViewerOpen() || hotkeyState.helpVisible || hotkeyState.externalDialogOpen) {
      // 外链对话框在捕获阶段自行处理 Esc/Tab，引擎完全静默
      if (hotkeyState.externalDialogOpen) return;
      const id = immediateIndex.value.get(combo);
      if (id === 'panel.close') {
        event.preventDefault();
        ctx.closeTopOverlay();
      } else if (id === 'help.toggle' && !ctx.isViewerOpen()) {
        event.preventDefault();
        hotkeyState.helpVisible = !hotkeyState.helpVisible;
      }
      return;
    }

    // 非全局键（单键）：输入焦点时完整放行（不拦截、不 preventDefault），
    // 仅保留 Esc 关闭面板/浮层的能力
    if (!isComboGlobal(combo) && isTextInputTarget(event)) {
      if (immediateIndex.value.get(combo) === 'panel.close') {
        if (execute('panel.close', combo)) event.preventDefault();
      } else {
        resetSequence();
      }
      return;
    }

    // 序列键缓冲（如 G G）
    if (sequenceBuffer.length > 0) {
      const candidate = [...sequenceBuffer, combo].join(' ');
      const exact = sequenceIndex.value.get(candidate);
      if (exact) {
        resetSequence();
        if (execute(exact, candidate)) event.preventDefault();
        return;
      }
      if (hasSequencePrefix(candidate)) {
        pushSequence(combo);
        event.preventDefault();
        return;
      }
      resetSequence();
    }

    const id = immediateIndex.value.get(combo);
    if (id) {
      if (execute(id, combo)) event.preventDefault();
      return;
    }

    if (hasSequencePrefix(combo)) {
      pushSequence(combo);
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', onKeydown);

  // 切换标签/禁用键盘控制时清理光标与序列缓冲
  watch(() => tabStore.activeKey, () => {
    clearCursor();
    resetSequence();
  });
  watch(() => settingsStore.keyboardEnabled, (enabled) => {
    if (!enabled) {
      clearCursor();
      hotkeyState.cursorMode = false;
      resetSequence();
    }
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    resetSequence();
    clearCursor();
  });
}
