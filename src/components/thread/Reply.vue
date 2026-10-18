<template>
  <div class="thread" ref="floorEl" data-kb-item @click.stop>
    <div class="user-info" @click="openUser(props.uid as string | number)">
      <div class="avatar">
        <RemoteImage kind="avatars" class="avatar"
          :src="'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + avatar"
          referrerpolicy="no-referrer" />
      </div>
      <div>
        <div class="user-name">{{ user_name }}<small
            v-if="settings.showUserId && props.uid && String(props.uid) !== '0'"> · UID {{ props.uid }}</small><span
            class="level"
            :class="{ 'color1': level >= 0 && level < 4, 'color2': level >= 4 && level < 10, 'color3': level >= 10 && level < 16, 'color4': level >= 16 }">{{
              level }} {{ is_lz ? '楼主' : '' }}</span>
        </div>
        <div class="desc">{{ getTimeInterval(props.create_time * 1000) }}</div>
      </div>


    </div>
    <div class="thread-preview">
      <div ref="contentElement" class="thread-content" v-html="content" style="user-select: text;" @click="handleClick"
        @error.capture="handleImageError">
      </div>
      <div ref="stickySentinel" class="sticky-sentinel" aria-hidden="true"></div>
      <div class="thread-info" :class="{ frozen: expanded, stuck }">
        <span v-if="reply_num > 0" class="reply-entry" role="button"
          :aria-expanded="reply_num > 5 ? expanded : undefined" @click.stop="toggleExpanded">
          <span class="material-symbols-outlined" style="font-size: 16px;">forum</span>
          <span>{{ reply_num }} 回复</span>
          <span v-if="expanded" class="material-symbols-outlined" style="font-size: 16px;">keyboard_arrow_up</span>
        </span>
        <span class="material-symbols-outlined" style="font-size: 16px;">location_on</span>{{ ip_address }}
        <span style="cursor: pointer; margin-left: 10px; display: flex; align-items: center;"
          @click.stop="handleShare"><span class="material-symbols-outlined"
            style="font-size: 16px;">share</span>&nbsp;分享</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 10px;">thumb_up</span> {{ like }} 赞

        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 10px;">floor</span> {{ floor }} 楼

      </div>
      <SubPostView v-if="reply_num > 0" :tid="tid" :pid="pid" :reply_num="reply_num" :local="local"
        :embedded-images="props.embeddedImages" :expanded="expanded" @openUser="openUser"
        @select-image="handleSubpostImage" @register-images="urls => emit('registerImages', urls)">
      </SubPostView>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
const settings = useSettingsStore();
const blocked = computed(() => ({ avatars: settings.isMediaBlocked('avatars'), images: settings.isMediaBlocked('images'), videos: settings.isMediaBlocked('videos'), audio: settings.isMediaBlocked('audio') }));
import { onMounted, onBeforeUnmount, ref, inject, nextTick } from 'vue';
import { fetchImage } from '@/core/request';
import { normalizeMediaUrl } from '@/utils/settings-policy';
import { watch } from 'vue';
import { useOfflineMedia, useArchiveFallback, isArchiveUrl } from '@/composables/useOfflineMedia';
import SubPostView from './SubPostView.vue';
import { useShareCard, threadUrl, shareAvatarUrl, formatCardDate } from '@/services/share-card/useShareCard';
import { getTimeInterval, processContentElements } from '@/utils/helper';
import type { ContentElement } from '@/types/common';

// Props和Emits类型定义
interface Props {
  ip_address?: string;
  avatar: string;
  embeddedImages?: boolean;
  uid: string | number;
  user_name: string;
  thread_content: unknown[];
  like: number;
  is_lz: boolean;
  create_time: number;
  reply_num: number;
  tid: string;
  pid: string | number;
  floor: number;
  level?: number;
  local?: boolean;
  forumName?: string;
  forumAvatar?: string;
  threadTitle?: string;
  threadAuthor?: string;
  threadAuthorAvatar?: string;
}

const props = withDefaults(defineProps<Props>(), {
  ip_address: '未知',
  level: 0
});

const emit = defineEmits<{
  (e: 'openUser', uid: string | number): void;
  (e: 'selectImage', url: string): void;
  (e: 'registerImages', urls: string[]): void;
}>();

const openImageViewer = inject<((url: string) => void) | undefined>('openImageViewer');
const offlineMedia = useOfflineMedia();
const archiveFallback = useArchiveFallback();
const content = computed(() => processContentElements(props.thread_content as ContentElement[], false, blocked.value, offlineMedia));
const contentElement = ref<HTMLElement | null>(null);
const floorEl = ref<HTMLElement | null>(null);
const stickySentinel = ref<HTMLElement | null>(null);
const expanded = ref(false);
const stuck = ref(false);
let stuckObserver: IntersectionObserver | null = null;

const openUser = (uid: string | number) => {
  emit('openUser', uid)
}

// 展开/收起：SubPostView 常驻挂载，自行加载数据；这里只切换 expanded 状态。
// 收起时先把原始操作区恢复到可视区域，避免页面高度骤变导致迷失位置。
// 锚点用 sticky 哨兵（thread-info 冻结时 getBoundingClientRect 是吸附位置，不是自然位置）
const toggleExpanded = () => {
  if (props.reply_num <= 5) return;
  if (expanded.value) {
    const container = floorEl.value?.closest('.component-container');
    const anchor = stickySentinel.value;
    if (container && anchor) {
      const rect = anchor.getBoundingClientRect();
      const crect = container.getBoundingClientRect();
      if (rect.top < crect.top || rect.top > crect.bottom) {
        const top = Math.max(0, container.scrollTop + rect.top - crect.top - 12);
        container.scrollTo({ top, behavior: 'instant' });
      }
    }
  }
  expanded.value = !expanded.value;
};

const handleClick = (event: any) => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains('thread-reply-img')) {
    if (props.embeddedImages) {
      emit('selectImage', event.target.getAttribute('data-full-src') || event.target.src);
      return;
    }
    if (openImageViewer) {
      openImageViewer(event.target.getAttribute('data-full-src') || event.target.src);
    }
  }
  if (event.target.classList.contains('at-button')) {
    emit('openUser', event.target.getAttribute('uid'));
  }
}
const handleSubpostImage = (url: string) => {
  if (props.embeddedImages) emit('selectImage', url);
  else openImageViewer?.(url);
};
const shareCard = useShareCard();
const handleShare = () => {
  shareCard({
    title: props.user_name,
    subtitle: `第 ${props.floor} 楼`,
    avatar: shareAvatarUrl(props.avatar),
    meta: formatCardDate(props.create_time),
    inline: true,
    contentElements: props.thread_content as ContentElement[],
    stats: [
      { label: '赞', value: props.like },
      { label: '回复', value: props.reply_num }
    ],
    source: (props.threadTitle || props.threadAuthor) ? {
      title: props.threadTitle,
      author: props.threadAuthor,
      authorAvatar: props.threadAuthorAvatar,
      barName: props.forumName,
      barAvatar: props.forumAvatar
    } : undefined,
    qrUrl: threadUrl(props.tid, props.pid)
  });
};
const handleImageError = async (event: Event): Promise<void> => {
  const image = event.target as HTMLImageElement;
  if (blocked.value.images || !image.isConnected) return;
  if (!image.classList.contains('thread-reply-img') || image.dataset.proxyAttempted) return;
  // 归档副本缺失时优先联网回退（恢复原始 URL），远程加载再失败才走代理。
  if (isArchiveUrl(image.getAttribute('src') || '')) {
    archiveFallback(event);
    return;
  }
  if (offlineMedia(image.getAttribute('data-full-src') || '') !== (image.getAttribute('data-full-src') || '')) return;
  image.dataset.proxyAttempted = 'true';
  const source = image.getAttribute('data-full-src') || image.src;
  const url = normalizeMediaUrl(source);
  try {
    const result = await fetchImage(url);
    if (!blocked.value.images && image.isConnected) image.src = result;
  } catch (error) {
    console.warn('高清图片加载失败:', source, error);
  }
};

async function preloadBigCdnImages(): Promise<void> {
  await nextTick();
  if (blocked.value.images) return;
  const images = contentElement.value?.querySelectorAll<HTMLImageElement>('.thread-reply-img[data-full-src]') || [];
  await Promise.all(Array.from(images).map(async (image) => {
    const source = image.getAttribute('data-full-src');
    if (!source || source.startsWith('data:')) return;
    if (offlineMedia(source) !== source) return;
    const url = normalizeMediaUrl(source);
    try {
      const result = await fetchImage(url);
      if (!blocked.value.images && image.isConnected) image.src = result;
    } catch (error) {
      console.warn('big_cdn_src 加载失败:', source, error);
    }
  }));
}

watch(content, () => { void preloadBigCdnImages(); });

onMounted(async () => {
  await preloadBigCdnImages();

  // 冻结状态检测：哨兵离开可视区顶部 => thread-info 吸附
  const root = stickySentinel.value?.closest('.component-container') as HTMLElement | null;
  stuckObserver = new IntersectionObserver((entries) => {
    stuck.value = !entries[0].isIntersecting;
  }, { root, threshold: 0 });
  if (stickySentinel.value) stuckObserver.observe(stickySentinel.value);
})

onBeforeUnmount(() => {
  stuckObserver?.disconnect();
  stuckObserver = null;
})

</script>
<style scoped>
.sticky-sentinel {
  height: 1px;
  margin-top: -1px;
}

.reply-entry {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  user-select: none;
}

.reply-entry {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 5px;
  margin-top: -2px;
  margin-bottom: -2px;
  border-radius: 5px;
  user-select: none;
  transition: background-color 0.3s ease;
}

.reply-entry:hover {
  background-color: rgba(var(--text-color), 0.1);
}

/* 展开时冻结原始操作栏：负 margin 抵消 padding，静止时不产生布局位移；宽度适配内容。
   注意 opacity < 1 会把 backdrop-filter 的模糊结果一并半透明化导致模糊出错，
   因此冻结时元素本身保持不透明，改用 color 把内容调回原有观感 */
.thread-info.frozen {
  position: sticky;
  top: 16px;
  z-index: 2;
  margin: -5px -10px;
  padding: 5px 10px;
  border-radius: 8px;
  opacity: 1;
  color: rgba(var(--text-color), 0.5);
}

/* 吸附后只做背景模糊 + 极淡底色，避免与滚动内容叠印且不干扰阅读 */
.thread-info.frozen.stuck {
  background: rgba(var(--background-color), 0.25);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

.thread-info {
  display: flex;
  gap: 5px;
  opacity: 0.5;
  align-items: center;
  width: fit-content;
}

.thread-media {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}


.thread-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thread-preview .thread-title {
  font-weight: bold;
  font-size: 16px;
}
</style>
