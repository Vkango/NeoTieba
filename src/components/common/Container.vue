<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTabStore } from '@/stores/tabs';
import { registerScroller, unregisterScroller, type ScrollerHandle } from '@/core/hotkeys';

const props = defineProps<{
  scrollKey?: string;
  tabKey?: string | number;
}>();

const emit = defineEmits<{
  (event: 'yscroll', target: HTMLElement): void;
  (event: 'positionchange', target: HTMLElement): void;
}>();

const tabStore = useTabStore();
const scrollContainer = ref<HTMLElement | null>(null);
const scrollPosition = ref(0);
const isRestoring = ref(false);
let restoreTimer: number | undefined;

const identityKey = computed(() => {
  if (props.tabKey !== undefined && props.tabKey !== null) {
    return String(props.tabKey);
  }
  return props.scrollKey || '';
});

const storageKey = computed(() => identityKey.value ? `scrollPosition:${identityKey.value}` : '');
// 分屏下「激活」以所在分屏组的当前页为准，而非全局聚焦标签——
// 两个分屏同时可见时，各自的滚动恢复互不干扰。
// 嵌入在其他页面里的子页面（如“我的”窄屏二级页）没有对应标签，视为始终激活。
const isActiveTab = computed(() => {
  if (props.tabKey === undefined || props.tabKey === null) {
    return true;
  }
  const key = String(props.tabKey);
  if (!tabStore.getTab(key)) return true;
  return tabStore.isTabKeyVisibleInPane(key);
});

function getSavedPosition(): number {
  if (!storageKey.value) {
    return scrollPosition.value;
  }

  const savedPosition = sessionStorage.getItem(storageKey.value);
  const parsed = savedPosition ? Number.parseInt(savedPosition, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  scrollPosition.value = target.scrollTop;
  if (isActiveTab.value) emit('positionchange', target);

  if (isRestoring.value || !isActiveTab.value) {
    return;
  }

  if (storageKey.value) {
    sessionStorage.setItem(storageKey.value, String(scrollPosition.value));
  }

  emit('yscroll', target);
}

function clearRestoreTimer() {
  if (restoreTimer !== undefined) {
    window.clearTimeout(restoreTimer);
    restoreTimer = undefined;
  }
}

function restoreScrollPosition(attempt = 0) {
  if (!isActiveTab.value) {
    return;
  }

  const targetTop = getSavedPosition();
  scrollPosition.value = targetTop;
  clearRestoreTimer();

  nextTick(() => {
    window.requestAnimationFrame(() => {
      const target = scrollContainer.value;
      if (!target || !isActiveTab.value) {
        isRestoring.value = false;
        return;
      }

      isRestoring.value = true;
      const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      target.scrollTop = Math.min(targetTop, maxScrollTop);

      if (targetTop > maxScrollTop && attempt < 8) {
        restoreTimer = window.setTimeout(() => restoreScrollPosition(attempt + 1), 80);
        return;
      }

      window.setTimeout(() => {
        isRestoring.value = false;
      }, 0);
    });
  });
}

onActivated(() => {
  restoreScrollPosition();
});

watch(
  () => [isActiveTab.value, storageKey.value] as const,
  ([active]) => {
    if (active) restoreScrollPosition();
  },
  { flush: 'post' }
);

function scrollToTop() {
  clearRestoreTimer();
  scrollPosition.value = 0;
  if (storageKey.value) sessionStorage.setItem(storageKey.value, '0');
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'instant' });
}

function scrollToElement(element: HTMLElement, offset = 12) {
  const container = scrollContainer.value;
  if (!container) return;
  clearRestoreTimer();
  isRestoring.value = false;
  const top = Math.max(0, container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - offset);
  scrollPosition.value = top;
  if (storageKey.value) sessionStorage.setItem(storageKey.value, String(top));
  container.scrollTo({ top, behavior: 'instant' });
}

defineExpose({ scrollToTop, scrollToElement, getScrollElement: () => scrollContainer.value });

// 注册到全局键盘控制系统，key 与 tabStore.activeKey 对齐；
// 仅页面级 Container（带 tabKey / scrollKey）注册，弹窗内容器不参与。
const scrollerHandle: ScrollerHandle = {
  get el(): HTMLElement {
    return scrollContainer.value as HTMLElement;
  },
  scrollToTop,
  scrollToElement,
};

onMounted(() => {
  if (identityKey.value) registerScroller(identityKey.value, scrollerHandle);
  restoreScrollPosition();
});

onBeforeUnmount(() => {
  if (identityKey.value) unregisterScroller(identityKey.value, scrollerHandle);
  clearRestoreTimer();
});
</script>

<template>
  <div ref="scrollContainer" class="component-container" @scroll="handleScroll">
    <slot></slot>
  </div>
</template>

<style lang="css" scoped>
.component-container {
  width: 100%;
  height: 100%;
  background-color: rgba(var(--text-color), 0.02);
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 5px;
  /* 页面级查询容器：各页/组件以 @container page (max-width: …) 按
     实际内容区宽度（而非窗口宽度）折叠布局，分屏下的窄格才会正确响应 */
  container: page / inline-size;
}
</style>
