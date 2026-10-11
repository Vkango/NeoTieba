<script setup lang="ts">
import { computed, inject, onActivated, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import Container from '@/components/common/Container.vue';
import RemoteImage from '@/components/common/RemoteImage.vue';
import ThreadSaveDialog from '@/components/common/ThreadSaveDialog.vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  archiveDelete,
  archiveList,
  threadSaveCancel,
  threadSaveStart,
  threadSaveStatus,
  type ArchiveSummary,
  type ThreadSaveProgress,
} from '@/core/archive';
import { resolveProxyUrl } from '@/core/request';
import { useSettingsStore, type ThreadSaveDefaults } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { useTabNavigation } from '@/composables/useTabNavigation';

interface Props {
  key_: string | number;
}

const props = defineProps<Props>();

const sendToast = inject<(title: string, duration: number) => void>('sendToast');
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');
const { openThread } = useTabNavigation();
const settings = useSettingsStore();
const userStore = useUserStore();

const archives: Ref<ArchiveSummary[]> = ref([]);
const isLoading = ref(true);
const isDeleting = ref('');
const searchInput = ref('');
/** 保存中的任务：tid → 最近一次进度事件。 */
const progressMap = ref<Record<string, ThreadSaveProgress>>({});
let unlistenSave: UnlistenFn | undefined;

const filtered = computed(() => {
  const keyword = searchInput.value.trim().toLowerCase();
  if (!keyword) return archives.value;
  return archives.value.filter(item =>
    item.title.toLowerCase().includes(keyword) ||
    item.forumName.toLowerCase().includes(keyword) ||
    item.tid.includes(keyword)
  );
});

const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatDate = (timestamp: number): string => {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}/${mm}/${dd} ${hh}:${mi}`;
};

// 各阶段粗略加权，得到整任务进度：页面 0-50%，楼中楼 50-80%，媒体 80-100%。
const PHASE_RANGE: Record<string, [number, number]> = { pages: [0, 50], floors: [50, 80], media: [80, 100] };
const percentOf = (progress: ThreadSaveProgress | undefined): number => {
  if (!progress) return 0;
  const range = PHASE_RANGE[progress.phase];
  if (!range) return 0;
  const [from, to] = range;
  if (!progress.total) return from;
  return Math.round(from + ((to - from) * progress.done) / progress.total);
};

const isSaving = (tid: string): boolean => progressMap.value[tid] !== undefined;

const refresh = async (): Promise<void> => {
  try {
    archives.value = await archiveList();
    // 启动时同步一次运行中状态（例如保存自别的标签页发起）。
    for (const item of archives.value) {
      if (progressMap.value[item.tid]) continue;
      if (await threadSaveStatus(item.tid).catch(() => false)) {
        progressMap.value[item.tid] = { tid: item.tid, phase: 'pages', done: 0, total: 0, message: '正在保存...' };
      }
    }
  } catch (error) {
    console.error('读取归档失败:', error);
    sendToast?.('读取归档失败', 3000);
  } finally {
    isLoading.value = false;
  }
};

/** 正在通过对话框配置更新选项的归档项；非空即对话框打开。 */
const editing = ref<ArchiveSummary | null>(null);

const open = (item: ArchiveSummary): void => {
  openThread(item.tid, { local: true, title: item.title });
};

/** 点更新：先弹选项对话框（以默认项预填），确认后才启动。 */
const update = (item: ArchiveSummary): void => {
  if (isSaving(item.tid)) return;
  editing.value = item;
};

const startUpdate = async (options: ThreadSaveDefaults): Promise<void> => {
  const item = editing.value;
  if (!item || isSaving(item.tid)) return;
  const user = userStore.currentUser;
  try {
    await threadSaveStart(
      item.tid,
      { ...options, pageRange: options.pageRange.trim() || undefined },
      user?.bduss ?? '',
      user?.stoken ?? '',
      resolveProxyUrl()
    );
    // 本次使用的选项回写为默认项，与设置页保持一致。
    settings.threadSaveDefaults = { ...options };
    progressMap.value[item.tid] = { tid: item.tid, phase: 'pages', done: 0, total: 0, message: '正在保存...' };
    editing.value = null;
    sendToast?.(`已开始更新《${item.title}》`, 2500);
  } catch (error) {
    sendToast?.(error instanceof Error ? error.message : String(error), 3000);
  }
};

const cancel = async (item: ArchiveSummary): Promise<void> => {
  await threadSaveCancel(item.tid).catch(() => undefined);
};

const remove = async (item: ArchiveSummary): Promise<void> => {
  if (isDeleting.value || isSaving(item.tid)) return;
  isDeleting.value = item.tid;
  try {
    await archiveDelete(item.tid);
    archives.value = archives.value.filter(entry => entry.tid !== item.tid);
    sendToast?.(`已删除《${item.title}》的归档`, 2500);
  } catch (error) {
    console.error('删除归档失败:', error);
    sendToast?.('删除归档失败', 3000);
  } finally {
    isDeleting.value = '';
  }
};

const handleSaveEvent = (payload: ThreadSaveProgress): void => {
  if (payload.phase === 'done') {
    delete progressMap.value[payload.tid];
    sendToast?.(`保存成功：${payload.message}`, 3000);
    void refresh();
  } else if (payload.phase === 'error') {
    delete progressMap.value[payload.tid];
    sendToast?.(`保存失败：${payload.message}`, 4000);
  } else if (payload.phase === 'cancelled') {
    delete progressMap.value[payload.tid];
    sendToast?.(payload.message, 2500);
  } else {
    // 新任务（列表中还没有的 tid）出现时拉一次列表，保持响应式。
    if (!archives.value.some(item => item.tid === payload.tid)) void refresh();
    progressMap.value[payload.tid] = payload;
  }
};

onMounted(async (): Promise<void> => {
  updateTabMeta?.({ key: props.key_, title: '归档', icon: '/assets/inbox.svg', icon_invert: true });
  unlistenSave = await listen<ThreadSaveProgress>('thread-save-progress', event => handleSaveEvent(event.payload));
  await refresh();
});

// keep-alive 下切回本页时自动同步，无需手动刷新。
onActivated(() => {
  void refresh();
});

onBeforeUnmount(() => {
  unlistenSave?.();
  unlistenSave = undefined;
});
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`library-${props.key_}`">
    <div class="library">
      <div class="library-header">
        <div class="library-title">归档</div>
        <input v-model="searchInput" class="library-search" type="text" placeholder="搜索标题 / 吧名 / 帖子ID"
          data-kb-search autocomplete="off" />
      </div>

      <transition name="fade1">
        <Loading class="loading-box" v-if="isLoading"></Loading>
      </transition>

      <div v-if="!isLoading && filtered.length === 0" class="library-empty">
        <span class="material-symbols-outlined" style="font-size: 44px; opacity: 0.4;">inventory_2</span>
        <div>还没有归档的帖子</div>
        <div class="library-empty-hint">打开任意帖子，点击标题旁的保存按钮即可存入归档</div>
      </div>

      <div class="library-list" v-if="!isLoading">
        <div class="library-item" v-for="item in filtered" :key="item.tid" :class="{ saving: isSaving(item.tid) }">
          <RemoteImage class="library-forum-avatar" kind="avatars" :src="item.forumAvatar" />
          <div class="library-info" @click="!isSaving(item.tid) && open(item)">
            <div class="library-thread-title">{{ item.title }}</div>
            <div class="library-meta">
              <span>{{ item.forumName }}吧</span>
              <span>{{ (item.onlyAuthor ? item.savedPagesLz : item.savedPages).length }}/{{ item.totalPage }} 页</span>
              <span v-if="item.floorCount > 0">{{ item.floorCount }} 组楼中楼</span>
              <span v-if="item.mediaCount > 0">{{ item.mediaCount }} 媒体</span>
              <span>{{ formatBytes(item.fileSize) }}</span>
              <span>{{ item.onlyAuthor ? '仅楼主' : '全本' }}</span>
            </div>
            <template v-if="isSaving(item.tid)">
              <div class="library-progress-text">{{ progressMap[item.tid]?.message || '正在保存...' }}</div>
              <div class="library-progress-bar">
                <div class="library-progress-fill" :style="{ width: percentOf(progressMap[item.tid]) + '%' }"></div>
              </div>
            </template>
            <div v-else class="library-time">保存于 {{ formatDate(item.updatedAt) }} · ID {{ item.tid }}</div>
          </div>
          <div class="library-actions">
            <template v-if="isSaving(item.tid)">
              <button class="library-action danger" title="取消保存" @click="cancel(item)">
                <span class="material-symbols-outlined">close</span>
              </button>
            </template>
            <template v-else>
              <button class="library-action" title="打开" @click="open(item)">
                <span class="material-symbols-outlined">open_in_new</span>
              </button>
              <button class="library-action" title="更新（增量保存）" @click="update(item)">
                <span class="material-symbols-outlined">sync</span>
              </button>
              <button class="library-action danger" title="删除归档" :disabled="isDeleting === item.tid"
                @click="remove(item)">
                <span class="material-symbols-outlined">{{ isDeleting === item.tid ? 'hourglass_top' : 'delete'
                }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <ThreadSaveDialog :open="editing !== null" :title="editing ? `更新归档：《${editing.title}》` : '更新归档'" confirm-text="开始更新"
      :archive-meta="editing" :busy="editing !== null && isSaving(editing.tid)"
      @update:open="value => { if (!value) editing = null; }" @start="startUpdate" />
  </Container>
</template>

<style scoped>
.library {
  width: 82%;
  margin: 0 auto;
  padding: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.library-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.library-title {
  font-size: 20px;
  font-weight: bold;
  margin-right: auto;
}

.library-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 0;
  opacity: 0.65;
}

.library-empty-hint {
  font-size: 13px;
  opacity: 0.7;
}

.library-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.library-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--text-color), 0.04);
}

.library-item.saving {
  background: rgba(var(--primary-color), 0.08);
}

.library-forum-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
}

.library-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.library-thread-title {
  font-size: 14px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.library-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  opacity: 0.6;
}

.library-time {
  font-size: 12px;
  opacity: 0.4;
}

.library-progress-text {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.library-progress-bar {
  height: 3px;
  border-radius: 3px;
  background: rgba(var(--text-color), 0.12);
  overflow: hidden;
}

.library-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: rgba(var(--primary-color), 0.85);
  transition: width 0.3s ease;
}

.library-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

/* 图标按钮：透明背景，悬停轻反馈，不污染全局样式（scoped）。 */
.library-action {
  background: transparent;
  border: none;
  box-shadow: none;
  color: rgba(var(--text-color), 0.65);
  cursor: pointer;
  width: 28px;
  height: 28px;
  padding: 4px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, color 0.2s;
}

.library-action:hover {
  background: rgba(var(--text-color), 0.08);
  color: rgb(var(--text-color));
}

.library-action:disabled {
  opacity: 0.4;
  cursor: default;
}

.library-action .material-symbols-outlined {
  font-size: 17px;
}

.library-action.danger:hover {
  color: #e05656;
  background: rgba(224, 86, 86, 0.1);
}
</style>
