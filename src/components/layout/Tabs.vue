<template>
  <transition-group ref="tabsRef" name="tab-list" :move-class="isDragging || isSettling ? 'tab-drag-move' : 'tab-list-move'"
    tag="div" class="tabs" data-tauri-drag-region @wheel="onTabScroll" @scroll="updateDragPreview"
    @before-leave="(el: Element) => pinLeavingTab(el as HTMLElement)">
    <RippleButton class="tab-ripplebutton" v-for="tab in displayedTabs" :class="{
      'selected': tab.selected,
      'invert': tab.icon_invert,
      'show': !tab.show,
      'dragging': tabStore.draggingTabId === tab.id,
      'closing': tab.isClosing
    }" :key="tab.id" :data-tab-id="tab.id" @click="handleClick(tab)" @mousedown.stop="startDrag($event, tab)"
      @contextmenu.prevent="openTabContextMenu($event, tab)" :style="getTabStyle(tab)">
      <div class="tab-content">
        <img class="icon" :class="{ 'invert': tab.icon_invert }" :src="getIconPath(tab.icon)"
          referrerpolicy="no-referrer" />
        <div class="title">{{ tab.title }}</div>
        <span v-if="tab.closable !== false" class="material-symbols-outlined" id="close" style="font-size: 12px;"
          @click.stop="handleDelete(tab)">close</span>
      </div>
    </RippleButton>

  </transition-group>

</template>

<script setup lang="ts">
import type { TabItem } from '@/types/common';
import { computed, ref, onBeforeUnmount, nextTick, type Component, watch } from 'vue';
import { useTabStore } from '@/stores/tabs';
import RippleButton from '#components/common/RippleButton.vue';

import { getTabDragPreview, type DragTabLayout } from './tab-drag';
import { openContextMenu } from '@/utils/contextMenu';
import { getTabLink } from '@/utils/tab-link';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { errorService } from '@/core/error-service';

const tabStore = useTabStore();
const displayedTabs = computed(() => tabStore.visibleTabs.filter((tab: TabItem) => tab.show));

// Emit events for parent components
const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'onSwitchTabs', id: number): void;
  (e: 'onTabDelete', key: string | number): void;
  (e: 'refresh', id: number): void;
}>();

// Watch for activeKey changes and emit event
watch(
  () => tabStore.activeKey,
  (newActiveKey) => {
    if (newActiveKey) {
      const tab = tabStore.tabs.find((t: TabItem) => t.key === newActiveKey);
      if (tab && typeof tab.id === 'number') {
        emit('onSwitchTabs', tab.id);
      }
    }
  },
  { immediate: true }
);
const tabsRef = ref<{ $el: HTMLElement } | null>(null);
const isDragging = ref(false);
const isSettling = ref(false);
const settlingTabId = ref<number | null>(null);
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const previewOffsets = ref(new Map<number, number>());
let dragSession: {
  id: number;
  startX: number;
  currentX: number;
  scrollLeft: number;
  layout: DragTabLayout[];
  order: number[];
  finishing: boolean;
} | null = null;
let suppressClick = false;

const onTabScroll = (event: WheelEvent): void => {
  const container = tabsRef.value?.$el;
  if (!container) return;
  const deltaX = event.deltaY;
  container.scrollLeft += deltaX;
};

function getTabStyle(tab: TabItem): Record<string, string> {
  const isTabDragging = tabStore.draggingTabId === tab.id && isDragging.value;

  return {
    transform: isDragging.value && previewOffsets.value.has(tab.id)
      ? `translateX(${previewOffsets.value.get(tab.id)}px)` : '',
    zIndex: isTabDragging ? '200' : (tab.isClosing ? '-1' : 'auto'),
    transition: isSettling.value
      ? (!isDragging.value && settlingTabId.value === tab.id ? 'transform 0.3s ease' : 'none')
      : (isTabDragging ? 'none' : 'transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease'),
    pointerEvents: tab.isClosing ? 'none' : 'auto',
    cursor: isTabDragging ? 'grabbing' : 'pointer'
  };
}

function startDrag(event: MouseEvent, tab: TabItem): void {
  if (event.button !== 0 || tab.isClosing || dragSession || isSettling.value) return;
  if ((event.target as HTMLElement).closest('#close')) return;
  const container = tabsRef.value?.$el;
  if (!container) return;
  suppressClick = false;
  const elements = Array.from(container.querySelectorAll<HTMLElement>('.tab-ripplebutton'))
    .filter(el => !el.classList.contains('closing') && !el.classList.contains('show'));
  const layout = elements.map((el, index) => {
    const next = elements[index + 1];
    return {
      id: Number(el.dataset.tabId),
      left: el.offsetLeft,
      width: el.offsetWidth,
      span: next ? next.offsetLeft - el.offsetLeft
        : el.offsetWidth + parseFloat(getComputedStyle(el).marginRight || '0')
    };
  });
  dragSession = {
    id: tab.id, startX: event.clientX, currentX: event.clientX,
    scrollLeft: container.scrollLeft, layout, order: layout.map(item => item.id), finishing: false
  };
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', cancelDrag);
  window.addEventListener('resize', cancelDrag);
  event.preventDefault();
}

function updateDragPreview(): void {
  const session = dragSession;
  if (!session || session.finishing || !isDragging.value) return;
  const scroll = tabsRef.value?.$el.scrollLeft ?? session.scrollLeft;
  const offset = session.currentX - session.startX + scroll - session.scrollLeft;
  const preview = getTabDragPreview(session.layout, session.id, offset);
  session.order = preview.order;
  previewOffsets.value = preview.offsets;
  tabStore.updateDragOffset(offset);
}

function onDrag(event: MouseEvent): void {
  const session = dragSession;
  if (!session || session.finishing) return;
  session.currentX = event.clientX;
  if (!isDragging.value) {
    if (Math.abs(session.currentX - session.startX) < 5) return;
    isDragging.value = true;
    tabStore.startDrag(session.id);
  }
  updateDragPreview();
}

function removeDragListeners(): void {
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', endDrag);
  window.removeEventListener('blur', cancelDrag);
  window.removeEventListener('resize', cancelDrag);
}

function finishDrag(commit: boolean): void {
  const session = dragSession;
  if (!session || session.finishing) return;
  session.finishing = true;
  removeDragListeners();
  suppressClick = isDragging.value;
  // Preview already put neighbors in their final visual slots. Changing their
  // layout positions and resetting transforms must be one unanimated handoff.
  isSettling.value = isDragging.value;
  settlingTabId.value = isDragging.value ? session.id : null;
  if (commit && isDragging.value) {
    const from = session.layout.findIndex(tab => tab.id === session.id);
    const to = session.order.indexOf(session.id);
    const target = session.layout[to];
    if (target && from !== to) {
      const dragged = session.layout[from];
      const newLeft = session.layout[0].left + session.order.slice(0, to).reduce((left, id) =>
        left + session.layout.find(tab => tab.id === id)!.span, 0);
      // After committing, offsets must be relative to the new DOM positions.
      previewOffsets.value = new Map([[session.id, dragged.left + tabStore.dragOffsetX - newLeft]]);
      tabStore.reorderTabs(session.id, target.id);
    }
  }
  // Apply rebased transforms with transitions disabled after the DOM reorder.
  // Then animate only the dragged tab's remaining distance to its final slot.
  nextTick(() => {
    tabsRef.value?.$el.getBoundingClientRect();
    dragSession = null;
    previewOffsets.value = new Map();
    isDragging.value = false;
    tabStore.endDrag();
    nextTick(() => {
      if (!isSettling.value) return;
      // Keep FLIP disabled for the entire landing animation: unrelated renders
      // (for example the ripple) must not overwrite the dragged tab's transform.
      settleTimer = setTimeout(() => {
        settleTimer = null;
        settlingTabId.value = null;
        isSettling.value = false;
      }, 350);
    });
  });
}

function endDrag(event: MouseEvent): void {
  if (dragSession && !dragSession.finishing) {
    dragSession.currentX = event.clientX;
    updateDragPreview();
  }
  finishDrag(true);
}

function cancelDrag(): void {
  finishDrag(false);
}

// A tab can be added, hidden or removed while a mouse gesture is in progress.
watch(() => displayedTabs.value.filter(tab => !tab.isClosing).map(tab => tab.id).join(','), () => {
  if (dragSession && !dragSession.finishing) cancelDrag();
});

onBeforeUnmount(() => {
  removeDragListeners();
  if (settleTimer !== null) clearTimeout(settleTimer);
  isSettling.value = false;
  dragSession = null;
  tabStore.endDrag();
});

function pinLeavingTab(el: HTMLElement): void {
  // Freeze the outgoing tab in scroll-content coordinates before removing it
  // from flex layout. Vue can then animate the remaining tabs independently.
  const left = el.offsetLeft;
  const top = el.offsetTop;
  const width = el.getBoundingClientRect().width;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.minWidth = `${width}px`;
  el.style.boxSizing = 'border-box';
  el.style.position = 'absolute';
  el.style.pointerEvents = 'none';
}

const handleDelete = (tab: TabItem): void => {
  emit('onTabDelete', tab.key);
  tabStore.removeTab(tab.id);
};

const handleClick = (tab: TabItem): void => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (String(tab.id).startsWith('closing-')) {
    return;
  }
  tabStore.switchTab(tab.key);
  emit('onSwitchTabs', tab.id);
};

async function copyTabLink(tab: TabItem): Promise<void> {
  try {
    await writeText(getTabLink(tab));
  } catch (error) {
    errorService.handleError(error, '复制标签链接');
  }
}

// 标签右键菜单：统计目标两侧可关闭的标签数，用于禁用无效的批量关闭项
async function openTabContextMenu(event: MouseEvent, tab: TabItem): Promise<void> {
  if (tab.isClosing || String(tab.id).startsWith('closing-')) return;
  const ordered = tabStore.visibleTabs.filter((item: TabItem) => item.show);
  const targetIndex = ordered.findIndex((item: TabItem) => item.id === tab.id);
  const countSide = (from: number, to: number): number =>
    ordered.slice(from, to).filter((item: TabItem) => item.closable !== false).length;
  const countLeft = targetIndex >= 0 ? countSide(0, targetIndex) : 0;
  const countRight = targetIndex >= 0 ? countSide(targetIndex + 1, ordered.length) : 0;

  const result = await openContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'close', label: '关闭标签', icon: 'close', shortcut: 'Ctrl+W', disabled: tab.closable === false },
      { id: 'refresh', label: '刷新', icon: 'refresh', shortcut: 'F5' },
      { id: 'copy-link', label: '复制链接', icon: 'content_copy' },
      { separator: true },
      { id: 'close-others', label: '关闭其他标签', icon: 'tab_unselected', disabled: countLeft + countRight === 0 },
      { id: 'close-left', label: '关闭左侧标签', icon: 'keyboard_double_arrow_left', disabled: countLeft === 0 },
      { id: 'close-right', label: '关闭右侧标签', icon: 'keyboard_double_arrow_right', disabled: countRight === 0 }
    ]
  });
  if (!result) return;
  switch (result.id) {
    case 'close':
      handleDelete(tab);
      break;
    case 'refresh':
      emit('refresh', tab.id);
      break;
    case 'copy-link':
      await copyTabLink(tab);
      break;
    case 'close-others':
      tabStore.closeOtherTabs(tab.id);
      break;
    case 'close-left':
      tabStore.closeLeftTabs(tab.id);
      break;
    case 'close-right':
      tabStore.closeRightTabs(tab.id);
      break;
  }
}

// Backward compatibility methods (exposed for parent components)
const addTab = (
  key: string | number,
  icon: string,
  title: string,
  component: Component,
  props: Record<string, unknown>,
  icon_invert = false,
  show = true,
  desc = "",
  content = ""
): void => {
  tabStore.addTab({
    key: String(key),
    icon,
    title,
    component,
    props,
    icon_invert,
    show,
    desc: desc || title,
    content
  });
};

const getTab = (id: number): TabItem | undefined => {
  return tabStore.getTab(id);
};

const setTab = (id: number, tab: Partial<TabItem>): void => {
  tabStore.setTab(id, tab);
};

const setTitle = (key: string | number, title: string): void => {
  tabStore.updateTabMeta(key, { title });
};

const setIcon = (key: string | number, icon: string): void => {
  tabStore.updateTabMeta(key, { icon });
};

const getIconPath = (icon: string): string => {
  if (!icon) return '';
  if (icon.startsWith('http') || icon.startsWith('data:')) {
    return icon;
  }
  if (icon.startsWith('/')) {
    return icon;
  }
  try {
    return new URL(`${icon}`, import.meta.url).href;
  } catch (e) {
    console.error('Failed to load icon:', icon);
    return '/assets/vue.svg';
  }
};

const findIdByKey = (searchKey: string | number): number => {
  const tab = tabStore.tabs.find((t: TabItem) => t.key == searchKey);
  return tab ? (tab.id as number) : -1;
};

defineExpose({
  addTab,
  getTab,
  setTitle,
  setIcon,
  tabs: tabStore.tabs,
  handleClick,
  handleDelete,
  findIdByKey,
  setTab
});
</script>

<style scoped>
/* TransitionGroup checks a cloned child's computed transition. A different
   move-class alone does not disable FLIP: the child's inline `all` transition
   still passes that check and lets Vue erase our drag transform. */
.tab-drag-move {
  transition: none !important;
}

.tab-list-move {
  transition: transform 0.3s ease;
  position: relative;
  z-index: 1;
}

.tab-list-enter-active,
.tab-list-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.tab-list-enter-from,
.tab-list-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

#close {
  position: absolute;
  right: 10px;
}

#close:hover {
  opacity: 0.5;
}

.icon {
  width: 16px;
  height: 16px;
  border-radius: 16px;
}

.icon.invert {
  filter: invert(var(--invert));
}


.tabs {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

.tabs:hover {
  overflow-x: scroll;
}

.tab-ripplebutton:hover {
  background-color: rgba(var(--text-color), 0.1);
}

.tab-ripplebutton {
  text-align: left;
  background-color: transparent;
  border: none;
  box-shadow: none;
  padding: 5px 10px;
  font-size: 13px;
  font-weight: normal;
  height: 35px;
  width: 180px;
  margin-right: 5px;
  min-width: 100px;
  transition: transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease;
  touch-action: none;
  position: relative;
}

:root.dark .tab-ripplebutton {
  background-color: transparent;
}

:root.dark .tab-ripplebutton.selected {
  background-color: rgba(var(--text-color), 0.1);
}

.tab-ripplebutton.closing {
  opacity: 0;
  width: 0;
  padding: 0;
  margin: 0;
  overflow: hidden;
  transform: translateX(-30px);
  pointer-events: none;
  position: absolute;
}

.tab-ripplebutton.dragging {
  opacity: 0.9;
  background-color: rgba(var(--text-color), 0.2);
  user-select: none;
  pointer-events: none;
  transition: none !important;
  will-change: transform;
}

.tab-content {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
}

.title {
  left: 35px;
  width: calc(100% - 60px);
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  -webkit-mask-image: linear-gradient(to right, black, black, black, black, transparent);
  mask-image: linear-gradient(to right, black, black, black, black, transparent);
}


.ripple-button-title {
  font-size: 13px;
  margin-top: 5px;
}

.tab-ripplebutton.selected {
  background-color: rgba(var(--text-color), 0.1);
  box-shadow: none;
  font-weight: bold;
}

.tab-ripplebutton.show {
  display: none;
}

#RippleButton {
  background-color: transparent;
  box-shadow: none;
  padding: 10px 5px;
}

.material-symbols-outlined {
  font-variation-settings:
    'FILL' 0,
    'wght' 100,
    'GRAD' 0,
    'opsz' 24
}
</style>
