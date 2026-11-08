<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SubPostView from './SubPostView.vue';

defineProps<{
  tid: string; pid: string | number; floor?: number; count: number; local?: boolean;
  authorId: string | number; authorName: string; authorAvatar: string;
}>();
const emit = defineEmits<{ (event: 'close'): void; (event: 'openUser', id: string | number): void }>();
const panel = ref<HTMLElement>();
onMounted(() => panel.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return; }
  if (event.key !== 'Tab') return;
  const items = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, [tabindex="0"]');
  const first = items?.[0]; const last = items?.[items.length - 1];
  if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
}
</script>

<template>
  <div class="reader-replies-overlay" @click.self="emit('close')" @keydown.stop="onKey">
    <section ref="panel" class="reader-replies-panel" role="dialog" aria-modal="true" :aria-label="`第 ${floor} 楼的回复`">
      <header><div><strong>第 {{ floor }} 楼的回复</strong><span>{{ count }} 条回复</span></div>
        <button type="button" aria-label="关闭回复列表" @click="emit('close')"><span class="material-symbols-outlined">close</span></button>
      </header>
      <div class="reader-replies-content component-container">
        <SubPostView :tid="tid" :pid="pid" :reply_num="count" :local="local" expanded
          :floor-avatar="authorAvatar" :floor-uid="authorId" :floor-name="authorName"
          @open-user="emit('openUser', $event)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.reader-replies-overlay { position: absolute; inset: 0; z-index: 4; background: rgba(0, 0, 0, .2); }
.reader-replies-panel { position: absolute; inset: 0 0 0 auto; width: min(520px, 100%); display: flex; flex-direction: column; color: rgb(var(--text-color)); background: rgba(var(--background-color), .75); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); box-shadow: -8px 0 24px rgba(0, 0, 0, .18); }
header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid rgba(var(--text-color), .08); }
header > div { display: flex; flex-direction: column; gap: 4px; }
header strong { font-size: 15px; font-weight: 600; }
header div > span { font-size: 12px; opacity: .55; }
header button { display: grid; place-items: center; padding: 6px; color: inherit; background: transparent; border: 0; border-radius: 8px; box-shadow: none; cursor: pointer; }
header button:focus-visible { outline: 2px solid rgb(var(--primary-color)); outline-offset: 2px; }
.reader-replies-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 20px; }
</style>
