<template>
  <div ref="railRef" class="collection-rail" :class="{
    'drag-over': tabStore.dragOverCollection,
    'drag-ready': showDragHint,
    'drag-ban': showDragBan
  }">
    <VerticalMaskScroll v-if="settingsStore.showCollectionRail" class="rail-scroll" :gap="15" :fade-width="18">
      <button v-for="item in collectionStore.orderedItems" :key="item.id" type="button" class="rail-item"
        :class="{ 'active': item.id === activeItemId }" @click="openItem(item)"
        @mouseenter="showTooltip($event, item)" @mouseleave="hideTooltip"
        @contextmenu.prevent="openItemContextMenu($event, item)">
        <CollectionAvatar :type="item.type" :user-icon="item.userIcon" :bar-icon="item.barIcon" :size="34" />
      </button>
    </VerticalMaskScroll>
    <Teleport to="body">
      <Transition name="rail-tip">
        <div v-if="tooltip.visible" class="dynamic-island-pill rail-tooltip"
          :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }">{{ tooltip.text }}</div>
      </Transition>
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

const tooltip = reactive({ visible: false, x: 0, y: 0, text: '' });

function showTooltip(event: MouseEvent, item: CollectionItem): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tooltip.x = rect.right + 10;
  tooltip.y = rect.top + rect.height / 2;
  tooltip.text = item.title;
  tooltip.visible = true;
}

function hideTooltip(): void {
  tooltip.visible = false;
}

function openItem(item: CollectionItem): void {
  hideTooltip();
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
  hideTooltip();
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
  min-height: 0;
  padding: 22px 0 10px;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}

.rail-scroll {
  flex: 1 1 auto;
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
.rail-tooltip {
  position: fixed;
  z-index: 2600;
  max-width: 320px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  transform: translateY(-50%);
}

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
