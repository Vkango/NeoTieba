<template>
  <div class="thread" data-kb-item @click.stop>
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
      <div class="thread-info">
        <span class="material-symbols-outlined" style="font-size: 16px;">location_on</span>{{ ip_address }}
        <span style="cursor: pointer; margin-left: 10px; display: flex; align-items: center;"
          @click.stop="handleShare"><span class="material-symbols-outlined"
            style="font-size: 16px;">share</span>&nbsp;分享</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 10px;">thumb_up</span> {{ like }} 赞

        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 10px;">floor</span> {{ floor }} 楼
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 10px;"
          v-if="reply_num > 0">forum</span> <span v-if="reply_num > 0">{{ reply_num }} 回复</span>

      </div>
      <div class="subpost" v-if="reply_num > 0">
        <SubPost v-for="item in subpost_list" :thread_content="item.content" :embedded-images="props.embeddedImages"
          @openUser="openUser" @select-image="handleSubpostImage" :avatar="item.author.portrait" :uid="item.author.id"
          :user_name="item.author.name_show || item.author.name">
        </SubPost>
        <RippleButton v-if="reply_num > 5" @click="emit('viewAllReplies', props)"
          style="box-sizing: border-box; margin: 5px 15px; background-color: transparent; box-shadow: none; width: fit-content;">
          查看全部 {{ reply_num }} 条回复
        </RippleButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
const settings = useSettingsStore();
const userStore = useUserStore();
const blocked = computed(() => ({ avatars: settings.isMediaBlocked('avatars'), images: settings.isMediaBlocked('images'), videos: settings.isMediaBlocked('videos'), audio: settings.isMediaBlocked('audio') }));
import { onMounted, ref, inject, nextTick } from 'vue';
import { useApiStore } from '@/stores';
import { fetchImage } from '@/core/request';
import { normalizeMediaUrl } from '@/utils/settings-policy';
import { watch } from 'vue';
import { archiveViewSubPost } from '@/core/archive';
import { useOfflineMedia, useArchiveFallback, isArchiveUrl } from '@/composables/useOfflineMedia';
import SubPost from './SubPost.vue';
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
  (e: 'viewAllReplies', data: Props): void;
}>();

const openImageViewer = inject<((url: string) => void) | undefined>('openImageViewer');
const offlineMedia = useOfflineMedia();
const archiveFallback = useArchiveFallback();
const content = computed(() => processContentElements(props.thread_content as ContentElement[], false, blocked.value, offlineMedia));
const contentElement = ref<HTMLElement | null>(null);
const subpost_list = ref<any[]>([])

const openUser = (uid: string | number) => {
  emit('openUser', uid);
}

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
const registerSubpostImages = (items: any[]) => {
  const urls = items.flatMap(item => (Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => Number(part?.type) === 3 || Number(part?.type) === 20)
    .map((part: any) => part.bigCdnSrc || part.big_cdn_src || part.bigSrc || part.big_src || part.originSrc || part.origin_src)
    .filter((url: unknown): url is string => typeof url === 'string' && !!url));
  if (urls.length) emit('registerImages', urls);
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
  if (props.reply_num > 0) {
    const loadSubPost = (async () => {
      if (props.local) {
        try {
          return await archiveViewSubPost(props.tid, props.pid, 1);
        } catch (error) {
          // 楼中楼未归档（保存时未开启楼中楼等）：按设置联网补取。
          if (!settings.archiveOnlineFallback) throw error;
          console.info(`楼中楼 ${props.pid} 未归档，联网获取`, error);
          const apiStore = useApiStore();
          return apiStore.getApi().viewSubPost(props.tid, props.pid, 1, userStore.currentUser?.bduss ?? '', userStore.currentUser?.stoken ?? '');
        }
      }
      const apiStore = useApiStore();
      const Api = apiStore.getApi();
      return Api.viewSubPost(props.tid, props.pid, 1, userStore.currentUser?.bduss ?? '', userStore.currentUser?.stoken ?? '');
    })();
    loadSubPost.then((res: any) => {
      subpost_list.value = res.subpost_list;
      registerSubpostImages(subpost_list.value);
      if (subpost_list.value.length > 5) {
        subpost_list.value = subpost_list.value.slice(0, 5);
      }
    }).catch((error: unknown) => {
      console.warn('楼中楼加载失败:', error);
    });
  }
})

</script>
<style scoped>
.subpost {
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  background-color: rgba(var(--text-color), 0.02);
  gap: 8px;
  border: 1px solid rgba(var(--text-color), 0.03);
  margin-bottom: 10px;
}

.thread-info {
  display: flex;
  gap: 5px;
  opacity: 0.5;
  align-items: center;
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
