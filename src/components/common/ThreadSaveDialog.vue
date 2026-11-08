<script setup lang="ts">
import { ref, watch } from 'vue';
import RippleButton from '@/components/common/RippleButton.vue';
import { useSettingsStore, type ThreadSaveDefaults } from '@/stores/settings';
import type { ArchiveSummary } from '@/core/archive';

interface Props {
  open: boolean;
  title?: string;
  confirmText?: string;
  busy?: boolean;
  archiveMeta?: ArchiveSummary | null;
}

const props = withDefaults(defineProps<Props>(), {
  title: '保存帖子',
  confirmText: '开始保存',
  busy: false,
  archiveMeta: null,
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'start', options: ThreadSaveDefaults): void;
}>();

const settings = useSettingsStore();
// 每次打开时以 设置 → 保存 的预先编辑默认项预填。
const form = ref<ThreadSaveDefaults>({ ...settings.threadSaveDefaults });
watch(() => props.open, (open) => {
  if (open) form.value = { ...settings.threadSaveDefaults };
});

const rangeId = `save-range-${Math.random().toString(36).slice(2)}`;

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

const close = (): void => emit('update:open', false);

const submit = (): void => {
  if (props.busy) return;
  emit('start', { ...form.value, pageRange: form.value.pageRange.trim() });
};
</script>

<template>
  <Teleport to="body">
  <Transition name="fade1">
    <div v-if="props.open" class="save-dialog-overlay" @click.self="close">
      <section class="save-dialog" role="dialog" aria-modal="true" :aria-label="props.title">
        <form @submit.prevent="submit">
          <h3>{{ props.title }}</h3>
          <p class="save-hint">默认选项可在 设置 → 保存 中预设</p>
          <p v-if="props.archiveMeta" class="save-archive-info" aria-live="polite">
            已存 {{ (props.archiveMeta.onlyAuthor ? props.archiveMeta.savedPagesLz : props.archiveMeta.savedPages).length }}/{{
              props.archiveMeta.totalPage }} 页 · {{ props.archiveMeta.savedFloors.length }} 组楼中楼 ·
            {{ props.archiveMeta.mediaCount }} 个媒体 · 归档大小 {{ formatBytes(props.archiveMeta.fileSize) }}
          </p>
          <div class="save-options">
            <label><input type="checkbox" v-model="form.onlyAuthor" /><span>只保存楼主</span></label>
            <label><input type="checkbox" v-model="form.saveImages" /><span>保存图片</span></label>
            <label><input type="checkbox" v-model="form.saveVideoAudio" /><span>保存视频和音频</span></label>
            <label><input type="checkbox" v-model="form.saveSubposts" /><span>保存楼中楼</span><small>楼中楼图片遵循以上规则</small></label>
            <label><input type="checkbox" v-model="form.saveAvatars" /><span>保存用户头像和吧头像</span></label>
          </div>
          <label :for="rangeId" class="save-range-label">只保存以下页（例如 1,2,1-5；留空保存全部）</label>
          <input :id="rangeId" v-model="form.pageRange" type="text" autocomplete="off" placeholder="留空保存全部" />
          <details class="save-advanced">
            <summary>高级选项（并发与重试）</summary>
            <div class="save-advanced-grid">
              <label>页面并发<input v-model.number="form.pageConcurrency" type="number" min="1" max="8" step="1" /></label>
              <label>楼中楼并发<input v-model.number="form.floorConcurrency" type="number" min="1" max="8" step="1" /></label>
              <label>媒体并发<input v-model.number="form.mediaConcurrency" type="number" min="1" max="16" step="1" /></label>
              <label>失败重试<input v-model.number="form.retryCount" type="number" min="0" max="5" step="1" /></label>
            </div>
          </details>
          <div class="save-buttons">
            <RippleButton type="button" @click="close">取消</RippleButton>
            <RippleButton type="submit" :disabled="props.busy">{{ props.busy ? '保存中…' : props.confirmText }}
            </RippleButton>
          </div>
        </form>
      </section>
    </div>
  </Transition>
  </Teleport>
</template>

<style scoped>
.save-dialog-overlay {
  position: fixed;
  inset: 0;
  /* 与楼中楼弹窗同级，确保盖过应用标签栏和自定义标题栏。 */
  z-index: 3200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.4);
}

.save-dialog {
  width: min(420px, 100%);
  padding: 24px;
  border-radius: 16px;
  background: rgb(var(--background-color));
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
}

.save-dialog h3 {
  margin: 0 0 12px;
}

.save-dialog p {
  font-size: 13px;
  opacity: 0.7;
}

.save-hint {
  margin: 0 0 12px;
  font-size: 12px;
  opacity: 0.45;
}

.save-archive-info {
  margin: 0 0 12px;
}

.save-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.save-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  cursor: pointer;
}

.save-options input {
  width: auto;
  padding: 0;
  margin: 0;
}

.save-options small {
  opacity: 0.55;
  margin-left: 4px;
}

.save-range-label {
  display: block;
  font-size: 13px;
  opacity: 0.7;
  margin-bottom: 8px;
}

.save-advanced {
  margin-top: 14px;
  font-size: 13px;
}

.save-advanced summary {
  cursor: pointer;
  opacity: 0.7;
  user-select: none;
}

.save-advanced-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

.save-advanced-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  font-size: 12px;
  opacity: 0.85;
}

.save-advanced-grid input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(var(--text-color), 0.25);
  background: rgba(var(--text-color), 0.05);
  color: rgb(var(--text-color));
  font: inherit;
}

.save-dialog input[type="text"] {
  box-sizing: border-box;
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--text-color), 0.25);
  background: rgba(var(--text-color), 0.05);
  color: rgb(var(--text-color));
  font: inherit;
}

.save-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.save-buttons button {
  padding: 10px 18px;
}

.save-buttons button[type="submit"] {
  background: rgba(var(--primary-color), 0.3);
}

.save-buttons button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
