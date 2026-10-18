<template>
  <Teleport to="body">
    <!-- 单行胶囊：左侧分组名、右侧条目标题；悬停与拖拽共用，跟随锚点/光标 -->
    <Transition name="drag-overlay-fade">
      <div v-if="overlay.capsuleVisible" class="dynamic-island-pill collection-drag-capsule"
        :style="{ left: `${overlay.capsuleX}px`, top: `${overlay.capsuleY}px` }">
        <span class="material-symbols-outlined">folder</span>
        <span class="capsule-text">{{ overlay.capsuleText }}</span>
        <template v-if="overlay.capsuleSubText">
          <span class="capsule-divider"></span>
          <span class="capsule-text">{{ overlay.capsuleSubText }}</span>
        </template>
      </div>
    </Transition>
    <!-- 删除高亮区：集锦条目/分组拖拽时出现在屏幕底部居中，放入即删除 -->
    <Transition name="drag-overlay-fade">
      <div v-if="overlay.deleteZoneActive" class="collection-delete-zone"
        :class="{ hovered: overlay.deleteZoneHovered }">
        <span class="material-symbols-outlined">delete</span>
        <span>拖拽到此处以删除</span>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useCollectionDragOverlay } from '@/composables/useCollectionDragOverlay';

const overlay = useCollectionDragOverlay();
</script>

<style scoped>
/* 单行胶囊：垂直居中于锚点，不可命中以免遮挡删除区判定 */
.collection-drag-capsule {
  position: fixed;
  z-index: 2560;
  transform: translateY(-50%);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  max-width: 320px;
}

.collection-drag-capsule .material-symbols-outlined {
  font-size: 15px;
}

.capsule-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 12px;
  background-color: rgba(var(--text-color), 0.25);
}

/* 屏幕底部居中的删除区：主题色细描边，悬停时轻微加强 */
.collection-delete-zone {
  position: fixed;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  z-index: 2550;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 22px;
  border-radius: 12px;
  border: 1px solid rgba(var(--primary-color), 0.45);
  background-color: rgba(var(--background-color), 0.72);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgb(var(--primary-color));
  font-size: 15px;
  font-weight: bold;
  user-select: none;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.collection-delete-zone.hovered {
  transform: translateX(-50%) scale(1.06);
  border-color: rgba(var(--primary-color), 0.9);
  background-color: rgba(var(--primary-color), 0.12);
}

.collection-delete-zone .material-symbols-outlined {
  font-size: 19px;
}

.drag-overlay-fade-enter-active,
.drag-overlay-fade-leave-active {
  transition: opacity 0.15s ease;
}

.drag-overlay-fade-enter-from,
.drag-overlay-fade-leave-to {
  opacity: 0;
}
</style>
