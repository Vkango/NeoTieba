<template>
  <div ref="rootRef" class="tab-strip" data-tauri-drag-region @contextmenu.prevent="openPaneContextMenu($event)">
    <!-- 窄分屏：标签条退化为只读的当前页展示（其余标签以左右方向书签形式贴在分屏边缘，见 App.vue） -->
    <div v-if="narrow" class="tab-strip-compact" data-tauri-drag-region>
      <template v-if="activeStripTab">
        <img class="icon" :class="{ 'invert': activeStripTab.icon_invert }" :src="getIconPath(activeStripTab.icon)"
          referrerpolicy="no-referrer" />
        <div class="pane-current-title">{{ activeStripTab.title }}</div>
      </template>
    </div>
    <HorizontalMaskScroll v-else ref="maskRef" class="tab-strip-mask" :fade-width="16"
      data-tauri-drag-region @scroll="updateDragPreview">
      <transition-group ref="stripRef" name="tab-list"
        :move-class="isDragging || isSettling ? 'tab-drag-move' : 'tab-list-move'" tag="div" class="tab-strip-tabs"
        data-tauri-drag-region
        @before-leave="(el: Element) => pinLeavingTab(el as HTMLElement)">
      <RippleButton class="tab-ripplebutton" v-for="tab in stripTabs" :class="{
        'selected': tabStore.isTabVisibleInPane(tab),
        'invert': tab.icon_invert,
        'dragging': tabStore.draggingTabId === tab.id,
        'closing': tab.isClosing
      }" :key="tab.id" :data-tab-id="tab.id" @click="handleClick(tab)" @mousedown.stop="startDrag($event, tab)"
        @contextmenu.prevent.stop="openTabContextMenu($event, tab)" :style="getTabStyle(tab)">
        <div class="tab-content">
          <img class="icon" :class="{ 'invert': tab.icon_invert }" :src="getIconPath(tab.icon)"
            referrerpolicy="no-referrer" />
          <div class="title">{{ tab.title }}</div>
          <span v-if="tab.closable !== false" class="material-symbols-outlined" id="close" style="font-size: 12px;"
            @click.stop="handleDelete(tab)">close</span>
        </div>
        <!-- 主分屏标识（仅固定主分屏模式显示）：竖线绝对定位在标签左侧，不参与内容布局 -->
        <span v-if="isMain && tabStore.splitOpenMode === 'main' && tabStore.isTabVisibleInPane(tab)"
          class="main-indicator"></span>
      </RippleButton>
      </transition-group>
    </HorizontalMaskScroll>
  </div>
</template>

<script setup lang="ts">
import type { SplitDropZone, TabItem } from '@/types/common';
import { computed, inject, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useTabStore } from '@/stores/tabs';
import { useCollectionStore, DEFAULT_GROUP_ID } from '@/stores/collection';
import RippleButton from '#components/common/RippleButton.vue';
import HorizontalMaskScroll from '#components/common/HorizontalMaskScroll.vue';
import { getTabDragPreview, type DragTabLayout } from './tab-drag';
import { openContextMenu, type ContextMenuItem } from '@/utils/contextMenu';
import { getTabLink } from '@/utils/tab-link';
import { tabToCollectionPayload } from '@/utils/collection-capture';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { errorService } from '@/core/error-service';
import { beginSplitDrag, endSplitDrag } from '@/composables/useSplitDragOverlay';

const props = defineProps<{ groupId: string }>();
const emit = defineEmits<{ (e: 'narrowChange', groupId: string, narrow: boolean): void }>();

const tabStore = useTabStore();
const collectionStore = useCollectionStore();
const sendToast = inject<(title: string, duration?: number) => void>('sendToast');

const stripTabs = computed(() => tabStore.groupTabs(props.groupId).filter(tab => tab.show));
const isMain = computed(() => props.groupId === tabStore.mainGroupId);

/* 标签宽度直接限制：实测标签条宽度后按「(条宽 - 公摊) ÷ 标签数」硬性限宽，
   分屏再窄标签也不会互相重叠或压到邻屏 */
const stripWidth = ref(0);
let stripResizeObserver: ResizeObserver | null = null;

const TAB_MAX_WIDTH = 180;
const TAB_MIN_WIDTH = 56;
/** 公摊：右侧预留空白，最后一个标签不贴分屏边界 */
const TAB_WIDTH_RESERVE = 24;
/** 窄分屏阈值：标签条宽度不足页面宽度的该比例时收起标签
 *  （当前页只读展示 + 左右方向书签），宽度恢复后标签条自动回来 */
const NARROW_PANE_RATIO = 0.25;

const narrow = computed(() => {
  if (!stripWidth.value) return false;
  const pageWidth = document.documentElement.clientWidth || window.innerWidth;
  return stripWidth.value / Math.max(pageWidth, 1) < NARROW_PANE_RATIO;
});
watch(narrow, (isNarrow) => emit('narrowChange', props.groupId, isNarrow), { immediate: true });

/** 窄分屏顶部展示的当前页 */
const activeStripTab = computed(() =>
  stripTabs.value.find(tab => tabStore.isTabVisibleInPane(tab)) ?? stripTabs.value[0] ?? null);

const tabWidth = computed(() => {
  if (!stripWidth.value) return TAB_MAX_WIDTH;
  const n = Math.max(stripTabs.value.length, 1);
  return Math.max(TAB_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, Math.floor((stripWidth.value - TAB_WIDTH_RESERVE) / n)));
});

/** 根元素：宽度测量必须挂在它身上而非 transition-group——
 *  窄分屏模式下标签列表会被卸载，挂在上面就再也量不到恢复 */
const rootRef = ref<HTMLElement | null>(null);
const stripRef = ref<{ $el: HTMLElement } | null>(null);
/** 标签条横向滚动容器（HorizontalMaskScroll 根元素）：拖拽补偿与矩形命中都以它为准 */
const maskRef = ref<{ $el: HTMLElement } | null>(null);

function scrollContainerEl(): HTMLElement | null {
  return maskRef.value?.$el ?? stripRef.value?.$el ?? null;
}
const isDragging = ref(false);
const isSettling = ref(false);
const settlingTabId = ref<number | null>(null);
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const previewOffsets = ref(new Map<number, number>());
interface DragSessionShape {
  id: number;
  startX: number;
  currentX: number;
  scrollLeft: number;
  layout: DragTabLayout[];
  order: number[];
  finishing: boolean;
}
let dragSession: DragSessionShape | null = null;
let suppressClick = false;

onMounted(() => {
  const el = rootRef.value;
  if (!el) return;
  stripWidth.value = el.clientWidth;
  stripResizeObserver = new ResizeObserver((entries) => {
    stripWidth.value = entries[0]?.contentRect.width ?? 0;
  });
  stripResizeObserver.observe(el);
});

function getTabStyle(tab: TabItem): Record<string, string> {
  const isTabDragging = tabStore.draggingTabId === tab.id && isDragging.value;

  return {
    width: `${tabWidth.value}px`,
    maxWidth: `${tabWidth.value}px`,
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
  const container = scrollContainerEl();
  if (!container) return;
  suppressClick = false;
  const elements = Array.from(container.querySelectorAll<HTMLElement>('.tab-ripplebutton'))
    .filter(el => !el.classList.contains('closing'));
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
  const scroll = scrollContainerEl()?.scrollLeft ?? session.scrollLeft;
  const offset = session.currentX - session.startX + scroll - session.scrollLeft;
  const preview = getTabDragPreview(session.layout, session.id, offset);
  session.order = preview.order;
  previewOffsets.value = preview.offsets;
  tabStore.updateDragOffset(offset);
}

// 拖拽悬停到左侧集锦头像栏（70px 导航条）时冻结预览并高亮
const isOverCollectionRail = (event: MouseEvent): boolean => event.clientX <= 70;

/* ---------------- 分屏拖拽落点：内容区右缘 = 新建分屏，其他分屏 = 移入 ---------------- */

/** 内容区右缘「新建分屏」竖条宽度（px） */
const SPLIT_STRIP_WIDTH = 90;

function contentEl(): HTMLElement | null {
  return document.querySelector('#container > .container');
}

function appRootEl(): HTMLElement | null {
  return stripRef.value?.$el?.closest('#container') ?? null;
}

function splitZoneFromEvent(event: MouseEvent): SplitDropZone | null {
  if (event.clientX <= 70) return null;
  const content = contentEl();
  if (!content) return null;

  // 光标正下方的提示胶囊本身就是投放热区：拖入胶囊 = 直接执行该操作
  const label = document.elementFromPoint(event.clientX, event.clientY)?.closest('.pane-drop-label');
  if (label) {
    const hostGroupId = label.closest('.pane-drop-highlight')?.getAttribute('data-group-id');
    return hostGroupId ? { type: 'move', groupId: hostGroupId } : { type: 'create' };
  }

  // 屏幕右缘竖条（标签栏以下整条）= 新建分屏
  const rect = content.getBoundingClientRect();
  if (event.clientY > 47 && event.clientX >= rect.right - SPLIT_STRIP_WIDTH) {
    return { type: 'create' };
  }

  // 命中（或就近）其他分屏的顶部标签条或内容格 → 移入该组
  const root = appRootEl();
  if (!root) return null;
  const slots = Array.from(root.querySelectorAll<HTMLElement>('[data-group-id]'));
  let nearest: HTMLElement | null = null;
  let nearestDist = Infinity;
  for (const slot of slots) {
    if (slot.dataset.groupId === props.groupId) continue;
    const sr = slot.getBoundingClientRect();
    if (event.clientX >= sr.left && event.clientX <= sr.right
      && event.clientY >= sr.top && event.clientY <= sr.bottom) {
      nearest = slot;
      nearestDist = 0;
      break;
    }
    const dy = event.clientY < sr.top ? sr.top - event.clientY
      : (event.clientY > sr.bottom ? event.clientY - sr.bottom : 0);
    const dx = event.clientX < sr.left ? sr.left - event.clientX
      : (event.clientX > sr.right ? event.clientX - sr.right : 0);
    const dist = Math.max(dx, dy * 2);
    if (dist < nearestDist) {
      nearest = slot;
      nearestDist = dist;
    }
  }
  if (!nearest) return null;
  const groupId = nearest.dataset.groupId;
  if (!groupId || groupId === props.groupId) return null;

  // 悬停在目标标签条上时按指针位置计算插入点
  let beforeKey: string | undefined;
  const tabsEl = nearest.classList.contains('tab-strip-tabs')
    ? nearest
    : nearest.querySelector<HTMLElement>('.tab-strip-tabs');
  if (tabsEl) {
    for (const el of Array.from(tabsEl.querySelectorAll<HTMLElement>('.tab-ripplebutton'))) {
      const r = el.getBoundingClientRect();
      const tabId = Number(el.dataset.tabId);
      if (event.clientX < r.left + r.width / 2) {
        beforeKey = tabId ? tabStore.getTab(tabId)?.key : undefined;
        break;
      }
    }
  }
  return { type: 'move', groupId, beforeKey };
}

function onDrag(event: MouseEvent): void {
  const session = dragSession;
  if (!session || session.finishing) return;
  session.currentX = event.clientX;
  tabStore.dragOverCollection = isOverCollectionRail(event);
  if (!isDragging.value) {
    if (Math.abs(session.currentX - session.startX) < 5) return;
    isDragging.value = true;
    tabStore.startDrag(session.id);
    // 拖拽一开始就点亮头像栏提示（不可加入的标签不高亮，仅禁止光标）
    const draggedTab = tabStore.getTab(session.id);
    tabStore.collectionDragEligible = !!draggedTab && !!tabToCollectionPayload(draggedTab);
    tabStore.collectionDragActive = true;
    // 拖拽开始：立即高亮所有落区并在落区旁显示提示胶囊
    beginSplitDrag(props.groupId);
  }
  if (tabStore.dragOverCollection) {
    tabStore.splitDropZone = null;
    return;
  }
  // 自己的标签条内 → 排序预览；最后一个标签右侧的空白 → 新建分屏
  const stripRect = scrollContainerEl()?.getBoundingClientRect();
  const overOwnStrip = !!stripRect
    && event.clientX >= stripRect.left && event.clientX <= stripRect.right
    && event.clientY >= stripRect.top && event.clientY <= stripRect.bottom;
  if (overOwnStrip) {
    const tabEls = stripRef.value?.$el.querySelectorAll<HTMLElement>('.tab-ripplebutton');
    const last = tabEls && tabEls.length ? tabEls[tabEls.length - 1] : undefined;
    const overBlank = !last || event.clientX > last.getBoundingClientRect().right + 12;
    if (overBlank) {
      tabStore.splitDropZone = { type: 'create' };
      return;
    }
    tabStore.splitDropZone = null;
    updateDragPreview();
    return;
  }
  const zone = splitZoneFromEvent(event);
  tabStore.splitDropZone = zone;
  if (zone) return; // 悬停其他分屏/右缘：冻结排序预览，显示落点
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
  const droppedOnCollection = tabStore.dragOverCollection;
  const dropZone = tabStore.splitDropZone;
  tabStore.dragOverCollection = false;
  tabStore.splitDropZone = null;
  tabStore.collectionDragActive = false;
  tabStore.collectionDragEligible = false;
  endSplitDrag();
  suppressClick = isDragging.value;
  // Preview already put neighbors in their final visual slots. Changing their
  // layout positions and resetting transforms must be one unanimated handoff.
  isSettling.value = isDragging.value;
  settlingTabId.value = isDragging.value ? session.id : null;
  if (commit && isDragging.value && droppedOnCollection) {
    // 拖放到左侧头像栏：加入集锦，而不是重排标签
    addTabToCollection(session.id);
  } else if (commit && isDragging.value && dropZone) {
    // 拖放到内容区：右缘 = 新建分屏；其他分屏 = 移入该组
    if (dropZone.type === 'create') {
      tabStore.splitTabToNewGroup(session.id);
    } else {
      tabStore.moveTabToGroup(session.id, dropZone.groupId, dropZone.beforeKey);
    }
  } else if (commit && isDragging.value) {
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
    stripRef.value?.$el?.getBoundingClientRect();
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
watch(() => stripTabs.value.filter(tab => !tab.isClosing).map(tab => tab.id).join(','), () => {
  if (dragSession && !dragSession.finishing) cancelDrag();
});

onBeforeUnmount(() => {
  removeDragListeners();
  if (stripResizeObserver) {
    stripResizeObserver.disconnect();
    stripResizeObserver = null;
  }
  if (settleTimer !== null) clearTimeout(settleTimer);
  isSettling.value = false;
  dragSession = null;
  tabStore.dragOverCollection = false;
  tabStore.collectionDragActive = false;
  tabStore.collectionDragEligible = false;
  endSplitDrag();
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

const handleClick = (tab: TabItem): void => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  tabStore.switchTab(tab.key);
};

const handleDelete = (tab: TabItem): void => {
  tabStore.removeTab(tab.id);
};

function closePane(): void {
  if (tabStore.groups.length > 1) tabStore.closeGroup(props.groupId);
}

async function copyTabLink(tab: TabItem): Promise<void> {
  try {
    await writeText(getTabLink(tab));
  } catch (error) {
    errorService.handleError(error, '复制标签链接');
  }
}

/** 把标签加入集锦；groupId 传 'new' 表示新建分组 */
function addTabToCollection(idOrTab: number | string | TabItem, groupId?: string): void {
  const tab = typeof idOrTab === 'object'
    ? idOrTab
    : tabStore.getTab(idOrTab);
  if (!tab) return;
  const payload = tabToCollectionPayload(tab);
  if (!payload) {
    sendToast?.('页面尚未加载完成，或该标签类型不支持加入集锦', 2500);
    return;
  }
  let targetGroupId = groupId;
  if (targetGroupId === 'new') {
    if (collectionStore.itemExists(payload.type, payload.target)) targetGroupId = undefined;
    else targetGroupId = collectionStore.addGroup().id;
  }
  const result = collectionStore.addItem(payload, targetGroupId || DEFAULT_GROUP_ID);
  sendToast?.(result.created
    ? `已添加到集锦「${result.groupName}」`
    : `已存在于集锦「${result.groupName}」`, 2500);
}

const collectionMenuChildren = (): ContextMenuItem[] => [
  ...collectionStore.orderedGroups.map(group => ({
    id: `add-collection:${group.id}`,
    label: group.name,
    icon: 'folder'
  })),
  { separator: true },
  { id: 'add-collection:new', label: '新建分组', icon: 'add' }
];

// 标签右键菜单：统计目标两侧可关闭的标签数，用于禁用无效的批量关闭项。
// 关闭左侧/右侧标签只在同一分屏组内生效，计数也按组内统计
async function openTabContextMenu(event: MouseEvent, tab: TabItem): Promise<void> {
  if (tab.isClosing) return;
  const ordered = tabStore.visibleTabs.filter((item: TabItem) => item.show);
  const inGroup = ordered.filter((item: TabItem) => item.groupId === tab.groupId);
  const targetIndexInGroup = inGroup.findIndex((item: TabItem) => item.id === tab.id);
  const countSide = (list: TabItem[], from: number, to: number): number =>
    list.slice(from, to).filter((item: TabItem) => item.closable !== false).length;
  // 关闭其他标签：跨组统计所有可关闭标签（不含目标自己）
  const countOthers = ordered.filter((item: TabItem) => item.id !== tab.id && item.closable !== false).length;
  const countLeft = targetIndexInGroup >= 0 ? countSide(inGroup, 0, targetIndexInGroup) : 0;
  const countRight = targetIndexInGroup >= 0 ? countSide(inGroup, targetIndexInGroup + 1, inGroup.length) : 0;
  const collectionPayload = tabToCollectionPayload(tab);

  const gi = tabStore.groups.findIndex(g => g.id === tab.groupId);
  const hasLeftGroup = gi > 0;
  const hasRightGroup = gi >= 0 && gi < tabStore.groups.length - 1;
  const anyHiddenGroups = tabStore.groups.some(g => g.hidden);
  const singleGroup = tabStore.groups.length <= 1;
  /** 自己是唯一可见分组时不可隐藏（屏幕上必须保留至少一个页面） */
  const selfIsOnlyVisible = gi >= 0 && !tabStore.groups[gi].hidden
    && !tabStore.groups.some((g, i) => i !== gi && !g.hidden);

  const result = await openContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'close', label: '关闭标签', icon: 'close', shortcut: 'Ctrl+W', disabled: tab.closable === false },
      { id: 'refresh', label: '刷新', icon: 'refresh', shortcut: 'F5' },
      { id: 'copy-link', label: '复制链接', icon: 'content_copy' },
      {
        id: 'add-collection',
        label: '添加到集锦',
        icon: 'collections_bookmark',
        disabled: !collectionPayload,
        children: collectionPayload ? collectionMenuChildren() : undefined
      },
      { separator: true },
      {
        id: 'split',
        label: '分屏',
        icon: 'splitscreen',
        children: [
          { id: 'split-new', label: '在右侧新分屏打开', icon: 'splitscreen' },
          { id: 'swap-left', label: '与左边交换', icon: 'swap_horiz', disabled: !hasLeftGroup || anyHiddenGroups },
          { id: 'swap-right', label: '与右边交换', icon: 'swap_horiz', disabled: !hasRightGroup || anyHiddenGroups },
          {
            id: 'set-main-group',
            label: '设为主分屏',
            icon: 'push_pin',
            disabled: !tab.groupId || tab.groupId === tabStore.mainGroupId
          },
          { separator: true },
          { id: 'hide-self-group', label: '隐藏此分组', icon: 'visibility_off', disabled: selfIsOnlyVisible },
          { id: 'hide-left-groups', label: '隐藏左边全部分组', icon: 'visibility_off', disabled: !hasLeftGroup },
          { id: 'hide-right-groups', label: '隐藏右边全部分组', icon: 'visibility_off', disabled: !hasRightGroup },
          { id: 'hide-other-groups', label: '隐藏其他分组', icon: 'visibility_off', disabled: singleGroup },
          { separator: true },
          { id: 'close-group', label: '关闭此分屏', icon: 'tab_close', disabled: singleGroup }
        ]
      },
      { separator: true },
      {
        id: 'open-mode',
        label: '新标签打开位置',
        icon: 'input',
        children: [
          { id: 'open-mode-auto', label: '自动分屏', icon: 'auto_awesome', checked: tabStore.splitOpenMode === 'auto' },
          { id: 'open-mode-main', label: '固定主分屏', icon: 'push_pin', checked: tabStore.splitOpenMode === 'main' }
        ]
      },
      {
        id: 'batch-close',
        label: '批量关闭',
        icon: 'tab_unselected',
        children: [
          { id: 'close-others', label: '关闭其他标签', icon: 'tab_unselected', disabled: countOthers === 0 },
          { id: 'close-left', label: '关闭左侧标签', icon: 'keyboard_double_arrow_left', disabled: countLeft === 0 },
          { id: 'close-right', label: '关闭右侧标签', icon: 'keyboard_double_arrow_right', disabled: countRight === 0 }
        ]
      }
    ]
  });
  if (!result) return;
  if (result.id?.startsWith('add-collection:')) {
    addTabToCollection(tab, result.id.slice('add-collection:'.length));
    return;
  }
  switch (result.id) {
    case 'close':
      handleDelete(tab);
      break;
    case 'refresh':
      tabStore.refreshTab(tab.key);
      break;
    case 'copy-link':
      await copyTabLink(tab);
      break;
    case 'split-new':
      tabStore.splitTabToNewGroup(tab.id);
      break;
    case 'swap-left':
    case 'swap-right': {
      if (!tab.groupId) break;
      const idx = tabStore.groups.findIndex(g => g.id === tab.groupId);
      const otherIdx = result.id === 'swap-left' ? idx - 1 : idx + 1;
      const other = tabStore.groups[otherIdx];
      if (other && tabStore.groups[idx]) {
        tabStore.swapAdjacentGroups(
          result.id === 'swap-left' ? other.id : tab.groupId,
          result.id === 'swap-left' ? tab.groupId : other.id
        );
      }
      break;
    }
    case 'hide-self-group':
      if (tab.groupId) tabStore.setHidden(tab.groupId, true);
      break;
    case 'hide-left-groups':
      if (tab.groupId) tabStore.hideGroupsLeftOf(tab.groupId);
      break;
    case 'hide-right-groups':
      if (tab.groupId) tabStore.hideGroupsRightOf(tab.groupId);
      break;
    case 'hide-other-groups':
      if (tab.groupId) tabStore.hideOtherGroups(tab.groupId);
      break;
    case 'set-main-group':
      if (tab.groupId) tabStore.setMainGroup(tab.groupId);
      break;
    case 'close-group':
      if (tab.groupId) tabStore.closeGroup(tab.groupId);
      break;
    case 'open-mode-auto':
      tabStore.setSplitOpenMode('auto');
      break;
    case 'open-mode-main':
      tabStore.setSplitOpenMode('main');
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

/** 分屏标签条空白处右键：设为主分屏 / 关闭此分屏 */
async function openPaneContextMenu(event: MouseEvent): Promise<void> {
  if ((event.target as HTMLElement).closest('.tab-ripplebutton')) return;
  const result = await openContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'pane-set-main', label: '设为主分屏', icon: 'push_pin', disabled: isMain.value },
      { id: 'pane-close', label: '关闭此分屏', icon: 'tab_close', disabled: tabStore.groups.length <= 1 }
    ]
  });
  if (!result) return;
  if (result.id === 'pane-set-main') tabStore.setMainGroup(props.groupId);
  else if (result.id === 'pane-close') closePane();
}

function getIconPath(icon: string): string {
  if (!icon) return '';
  if (icon.startsWith('http') || icon.startsWith('data:') || icon.startsWith('/')) {
    return icon;
  }
  try {
    return new URL(`${icon}`, import.meta.url).href;
  } catch (e) {
    console.error('Failed to load icon:', icon);
    return '/assets/vue.svg';
  }
}
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

.tab-strip {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  user-select: none;
}

/* 滚动外壳（HorizontalMaskScroll）：占满标签条，横向滚动由它负责 */
.tab-strip-mask {
  flex: 1 1 auto;
  min-width: 0;
}

.tab-strip-tabs {
  flex: 0 0 auto;
  min-width: 100%;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

/* 窄分屏的紧凑标签条：只读展示当前页图标+标题，不响应点击/拖拽，
   空白处保留拖动窗口与分屏右键菜单 */
.tab-strip-compact {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  height: 35px;
  overflow: hidden;
  cursor: default;
}

.tab-strip-compact .icon {
  flex: 0 0 auto;
}

/* 独立类名：组件内还有一个给标签按钮用的全局 .title 规则
   （position:absolute; left:35px），会把这个标题定位飞到标签条左缘 */
.tab-strip-compact .pane-current-title {
  font-size: 13px;
  min-width: 0;
  flex: 0 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}

/* 主分屏标识：选中标签左侧的圆角竖线（主题色），绝对定位不占布局空间 */
.main-indicator {
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background-color: rgb(var(--primary-color));
  pointer-events: none;
}

.material-symbols-outlined {
  font-variation-settings:
    'FILL' 0,
    'wght' 100,
    'GRAD' 0,
    'opsz' 24
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
  /* 宽度由 getTabStyle 按标签条实测宽度内联限制（不超过 180px，留公摊） */
  flex: 0 0 auto;
  margin-right: 5px;
  transition: transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease;
  touch-action: none;
  position: relative;
  overflow: hidden;
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

.tab-ripplebutton.selected {
  background-color: rgba(var(--text-color), 0.1);
  box-shadow: none;
  font-weight: bold;
}

#RippleButton {
  background-color: transparent;
  box-shadow: none;
  padding: 10px 5px;
}
</style>
