<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { hotkeyState } from '@/core/hotkeys';
import RippleButton from './RippleButton.vue';

const sendToast = inject<(title: string, duration: number) => void>('sendToast');
const emit = defineEmits<{
  (event: 'openThread', tid: string): void;
}>();
const destination = ref<{ url: string; site: string; threadId?: string } | null>(null);

// 打开期间让全局键盘控制引擎静默，Esc/Tab 由本组件的捕获监听处理
watch(destination, (value) => {
  hotkeyState.externalDialogOpen = value !== null;
});
const dialogRef = ref<HTMLElement | null>(null);
const cancelRef = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

function closeDialog(): void {
  destination.value = null;
  previousFocus?.focus();
  previousFocus = null;
}

function handleLinkClick(event: MouseEvent): void {
  if (event.type === 'auxclick' && event.button !== 1) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a[href]');
  if (!anchor) return;
  const href = anchor.getAttribute('href')?.trim();
  if (href?.startsWith('#')) return;

  // Capture before content handlers and stop the WebView's default navigation.
  event.preventDefault();
  event.stopPropagation();
  if (destination.value) return;

  try {
    const url = new URL(href || '');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported link protocol');
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const threadMatch = url.host === 'tieba.baidu.com' && !url.username && !url.password
      ? url.pathname.match(/^\/p\/([1-9]\d*)\/?$/)
      : null;
    destination.value = { url: url.href, site: url.host, threadId: threadMatch?.[1] };
    nextTick(() => cancelRef.value?.focus());
  } catch {
    sendToast?.('链接无效或不支持，无法打开', 3000);
  }
}

async function confirmOpen(): Promise<void> {
  const url = destination.value?.url;
  if (!url) return;
  closeDialog();
  try {
    await openUrl(url);
  } catch (error) {
    console.error('打开外部链接失败:', error);
    sendToast?.('无法打开系统浏览器，请重试', 3000);
  }
}

function openInApp(): void {
  const tid = destination.value?.threadId;
  if (!tid) return;
  closeDialog();
  emit('openThread', tid);
}

function handleKeydown(event: KeyboardEvent): void {
  if (!destination.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeDialog();
  } else if (event.key === 'Tab') {
    const buttons = dialogRef.value?.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    event.preventDefault();
    const current = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement);
    const next = (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}

onMounted(() => {
  document.addEventListener('click', handleLinkClick, true);
  document.addEventListener('auxclick', handleLinkClick, true);
  window.addEventListener('keydown', handleKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleLinkClick, true);
  document.removeEventListener('auxclick', handleLinkClick, true);
  window.removeEventListener('keydown', handleKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="external-link">
      <div v-if="destination" class="external-link-overlay" @click.self="closeDialog">
        <section ref="dialogRef" class="external-link-dialog" role="dialog" aria-modal="true"
          aria-labelledby="external-link-title" aria-describedby="external-link-message">
          <h3 id="external-link-title">{{ destination.threadId ? '打开贴吧帖子' : '打开外部链接' }}</h3>
          <p v-if="destination.threadId" id="external-link-message">这是贴吧帖子链接，请选择在应用内或系统浏览器中打开。前往站点前，请确保链接可信。</p>
          <p v-else id="external-link-message">即将前往 <strong>{{ destination.site }}</strong> 站点，请确保可信。</p>
          <div class="external-link-url">{{ destination.url }}</div>
          <div class="external-link-actions">
            <RippleButton v-if="destination.threadId" class="external-link-confirm" @click="openInApp">应用内打开</RippleButton>
            <RippleButton class="external-link-confirm" @click="confirmOpen">{{ destination.threadId ? '浏览器打开' : '确定' }}</RippleButton>
            <button ref="cancelRef" class="external-link-cancel" @click="closeDialog">取消</button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.external-link-overlay {
  position: fixed;
  inset: 0;
  z-index: 30000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.4);
}

.external-link-dialog {
  box-sizing: border-box;
  width: 440px;
  max-width: 100%;
  padding: 24px;
  color: rgba(var(--text-color), 1);
  background: rgba(var(--background-color), 1);
  border: 1px solid rgba(var(--text-color), 0.1);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3);
}

h3 {
  margin: 0 0 16px;
  font-size: 16px;
}

p {
  margin: 0 0 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.external-link-url {
  max-height: 120px;
  overflow: auto;
  overflow-wrap: anywhere;
  font-size: 12px;
  opacity: 0.6;
  user-select: text;
}

.external-link-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}

.external-link-confirm,
.external-link-cancel {
  padding: 8px 20px;
  color: rgba(var(--text-color), 1);
  background: rgba(var(--text-color), 0.1);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.external-link-cancel {
  background: transparent;
}

.external-link-confirm:focus-visible,
.external-link-cancel:focus-visible {
  outline: 2px solid rgba(var(--text-color), 0.6);
  outline-offset: 2px;
}

.external-link-enter-active,
.external-link-leave-active {
  transition: opacity 0.2s ease;
}

.external-link-enter-from,
.external-link-leave-to {
  opacity: 0;
}
</style>
