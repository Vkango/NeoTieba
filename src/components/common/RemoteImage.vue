<template>
  <span v-if="blocked" :class="props.class" :style="props.style" class="media-placeholder">{{ kind === 'avatars' ? '头像已禁用' : '图片已禁用' }}</span>
  <span v-else-if="failed" :class="props.class" :style="props.style" class="media-placeholder">{{ kind === 'avatars' ? '头像加载失败' : '图片加载失败' }}</span>
  <img v-else :class="props.class" :src="displaySrc || undefined" :alt="props.alt" :style="props.style" :loading="props.loading" decoding="async" referrerpolicy="no-referrer" @error="handleImageError">
</template>
<script setup lang="ts">
import { ref, watch, computed, inject } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { normalizeMediaUrl, toMediaUrl, type MediaKind } from '@/utils/settings-policy';
const props = withDefaults(defineProps<{ src?: string; alt?: string; class?: string; style?: string | Record<string, string>; loading?: 'eager' | 'lazy'; kind?: MediaKind }>(), { src: '', alt: '', loading: 'lazy', kind: 'images' });
const settings = useSettingsStore();
const blocked = computed(() => /^https?:|^\/\//.test(props.src) && settings.isMediaBlocked(props.kind));
const offlineResolve = inject<((url: string) => string) | undefined>('offlineMedia', undefined);
const archivedSrc = computed(() => {
  if (!offlineResolve || !/^https?:|^\/\//.test(props.src)) return '';
  return offlineResolve(normalizeMediaUrl(props.src)) || '';
});
const displaySrc = ref('');
const failed = ref(false);
const normalizeUrl = normalizeMediaUrl;
const onlineSrc = () => toMediaUrl(normalizeUrl(props.src));
watch(() => [props.src, blocked.value, archivedSrc.value], () => {
  failed.value = false;
  if (blocked.value) { displaySrc.value = ''; return; }
  // 归档副本优先；在线图片直接交给 media 协议，由 WebView 原生加载解码。
  displaySrc.value = archivedSrc.value || onlineSrc();
}, { immediate: true, flush: 'sync' });
function handleImageError() {
  if (blocked.value || failed.value) return;
  // 归档副本加载失败（未归档的资源，如未保存的头像）：按设置回退联网加载。
  if (archivedSrc.value && displaySrc.value === archivedSrc.value) {
    if (settings.archiveOnlineFallback && onlineSrc() !== archivedSrc.value) {
      displaySrc.value = onlineSrc();
      return;
    }
    failed.value = true;
    return;
  }
  // 联网也失败：换缓存穿透 URL 重试一次，仍失败再置占位。
  const retrySrc = `${onlineSrc()}?r=1`;
  if (displaySrc.value !== retrySrc) { displaySrc.value = retrySrc; return; }
  failed.value = true;
}
</script>
