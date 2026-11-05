<template>
  <div class="thread" data-kb-item :class="{ 'thread-opened': openedInPane }" @click="emit('openThread')">
    <div class="user-info" @click.stop @click="openUser">
      <div class="avatar">
        <RemoteImage kind="avatars" class="avatar"
          :src="'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + avatar" />
      </div>
      <div>
        <div class="user-name">{{ user_name }}<small
            v-if="settings.showUserId && props.uid && String(props.uid) !== '0'"> · UID {{ props.uid }}</small></div>
        <div class="desc">{{ getTimeInterval(props.create_time * 1000) }}</div>
      </div>
    </div>
    <div class="thread-preview">
      <div class="thread-title-row">
        <span v-if="is_good" class="good-mark" :style="{ color: theme_color }">精</span>
        <span class="thread-title">{{ thread_title }}</span>
      </div>
      <div class="thread-content" v-html="content">
      </div>
      <span v-if="blocked.images && media?.some(item => item.type == 3)">[配图已禁用]</span>
      <span v-if="blocked.videos && media?.some(item => item.type == 5)">[视频已禁用]</span>
      <div class="thread-media">
        <RemoteImage class="thread-img" v-for="i in media?.filter(item => item.type == 3 && !blocked.images)"
          :key="i.big_pic" :src="i.big_pic || ''" />
        <span v-for="i in media?.filter(item => item.type == 5 && !blocked.videos)">
          <RemoteImage kind="videos" class="thread-img" :src="i.vpic || ''" />
          <span class="material-symbols-outlined"
            style="position: relative; font-size: 28px; top: 0%; left: 0%; opacity: 0.7; transform: translate(-110%, -10%);">play_circle</span>
        </span>
      </div>
      <div class="thread-info">
        <span v-if="fromBar != ''" style="display: flex; align-items: center;">
          <RemoteImage kind="avatars" v-if="fromBarAvatar" :src="fromBarAvatar"
            style="width: 16px; height: 16px; border-radius: 16px; margin-right: 5px;" :loading="'eager'" /><span
            style="margin-right: 5px;">{{ fromBar }}吧</span>
        </span>

        <span style="cursor: pointer; display: flex; align-items: center;" @click.stop="handleShare"><span
            class="material-symbols-outlined" style="font-size: 16px;">share</span>&nbsp;分享</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 10px;">forum</span> {{ reply_num }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useOpenedThreadHighlight } from '@/composables/useOpenedThreadHighlight';
import { useSettingsStore } from '@/stores/settings';
const settings = useSettingsStore();
const blocked = computed(() => ({ avatars: settings.isMediaBlocked('avatars'), images: settings.isMediaBlocked('images'), videos: settings.isMediaBlocked('videos'), audio: settings.isMediaBlocked('audio') }));
import { onMounted, ref } from 'vue';
import { getTimeInterval, processContentElements } from '@/utils/helper';
import type { ContentElement, MediaItem } from '@/types/common';
import RemoteImage from '@/components/common/RemoteImage.vue';

const { isOpenedInPane } = useOpenedThreadHighlight();
const props = withDefaults(defineProps<{
  tid?: string | number;
  uid?: string | number;
  fromBarAvatar?: string;
  fromBar?: string;
  avatar: string;
  user_name: string;
  thread_title: string;
  thread_content: ContentElement[];
  media: MediaItem[];
  create_time: number;
  reply_num: number;
  is_good?: boolean | number;
  theme_color?: string;
}>(), {
  tid: '',
  fromBarAvatar: '',
  fromBar: '',
  avatar: '',
  user_name: '',
  thread_title: '',
  thread_content: () => [],
  media: () => [],
  create_time: 0,
  reply_num: 0,
  is_good: false,
  theme_color: 'var(--text-color)'
})

const openedInPane = computed(() => isOpenedInPane(props.tid));
const content = computed(() => processContentElements(props.thread_content as ContentElement[], true, blocked.value));
const create_time1 = ref<string>('')
const emit = defineEmits<{
  (e: 'openUser'): void;
  (e: 'openThread'): void;
}>()
const openUser = () => {
  emit('openUser');
}
import { useShareCard, threadUrl, shareAvatarUrl, formatCardDate } from '@/services/share-card/useShareCard';
const shareCard = useShareCard();
const handleShare = () => {
  if (!props.tid) return;
  const mediaElements = (props.media || [])
    .filter(item => item.type === 3 && item.big_pic)
    .map(item => ({ type: 3, bigSrc: item.big_pic }));
  shareCard({
    title: props.thread_title || '贴吧帖子',
    avatar: shareAvatarUrl(props.avatar),
    barName: props.fromBar,
    barAvatar: props.fromBarAvatar,
    meta: `${props.user_name} · ${formatCardDate(props.create_time)}`,
    contentElements: [...(props.thread_content as ContentElement[]), ...mediaElements],
    stats: [{ label: '回复', value: props.reply_num }],
    qrUrl: threadUrl(props.tid)
  });
}
function formatDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${minute}:${ss}`;
}
onMounted(() => {
  create_time1.value = formatDate(props.create_time);
})
</script>
<style scoped>
.thread-info {
  display: flex;
  gap: 5px;
  opacity: 0.5;
  align-items: center;
  flex-wrap: wrap;
}


.thread-media {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}


.thread-img {
  max-height: 450px;
  border-radius: 5px;
}

.thread-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thread-title-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.good-mark {
  flex: 0 0 auto;
  font-size: 130%;
  font-weight: 800;
  line-height: 1;
}

.thread-preview .thread-title {
  font-weight: bold;
  font-size: 130%;
}

.user-info {
  display: flex;
  gap: 10px;
  align-items: center;
  width: fit-content;
  transition: background-color 0.3s ease;
  border-radius: 5px;
}

.user-info:hover {
  background-color: rgba(var(--text-color), 0.1);
}
</style>
