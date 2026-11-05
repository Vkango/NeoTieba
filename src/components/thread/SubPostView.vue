<template>
  <div ref="rootRef" class="subpost" :class="{ 'preview-fade': reply_num > 5 && !expanded }" @mouseleave="scheduleClear">
    <SubPost v-for="(item, index) in baseList" :key="subpostKey(item)" :thread_content="item.content"
      :class="{ 'chain-dim': isDimmed(index) }" :data-subpost-index="index" @mouseenter="onRowEnter(index)"
      :target-avatar="targetAvatarUrl(index)"
      @openUser="uid => emit('openUser', uid)" @select-image="onSubpostImage" :avatar="item.author.portrait"
      :uid="item.author.id" :user_name="item.author.name_show || item.author.name">
    </SubPost>
    <div v-if="extraList.length && renderExtras" class="subpost-expand-wrap"
      :class="{ expanded: props.expanded, opening }">
      <div class="subpost-expand-panel">
        <SubPost v-for="(item, index) in extraList" :key="subpostKey(item)" :thread_content="item.content"
          :class="{ 'chain-dim': isDimmed(index + BASE_COUNT) }" :data-subpost-index="index + BASE_COUNT"
          @mouseenter="onRowEnter(index + BASE_COUNT)" :target-avatar="targetAvatarUrl(index + BASE_COUNT)"
          @openUser="uid => emit('openUser', uid)" @select-image="onSubpostImage" :avatar="item.author.portrait"
          :uid="item.author.id" :user_name="item.author.name_show || item.author.name">
        </SubPost>
      </div>
    </div>
    <div ref="bottomRef" class="load-sentinel" aria-hidden="true"></div>
  </div>
  <Teleport to="body">
    <transition name="fade1">
      <Loading v-if="isLoading && currentPage > 0" class="subpost-loading-pill" :style="pillStyle"></Loading>
    </transition>
    <!-- 叙事线浮窗：上文已滚出视野时，把高亮的那几条抽出来贴在旁边直接读 -->
    <transition name="chain-pv">
      <div v-if="previewOpen" ref="previewBox" class="chain-preview" :style="previewStyle" @mouseenter="cancelClear"
        @mouseleave="scheduleClear" @click="onPreviewClick">
        <div v-for="row in previewRows" :key="row.index" class="chain-preview-row"
          :class="{ current: row.index === previewIndex }">
          <RemoteImage v-if="row.avatar" kind="avatars" class="chain-preview-avatar" :src="row.avatar" />
          <div class="chain-preview-body">
            <span class="chain-preview-user">{{ row.name }}</span><span class="name-separator"
              aria-hidden="true"></span><span class="chain-preview-text" v-html="row.html"></span>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue';
import SubPost from './SubPost.vue';
import Loading from '@/components/common/Loading.vue';
import { useSettingsStore } from '@/stores/settings';
import { useApi } from '@/composables/useApi';
import { useUserStore } from '@/stores/user';
import { archiveViewSubPost } from '@/core/archive';
import { useImageViewer } from '@/composables/useGlobalProvides';
import { buildReplyChains, extractReplyTarget } from '@/utils/subpostChain';
import { processContentElements } from '@/utils/helper';
import type { ContentElement } from '@/types/common';

interface Props {
  tid: string;
  pid: string | number;
  reply_num: number;
  local?: boolean;
  embeddedImages?: boolean;
  /** 是否展开：折叠时只显示前 5 条，展开后显示全部并按需分页 */
  expanded?: boolean;
  /** 楼层作者（portrait / uid / 昵称）："回复 楼层作者"没有上文可查，核对身份后用其头像补目标头像 */
  floorAvatar?: string;
  floorUid?: string | number;
  floorName?: string;
}

interface SubPostItem {
  id?: string | number;
  pid?: string | number;
  post_id?: string | number;
  author: {
    id: string | number;
    name: string;
    name_show?: string;
    portrait: string;
  };
  content: unknown[];
  [key: string]: unknown;
}

interface Emits {
  (e: 'openUser', uid: string | number): void;
  (e: 'selectImage', url: string): void;
  (e: 'registerImages', urls: string[]): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const settings = useSettingsStore();
const api = useApi();
const userStore = useUserStore();
const openImageViewer = useImageViewer();

const subpost_list: Ref<SubPostItem[]> = ref<SubPostItem[]>([]);
const isLoading: Ref<boolean> = ref<boolean>(false);
const bottomRef = ref<HTMLElement | null>(null);
// 多余条目的 DOM 只在展开期间存在：收起动画结束后即卸载，不为未展开的楼中楼保留内存
const renderExtras = ref(false);
const opening = ref(false);
let currentPage = 0;
let totalPages = 1;
let observer: IntersectionObserver | null = null;
let expandTimer: number | undefined;
let collapseTimer: number | undefined;

// 前 5 条始终可见（折叠态），其余条目收纳在可展开区域内；组件常驻，数据不因展开收缩而清空
const BASE_COUNT = 5;
const baseList = computed(() => subpost_list.value.slice(0, BASE_COUNT));
const extraList = computed(() => subpost_list.value.slice(BASE_COUNT));

// protobuf 解出的字段是 id，pid/post_id 只是旧契约的兜底
const subpostKey = (item: SubPostItem): string => String(item.pid ?? item.post_id ?? item.id ?? '');

// 悬停高亮叙事线：chainSets[i] 为第 i 条回复（自身 + 逐级回复的上文）的下标集合，其余条目压暗。
// 状态按实例保存：同一帖子可能同时开在两个分屏里。关闭设置时不读 chainSets，computed 不会被触发计算。
const chainMeta = computed(() => buildReplyChains(subpost_list.value));
const chainSets = computed(() => chainMeta.value.chains);
const hoveredIndex = ref<number | null>(null);
const activeChain = computed(() => {
  if (!settings.highlightReplyChain || hoveredIndex.value === null) return null;
  return chainSets.value[hoveredIndex.value] ?? null;
});
const isDimmed = (index: number): boolean => activeChain.value !== null && !activeChain.value.has(index);

const PORTRAIT_BASE = 'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/';
const portraitUrl = (portrait: string | undefined): string => (portrait ? PORTRAIT_BASE + portrait : '');
/** 第 i 条"回复 XXX"目标用户的头像：取它所回应那条的作者头像；列表里没有上文且目标就是楼层作者时用楼层作者的，
 *  否则（目标的回复已删除等）宁可不显示也不张冠李戴 */
const targetAvatarUrl = (index: number): string => {
  const parent = chainMeta.value.parents[index];
  if (parent === undefined) return '';
  if (parent >= 0) return portraitUrl(subpost_list.value[parent]?.author?.portrait);
  const target = extractReplyTarget(subpost_list.value[index].content);
  if (!target) return '';
  const isFloorAuthor = target.uid
    ? String(props.floorUid ?? '') === target.uid
    : !!props.floorName && props.floorName === target.name;
  return isFloorAuthor ? portraitUrl(props.floorAvatar) : '';
};

// 叙事线浮窗（交互同图片速览）：悬停停留后才展示，快速掠过不打扰；
// 只有上文已滚出视野时才出现——都在屏幕内时压暗高亮已经够看；滚动、点击、Esc 即关。
/** 首次悬停的意图延迟 */
const SHOW_DELAY = 300;
/** 浮窗已展示时切换到相邻回复的延迟 */
const SWITCH_DELAY = 120;
/** 离开列表后的宽限期，给指针移入浮窗（滚动长对话）留时间 */
const HIDE_GRACE = 220;
const VIEWPORT_MARGIN = 16;
const ROW_GAP = 14;
/** 右侧可用宽度低于该值时不放右侧，改贴在回复下方 */
const MIN_SIDE_WIDTH = 260;
const MAX_WIDTH = 420;

const rootRef = ref<HTMLElement | null>(null);
const previewBox = ref<HTMLElement | null>(null);
const previewIndex = ref<number | null>(null);
const previewStyle = ref<Record<string, string>>({});
const previewOpen = computed(() => previewIndex.value !== null);
let showTimer = 0;
let clearTimer = 0;
let anchorAbove = false;

const hoverCapable = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const onRowEnter = (index: number): void => {
  window.clearTimeout(clearTimer);
  hoveredIndex.value = index;
};
const cancelClear = (): void => window.clearTimeout(clearTimer);
const scheduleClear = (): void => {
  window.clearTimeout(clearTimer);
  // 浮窗没开时立刻恢复，不让压暗拖泥带水；开着时留宽限期
  if (!previewOpen.value) {
    hoveredIndex.value = null;
    return;
  }
  clearTimer = window.setTimeout(() => { hoveredIndex.value = null; }, HIDE_GRACE);
};
const closePreview = (): void => { previewIndex.value = null; };

const previewRows = computed(() => {
  const idx = previewIndex.value;
  const chain = idx === null ? null : chainSets.value[idx];
  if (!chain) return [];
  return [...chain].sort((a, b) => a - b).map(i => {
    const item = subpost_list.value[i];
    return {
      index: i,
      avatar: portraitUrl(item.author.portrait),
      name: item.author.name_show || item.author.name,
      html: processContentElements(item.content as ContentElement[], true, undefined, undefined, targetAvatarUrl(i)),
    };
  });
});

const rowEl = (index: number): HTMLElement | null =>
  rootRef.value?.querySelector<HTMLElement>(`[data-subpost-index="${index}"]`) ?? null;

/** 叙事线里除悬停项外是否有条目不在滚动容器可视区内 */
const chainOutOfView = (index: number, chain: Set<number>): boolean => {
  const scroller = rootRef.value?.closest('.component-container');
  const bounds = scroller?.getBoundingClientRect();
  const top = Math.max(bounds?.top ?? 0, 0);
  const bottom = Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight);
  for (const i of chain) {
    if (i === index) continue;
    const el = rowEl(i);
    if (!el) return true;
    const rect = el.getBoundingClientRect();
    if (rect.top < top || rect.bottom > bottom) return true;
  }
  return false;
};

/** 优先放在该条回复右侧空白处（与图片速览一致）；放不下则贴在回复上方——上文本就在上面，
 *  且阅读是向下走的，不挡住接下来要悬停的回复；上方也不够时才贴下方 */
const placePreview = (rect: DOMRect): Record<string, string> => {
  anchorAbove = false;
  const sideWidth = window.innerWidth - rect.right - ROW_GAP - VIEWPORT_MARGIN;
  if (sideWidth >= MIN_SIDE_WIDTH) {
    return {
      left: `${rect.right + ROW_GAP}px`,
      top: `${rect.top}px`,
      width: `${Math.min(sideWidth, MAX_WIDTH)}px`,
      maxHeight: `${window.innerHeight - VIEWPORT_MARGIN * 2}px`,
    };
  }
  const width = Math.min(rect.width, MAX_WIDTH);
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - VIEWPORT_MARGIN - width));
  const below = window.innerHeight - rect.bottom - ROW_GAP - VIEWPORT_MARGIN;
  const above = rect.top - ROW_GAP - VIEWPORT_MARGIN;
  anchorAbove = above >= 160 || above > below;
  return {
    left: `${left}px`,
    top: anchorAbove ? `${VIEWPORT_MARGIN}px` : `${rect.bottom + ROW_GAP}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(anchorAbove ? above : below, 80)}px`,
  };
};

/** 浮窗渲染出实际高度后再收进窗口内 */
const clampPreview = (rect: DOMRect): void => {
  const box = previewBox.value;
  if (!box) return;
  const height = box.offsetHeight;
  const wanted = anchorAbove ? rect.top - ROW_GAP - height : parseFloat(previewStyle.value.top);
  const top = Math.max(VIEWPORT_MARGIN, Math.min(wanted, window.innerHeight - VIEWPORT_MARGIN - height));
  previewStyle.value = { ...previewStyle.value, top: `${top}px` };
  box.scrollTop = 0;
};

const showPreviewFor = (index: number): void => {
  const chain = chainSets.value[index];
  const row = rowEl(index);
  if (!chain || chain.size <= 1 || !row || !hoverCapable() || !chainOutOfView(index, chain)) {
    closePreview();
    return;
  }
  const rect = row.getBoundingClientRect();
  previewStyle.value = placePreview(rect);
  previewIndex.value = index;
  void nextTick(() => clampPreview(rect));
};

const onPreviewClick = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (target?.classList.contains('at-button')) emit('openUser', target.getAttribute('uid') ?? '');
};

watch(hoveredIndex, (index) => {
  window.clearTimeout(showTimer);
  if (index === null || !settings.highlightReplyChain) {
    closePreview();
    return;
  }
  if (previewIndex.value === index) return;
  showTimer = window.setTimeout(() => showPreviewFor(index), previewOpen.value ? SWITCH_DELAY : SHOW_DELAY);
});

watch(() => settings.highlightReplyChain, (enabled) => { if (!enabled) closePreview(); });

// 文档级监听只在浮窗打开期间挂着：楼中楼实例很多，不能每个都常驻监听滚动
const insidePreview = (target: EventTarget | null): boolean =>
  target instanceof Node && previewBox.value?.contains(target) === true;
const onDocScroll = (event: Event): void => { if (!insidePreview(event.target)) closePreview(); };
const onDocPointerDown = (event: Event): void => { if (!insidePreview(event.target)) closePreview(); };
const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') closePreview(); };
const bindPreviewListeners = (on: boolean): void => {
  const fn = on ? 'addEventListener' : 'removeEventListener';
  document[fn]('scroll', onDocScroll, true);
  document[fn]('pointerdown', onDocPointerDown, true);
  document[fn]('keydown', onKeyDown as EventListener, true);
  window[fn]('resize', closePreview);
  window[fn]('blur', closePreview);
};
watch(previewOpen, bindPreviewListeners);

const onSubpostImage = (url: string): void => {
  if (props.embeddedImages) emit('selectImage', url);
  else openImageViewer(url);
};

const fetchPage = async (page: number): Promise<Record<string, any>> => {
  if (props.local) {
    try {
      return await archiveViewSubPost(props.tid, props.pid, page);
    } catch (error) {
      // 楼中楼未归档（保存时未开启楼中楼等）：按设置联网补取。
      if (!settings.archiveOnlineFallback) throw error;
      console.info(`楼中楼 ${props.pid} 第 ${page} 页未归档，联网获取`, error);
      return await api.viewSubPost(props.tid, props.pid, page, userStore.currentUser?.bduss ?? '', userStore.currentUser?.stoken ?? '');
    }
  }
  return await api.viewSubPost(props.tid, props.pid, page, userStore.currentUser?.bduss ?? '', userStore.currentUser?.stoken ?? '');
};

const registerImages = (items: SubPostItem[]): void => {
  const urls = items.flatMap(item => (Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => Number(part?.type) === 3 || Number(part?.type) === 20)
    .map((part: any) => part.bigCdnSrc || part.big_cdn_src || part.bigSrc || part.big_src || part.originSrc || part.origin_src)
    .filter((url: unknown): url is string => typeof url === 'string' && !!url));
  if (urls.length) emit('registerImages', urls);
};

// 楼中楼自身的底部哨兵是否接近可视区域（整体滚动位置不可靠：那是整个楼层的底部）
const isSentinelNearViewport = (): boolean => {
  const el = bottomRef.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const crect = el.closest('.component-container')?.getBoundingClientRect();
  const bottom = crect ? crect.bottom : window.innerHeight;
  return rect.top < bottom + 120;
};

// 分页加载胶囊浮在本楼中楼所在面板（滚动容器）的可视区左下角，而不是整个窗口的：
// 分屏时窗口左下角可能是另一个面板，也会压到左侧导航栏
const pillStyle = ref<Record<string, string>>({});
const placeLoadingPill = (): void => {
  const pane = rootRef.value?.closest('.component-container');
  if (!pane) {
    pillStyle.value = {};
    return;
  }
  const rect = pane.getBoundingClientRect();
  pillStyle.value = {
    left: `${rect.left + 16}px`,
    bottom: `${window.innerHeight - rect.bottom + 16}px`,
  };
};
watch(isLoading, (loading) => { if (loading) placeLoadingPill(); });

const loadNext = async (): Promise<void> => {
  if (isLoading.value) return;
  isLoading.value = true;
  try {
    const next = currentPage + 1;
    const res = await fetchPage(next);
    const items: SubPostItem[] = res.subpost_list || [];
    subpost_list.value = next === 1 ? items : [...subpost_list.value, ...items];
    currentPage = next;
    const totalPage = Number(res.page?.total_page || res.page?.current_page || 1);
    if (Number.isInteger(totalPage) && totalPage > 0) totalPages = totalPage;
    registerImages(items);
  } catch (error) {
    console.error('加载楼中楼失败:', error);
  } finally {
    isLoading.value = false;
  }
};

const tryLoadMore = async (): Promise<void> => {
  if (!props.expanded || isLoading.value || currentPage >= totalPages) return;
  if (!isSentinelNearViewport()) return;
  await loadNext();
  // 追加后哨兵可能仍停留在可视区域内，继续补加载直到填满一屏或没有更多
  await nextTick();
  await tryLoadMore();
};

onMounted(() => {
  const root = bottomRef.value?.closest('.component-container') as HTMLElement | null;
  observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) void tryLoadMore();
  }, { root, rootMargin: '120px 0px' });
  if (bottomRef.value) observer.observe(bottomRef.value);
  if (props.reply_num > 0) void loadNext();
});

// 展开：挂载多余条目并用 keyframes 动画展开（首次插入无法触发 transition）；
// 收起：先播放收缩过渡，动画结束后卸载多余条目释放内存
watch(() => props.expanded, (val) => {
  if (collapseTimer) {
    window.clearTimeout(collapseTimer);
    collapseTimer = undefined;
  }
  if (val) {
    if (expandTimer) window.clearTimeout(expandTimer);
    renderExtras.value = true;
    opening.value = true;
    expandTimer = window.setTimeout(() => {
      opening.value = false;
      expandTimer = undefined;
    }, 260);
    void tryLoadMore();
  } else {
    // 收起后第 6 条以后会被卸载，悬停在其上时不会触发 mouseleave
    hoveredIndex.value = null;
    collapseTimer = window.setTimeout(() => {
      renderExtras.value = false;
      collapseTimer = undefined;
    }, 260);
  }
});

// keep-alive 下切换 tab / 分屏只是 v-show 隐藏，不会触发 mouseleave
onDeactivated(() => {
  hoveredIndex.value = null;
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.clearTimeout(showTimer);
  window.clearTimeout(clearTimer);
  bindPreviewListeners(false);
  if (expandTimer) window.clearTimeout(expandTimer);
  if (collapseTimer) window.clearTimeout(collapseTimer);
});
</script>
<style scoped>
.subpost {
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

/* 折叠且还有更多回复时：底部渐隐蒙版，提示用户可以继续展开查看（mask 不影响交互） */
.subpost.preview-fade {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 48px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 48px), transparent);
}

/* 多余条目收纳区：展开 1fr，收起 0fr（transition）；DOM 仅在展开期间挂载 */
.subpost-expand-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.subpost-expand-wrap.expanded {
  grid-template-rows: 1fr;
}

/* 首次插入时无法触发 transition，用动画完成展开 */
.subpost-expand-wrap.opening {
  grid-template-rows: 1fr;
  animation: subpost-expand 0.25s ease;
}

@keyframes subpost-expand {
  from {
    grid-template-rows: 0fr;
  }

  to {
    grid-template-rows: 1fr;
  }
}

.subpost-expand-panel {
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.load-sentinel {
  height: 1px;
  margin-top: -1px;
}

/* 分页加载指示：浮在所在面板左下角的胶囊（坐标由 placeLoadingPill 写入，这里是找不到面板时的兜底），不内联在回复里 */
.subpost-loading-pill {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 3200;
}

/* 叙事线浮窗：贴着回复浮动展示对话，不改动帖子排版 */
.chain-preview {
  position: fixed;
  z-index: 3400;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 12px;
  border-radius: 10px;
  background: rgb(var(--background-color));
  border: 1px solid rgba(var(--text-color), 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  line-height: 1.6;
}

.chain-preview-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0 6px 8px;
  border-left: 2px solid transparent;
}

.chain-preview-row.current {
  border-left-color: rgb(var(--primary-color));
}

.chain-preview-avatar {
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  overflow: hidden;
}

.chain-preview-body {
  min-width: 0;
}

.chain-preview-user {
  font-weight: bold;
}

.chain-preview-text {
  white-space: break-spaces;
}

.chain-preview-text :deep(.emoticon) {
  width: auto;
  height: 1lh;
  vertical-align: middle;
}

/* "回复 XXX" 前的目标用户小头像 */
.chain-preview-text :deep(.at-avatar) {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 3px;
}

.chain-pv-enter-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.chain-pv-leave-active {
  transition: opacity 0.12s ease;
}

.chain-pv-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.chain-pv-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {

  .chain-pv-enter-active,
  .chain-pv-leave-active {
    transition: none;
  }
}
</style>
