<template>
  <div ref="railRef" class="collection-rail" :class="{
    'drag-over': tabStore.dragOverCollection,
    'drag-ready': showDragHint,
    'drag-ban': showDragBan
  }">
    <VerticalMaskScroll v-if="settingsStore.showCollectionRail" class="rail-scroll" :gap="15" :fade-width="18">
      <button v-for="item in collectionStore.orderedItems" :key="item.id" type="button" class="rail-item"
        :class="{ 'active': item.id === activeItemId, 'dragging': draggingId === item.id }"
        :data-item-id="item.id" @click="openItem(item)" @mousedown="onItemMouseDown($event, item)"
        @mouseenter="showItemTip($event, item)" @mouseleave="hideItemTip"
        @contextmenu.prevent="openItemContextMenu($event, item)">
        <CollectionAvatar :type="item.type" :user-icon="item.userIcon" :bar-icon="item.barIcon" :size="34" />
      </button>
    </VerticalMaskScroll>
    <Teleport to="body">
      <Transition name="rail-tip">
        <div v-if="capsule.visible" class="dynamic-island-pill rail-capsule"
          :style="{ left: `${capsule.x}px`, top: `${capsule.y}px` }">
          <span class="material-symbols-outlined">collections_bookmark</span>拖动至此添加到集锦
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import CollectionAvatar from '#components/collection/CollectionAvatar.vue';
import VerticalMaskScroll from '#components/common/VerticalMaskScroll.vue';
import { useCollectionStore, type CollectionItem } from '@/stores/collection';
import { useSettingsStore } from '@/stores/settings';
import { useTabStore } from '@/stores/tabs';
import { useTabNavigation } from '@/composables/useTabNavigation';
import {
  beginCollectionDrag, endCollectionDrag, hideCollectionCapsule, isOverCollectionDeleteZone,
  setCollectionDragDeleteHovered, showCollectionCapsule, updateCollectionCapsule
} from '@/composables/useCollectionDragOverlay';
import { openContextMenu } from '@/utils/contextMenu';
import { activeTabCollectionId } from '@/utils/collection-capture';

const collectionStore = useCollectionStore();
const settingsStore = useSettingsStore();
const tabStore = useTabStore();
const { openThread, openBar, openUser } = useTabNavigation();

const activeItemId = computed<string | null>(() => {
  const tab = tabStore.currentTab;
  return tab ? activeTabCollectionId(tab) : null;
});

// 拖拽标签时头像栏的即时反馈：可加入→亮框+胶囊；不可加入→仅禁止光标
const showDragHint = computed(() => tabStore.collectionDragActive && tabStore.collectionDragEligible);
const showDragBan = computed(() => tabStore.collectionDragActive && !tabStore.collectionDragEligible);

const railRef = ref<HTMLElement | null>(null);
const capsule = reactive({ visible: false, x: 0, y: 0 });

// ---- 条目拖拽：排序（组内/跨组）+ 拖到删除区移除，胶囊展示当前分组名 ----
const draggingId = ref<string | null>(null);
let dragSession: { id: string; groupId: string; moved: boolean } | null = null;
let dragStartX = 0;
let dragStartY = 0;
let suppressClick = false;

function railItemElement(itemId: string): HTMLElement | null {
  return railRef.value?.querySelector(`.rail-item[data-item-id="${CSS.escape(itemId)}"]`) ?? null;
}

/** 计算放下位置：目标分组 + 该分组内插入下标（语义与 reorderItem 的 targetIndex 一致） */
function computeDropTarget(session: { id: string; groupId: string }, cursorY: number): { groupId: string; index: number } {
  const others = collectionStore.orderedItems.filter(item => item.id !== session.id);
  let insertAt = others.length;
  for (let i = 0; i < others.length; i += 1) {
    const el = railItemElement(others[i].id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (cursorY < rect.top + rect.height / 2) {
      insertAt = i;
      break;
    }
  }
  // 插到哪个条目前就落入哪个条目所在分组；末尾则跟随最后一个可见条目的分组
  const before = others[insertAt] || others[others.length - 1];
  if (!before) return { groupId: session.groupId, index: 0 };
  const siblings = (collectionStore.itemsByGroup[before.groupId] || [])
    .filter(item => item.id !== session.id);
  const index = siblings.findIndex(item => item.id === before.id);
  return { groupId: before.groupId, index: index < 0 ? siblings.length : index };
}

function onItemMouseDown(event: MouseEvent, item: CollectionItem): void {
  if (event.button !== 0) return;
  dragSession = { id: item.id, groupId: item.groupId, moved: false };
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  event.preventDefault();
}

function onDragMove(event: MouseEvent): void {
  const session = dragSession;
  if (!session) return;
  if (!session.moved) {
    if (Math.abs(event.clientX - dragStartX) < 4 && Math.abs(event.clientY - dragStartY) < 4) return;
    session.moved = true;
    draggingId.value = session.id;
    beginCollectionDrag(true);
  }
  const title = collectionStore.items.find(item => item.id === session.id)?.title || '';
  updateCollectionCapsule(event.clientX + 14, event.clientY, collectionStore.groupName(session.groupId), title);
  const overZone = isOverCollectionDeleteZone(event.clientX, event.clientY);
  setCollectionDragDeleteHovered(overZone);
  if (overZone) return; // 悬停删除区时冻结排序预览
  // 光标离开头像栏后冻结排序：拖出去删除的路径上不产生交换
  const railRect = railRef.value?.getBoundingClientRect();
  if (!railRect || event.clientX < railRect.left || event.clientX > railRect.right
    || event.clientY < railRect.top || event.clientY > railRect.bottom) {
    return;
  }
  const target = computeDropTarget(session, event.clientY);
  if (target.groupId !== session.groupId) {
    if (!collectionStore.moveItem(session.id, target.groupId)) return;
    session.groupId = target.groupId;
    updateCollectionCapsule(event.clientX + 14, event.clientY, collectionStore.groupName(target.groupId));
  }
  collectionStore.reorderItem(session.id, target.index);
}

function onDragEnd(event: MouseEvent): void {
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  const session = dragSession;
  dragSession = null;
  if (session?.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (isOverCollectionDeleteZone(event.clientX, event.clientY)) {
      collectionStore.removeItem(session.id);
    }
  }
  draggingId.value = null;
  endCollectionDrag();
  hideCollectionCapsule();
}

watch(showDragHint, (visible) => {
  if (!visible) {
    capsule.visible = false;
    return;
  }
  const el = railRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  capsule.x = rect.right + 12;
  capsule.y = rect.top + rect.height / 2;
  capsule.visible = true;
});

// 悬停/拖拽共用双行胶囊（上行分组名、下行标题），渲染在全局浮层
function showItemTip(event: MouseEvent, item: CollectionItem): void {
  // 拖拽中胶囊由拖拽逻辑接管
  if (draggingId.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  showCollectionCapsule(rect.right + 10, rect.top + rect.height / 2,
    collectionStore.groupName(item.groupId), item.title);
}

function hideItemTip(): void {
  // 拖拽中不因条目 shuffle 触发的 mouseleave 闪隐
  if (draggingId.value) return;
  hideCollectionCapsule();
}

function openItem(item: CollectionItem): void {
  // 拖拽结束后的 click 不触发打开
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  hideCollectionCapsule();
  // 已激活条目再次点击：开关集锦面板
  if (item.id === activeItemId.value) {
    collectionStore.toggleDrawer();
    return;
  }
  if (item.type === 'thread') openThread(item.target);
  else if (item.type === 'bar') openBar(item.target);
  else openUser(item.target);
}

async function openItemContextMenu(event: MouseEvent, item: CollectionItem): Promise<void> {
  hideCollectionCapsule();
  const result = await openContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'open', label: '打开', icon: 'open_in_new' },
      { id: 'open-drawer', label: '打开集锦', icon: 'collections_bookmark' },
      { separator: true },
      { id: 'remove', label: '从集锦移除', icon: 'delete', destructive: true }
    ]
  });
  if (!result) return;
  switch (result.id) {
    case 'open':
      openItem(item);
      break;
    case 'open-drawer':
      collectionStore.openDrawer();
      break;
    case 'remove':
      collectionStore.removeItem(item.id);
      break;
  }
}
</script>

<style scoped>
/* 顶部加大与固定菜单的间距；滚动由 VerticalMaskScroll 接管（无滚动条 + 上下渐隐）。
   提示框画在本层（不参与滚动容器的 mask），避免上下边框被渐隐遮罩淡出。 */
.collection-rail {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 0;
  padding: 22px 0 10px;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}

/* 0 1 auto：高度随内容收缩并贴底；空间不足时 min-height:0 允许压缩并启用内部滚动 */
.rail-scroll {
  flex: 0 1 auto;
  min-height: 0;
}

.collection-rail.drag-ready,
.collection-rail.drag-over {
  background-color: rgba(var(--text-color), 0.08);
  box-shadow: inset 0 0 0 1.5px rgba(var(--text-color), 0.35);
  border-radius: 8px;
}

/* 不可加入集锦的标签拖入时显示禁止光标，且不亮框不出胶囊 */
.collection-rail.drag-ban,
.collection-rail.drag-ban .rail-item {
  cursor: not-allowed;
}

/* 条目拖拽中：半透明 + 抓取光标 */
.rail-item.dragging {
  opacity: 0.5;
  cursor: grabbing;
}

/* 与导航按钮一致：占满 70px 栏宽，内容居中，保证与导航图标同一中轴线 */
.rail-item {
  flex: 0 0 auto;
  width: 100%;
  height: 42px;
  padding: 4px 0;
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  cursor: pointer;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 未激活条目半透明，避免牵引视线；激活与悬停时不透明 */
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.rail-item:hover,
.rail-item.active {
  opacity: 1;
}

/* 悬停标题气泡与拖拽引导胶囊：外观走全局 .dynamic-island-pill，这里只管定位 */
.rail-tip-enter-active,
.rail-tip-leave-active {
  transition: opacity 0.15s ease;
}

.rail-tip-enter-from,
.rail-tip-leave-to {
  opacity: 0;
}

/* 拖拽标签时出现的引导胶囊：外观走全局 .dynamic-island-pill，这里只管定位 */
.rail-capsule {
  position: fixed;
  z-index: 2600;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
}

.rail-capsule .material-symbols-outlined {
  font-size: 15px;
}
</style>
