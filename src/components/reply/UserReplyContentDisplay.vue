<template>
  <div class="thread">
    <div class="thread-preview">
      <div class="thread-content" ref="contentElement" v-html="content">
      </div>
      <div class="thread-info">
        <span class="material-symbols-outlined" style="font-size: 16px;">schedule</span>{{ create_time1 }}
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
const settings = useSettingsStore();
const blocked = computed(() => ({ avatars: settings.isMediaBlocked('avatars'), images: settings.isMediaBlocked('images'), videos: settings.isMediaBlocked('videos'), audio: settings.isMediaBlocked('audio') }));
import { ref, onMounted, nextTick, watch } from 'vue';
import { processContentElements } from '@/utils/helper';
import { hydrateVoiceAudios } from '@/utils/amr-voice';
import type { ContentElement } from '@/types/common';
const create_time1 = ref<string>('');
const content = computed(() => processContentElements(props.content as ContentElement[], false, blocked.value));
function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${minute}:${ss}`;
}

const props = defineProps({
  content: {
    type: Array,
    required: true,
    default: []
  },
  createTime: {
    type: String,
    required: true,
    default: 0
  },
})

// 语音解码水合（须在 defineProps 之后：watch 初始化会立即求值 content，提前会踩 props 的 TDZ）
const contentElement = ref<HTMLElement | null>(null);
watch(content, () => { nextTick(() => hydrateVoiceAudios(contentElement.value)); });
onMounted(() => {
  create_time1.value = formatDate(props.createTime as any);
  nextTick(() => hydrateVoiceAudios(contentElement.value));
})
</script>

<style scoped>
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

.thread .avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  overflow: hidden;
}

.thread {
  width: 100%;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  font-size: 13px;
  gap: 10px;
}


.thread-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-info {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>