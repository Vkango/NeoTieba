<template>
  <div class="subpost" :class="{ 'preview-fade': reply_num > 5 && !expanded }">
    <SubPost v-for="item in baseList" :key="subpostKey(item)" :thread_content="item.content"
      @openUser="uid => emit('openUser', uid)" @select-image="onSubpostImage" :avatar="item.author.portrait"
      :uid="item.author.id" :user_name="item.author.name_show || item.author.name">
    </SubPost>
    <div v-if="extraList.length && renderExtras" class="subpost-expand-wrap"
      :class="{ expanded: props.expanded, opening }">
      <div class="subpost-expand-panel">
        <SubPost v-for="item in extraList" :key="subpostKey(item)" :thread_content="item.content"
          @openUser="uid => emit('openUser', uid)" @select-image="onSubpostImage" :avatar="item.author.portrait"
          :uid="item.author.id" :user_name="item.author.name_show || item.author.name">
        </SubPost>
      </div>
    </div>
    <div ref="bottomRef" class="load-sentinel" aria-hidden="true"></div>
  </div>
  <Teleport to="body">
    <transition name="fade1">
      <Loading v-if="isLoading && currentPage > 0" class="subpost-loading-pill"></Loading>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import SubPost from './SubPost.vue';
import Loading from '@/components/common/Loading.vue';
import { useSettingsStore } from '@/stores/settings';
import { useApi } from '@/composables/useApi';
import { useUserStore } from '@/stores/user';
import { archiveViewSubPost } from '@/core/archive';
import { useImageViewer } from '@/composables/useGlobalProvides';

interface Props {
  tid: string;
  pid: string | number;
  reply_num: number;
  local?: boolean;
  embeddedImages?: boolean;
  /** 是否展开：折叠时只显示前 5 条，展开后显示全部并按需分页 */
  expanded?: boolean;
}

interface SubPostItem {
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
const baseList = computed(() => subpost_list.value.slice(0, 5));
const extraList = computed(() => subpost_list.value.slice(5));

const subpostKey = (item: SubPostItem): string => String(item.pid ?? item.post_id ?? '');

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
    collapseTimer = window.setTimeout(() => {
      renderExtras.value = false;
      collapseTimer = undefined;
    }, 260);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
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

/* 分页加载指示：页面左下角悬浮胶囊，不内联在回复里 */
.subpost-loading-pill {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 3200;
}
</style>
