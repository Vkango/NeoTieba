<template>
  <div class="subpost-1">
    <div class="avatar">
      <RemoteImage kind="avatars" class="avatar"
        :src="'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + avatar" />
    </div>
    <div class="subpost-preview">
      <span class="user-name" @click="emit('openUser', props.uid)">{{ user_name }}<small
          v-if="settings.showUserId && props.uid && String(props.uid) !== '0'">
          · UID {{ props.uid }}</small></span>：<span class="thread-content" @click="handleClick"
        @error.capture="archiveFallback" v-html="content">
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
const settings = useSettingsStore();
const blocked = computed(() => ({ avatars: settings.isMediaBlocked('avatars'), images: settings.isMediaBlocked('images'), videos: settings.isMediaBlocked('videos'), audio: settings.isMediaBlocked('audio') }));

import { processContentElements } from '@/utils/helper';
import { useOfflineMedia, useArchiveFallback } from '@/composables/useOfflineMedia';
import type { ContentElement } from '@/types/common';
const offlineMedia = useOfflineMedia();
const archiveFallback = useArchiveFallback();
const content = computed(() => processContentElements(props.thread_content as ContentElement[], false, blocked.value, offlineMedia, props.targetAvatar));
const emit = defineEmits(['openUser', 'selectImage'])
const handleClick = (event: any) => {
  if (event.target.classList.contains('thread-reply-img')) {
    emit('selectImage', event.target.getAttribute('data-full-src') || event.target.src);
  }
  if (event.target.classList.contains('at-button')) {
    emit('openUser', event.target.getAttribute('uid'));
  }
}

const props = defineProps({
  avatar: {
    type: String,
    required: true,
    default: ''
  },
  user_name: {
    type: String,
    required: true,
    default: ''
  },
  thread_content: {
    type: Array,
    required: true,
    default: []
  },
  uid: {
    required: true,
  },
  embeddedImages: { type: Boolean, default: false },
  /** "回复 XXX" 目标用户的头像 URL，有则在昵称前显示小头像 */
  targetAvatar: { type: String, default: '' }
})
</script>
<style scoped>
.subpost-1 .avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  overflow: hidden;
}

.subpost-1 {
  box-sizing: border-box;
  padding: 8px 0;
  display: flow-root;
  border-radius: 8px;
  font-size: 13px;
  transition: opacity 0.2s ease;
}

/* 悬停其他回复时不在其叙事线上：压暗。透明度只落在单条上，不影响外层 sticky 的 backdrop-filter */
.subpost-1.chain-dim {
  opacity: 0.4;
}

.subpost-1>.avatar {
  float: left;
  margin-right: 10px;
}

.subpost-preview {
  display: flow-root;
}

.subpost-preview .thread-title {
  font-weight: bold;
  font-size: 16px;
}

.subpost-preview :deep(.emoticon) {
  width: auto;
  height: 1lh;
  vertical-align: middle;
}

/* "回复 XXX" 前的目标用户小头像，方便对上是回复谁 */
.subpost-preview :deep(.at-avatar) {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 3px;
}

.user-name {
  cursor: pointer;
}
</style>
