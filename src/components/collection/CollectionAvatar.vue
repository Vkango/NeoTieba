<template>
  <span class="collection-avatar" :style="{ width: `${props.size}px`, height: `${props.size}px` }">
    <RemoteImage kind="avatars" class="avatar-main" :src="mainIcon" :style="mainStyle" />
    <span v-if="props.type === 'thread' && props.barIcon" class="avatar-badge"
      :style="{ width: `${badgeSize}px`, height: `${badgeSize}px` }">
      <RemoteImage kind="avatars" :src="props.barIcon" :style="badgeStyle" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CollectionTargetType } from '@/stores/collection';

const props = withDefaults(defineProps<{
  type: CollectionTargetType;
  userIcon?: string;
  barIcon?: string;
  size?: number;
}>(), { size: 40 });

const badgeSize = computed(() => Math.round(props.size * 0.45));
const mainIcon = computed(() => {
  if (props.type === 'bar') return props.barIcon || '/assets/apps.svg';
  return props.userIcon || '/assets/user.svg';
});
const mainStyle = computed(() => ({ width: '100%', height: '100%' }));
const badgeStyle = computed(() => ({ width: '100%', height: '100%' }));
</script>

<style scoped>
.collection-avatar {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
}

.avatar-main {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background-color: rgba(var(--text-color), 0.08);
}

.avatar-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid rgb(var(--background-color));
  background-color: rgb(var(--background-color));
  box-sizing: content-box;
}
</style>
