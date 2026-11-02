<script setup lang="ts">
import { computed, inject, onMounted } from 'vue';
import { useHistoryStore, type HistoryItem } from '@/stores/history';
import RemoteImage from '@/components/common/RemoteImage.vue';

const props = defineProps<{
  key_: string | number;
}>();

const emit = defineEmits<{
  (event: 'openThread', id: string): void;
  (event: 'openBar', barName: string): void;
  (event: 'openUser', uid: string): void;
}>();

const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');
const historyStore = useHistoryStore();
const historyItems = computed(() => historyStore.items);

onMounted(() => {
  updateTabMeta?.({ key: props.key_, title: '浏览历史', icon: '/assets/schedule.svg', icon_invert: true });
});

function openItem(item: HistoryItem): void {
  if (item.type === 'thread') {
    emit('openThread', item.target);
    return;
  }

  if (item.type === 'bar') {
    emit('openBar', item.target);
    return;
  }

  emit('openUser', item.target);
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`history-${props.key_}`">
    <div class="history-page">
      <div class="history-header">
        <div>
          <h2>浏览历史</h2>
          <p>这里记录了你最近打开的页面</p>
        </div>
        <RippleButton class="clear-button" @click="historyStore.clearHistory()">
          <div style="display: flex; gap: 10px">
            <span class="material-symbols-outlined">delete</span>
            清空
          </div>
        </RippleButton>
      </div>

      <div v-if="historyItems.length === 0" class="empty-state">
        <span class="material-symbols-outlined">history</span>
        <div>暂无浏览历史</div>
      </div>

      <div v-else class="history-list">
        <RippleButton v-for="item in historyItems" :key="item.id" class="history-item" @click="openItem(item)">
          <div class="history-row">
            <RemoteImage v-if="item.icon" class="item-icon-img" :src="item.icon" />
            <div class="item-main">
              <div class="item-title">{{ item.title }}</div>
              <div class="item-meta">{{ formatTime(item.timestamp) }}</div>
            </div>
            <span class="material-symbols-outlined item-arrow">chevron_right</span>
          </div>
        </RippleButton>
      </div>
    </div>
  </Container>
</template>

<style scoped>
.history-page {
  width: min(860px, calc(100% - 40px));
  margin: 0 auto;
  padding: 24px 0 48px;
}

.history-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.history-header h2 {
  margin: 0;
  font-size: 24px;
}

.history-header p {
  margin: 6px 0 0;
  color: rgba(var(--text-color), 0.55);
  font-size: 13px;
}

.clear-button {
  margin-left: auto;
  padding: 8px 12px;
  box-shadow: none;
  background: rgba(var(--text-color), 0.06);
}

.clear-button :deep(.ripple-button-content) {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(var(--text-color), 0.48);
}

.empty-state .material-symbols-outlined {
  font-size: 44px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  width: 100%;
  padding: 12px 14px;
  background: rgba(var(--text-color), 0.045);
  box-shadow: none;
}

.history-item :deep(.ripple-button-content) {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 撑满按钮内容区，标题才能在窄列正确省略 */
.history-row {
  width: 100%;
  display: flex;
  gap: 10px;
  align-items: center;
}

.item-icon-img {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
}

.item-main {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.item-title {
  overflow: hidden;
  color: rgb(var(--text-color));
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  margin-top: 4px;
  color: rgba(var(--text-color), 0.48);
  font-size: 12px;
}

.item-arrow {
  color: rgba(var(--text-color), 0.4);
}
</style>
