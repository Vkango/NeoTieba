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
const content = computed(() => processContentElements(props.thread_content as ContentElement[], false, blocked.value, offlineMedia));
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
  embeddedImages: { type: Boolean, default: false }
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

.user-name {
  cursor: pointer;
}
</style>
