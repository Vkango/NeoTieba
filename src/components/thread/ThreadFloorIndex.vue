<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FLOOR_INDEX_SIZE, floorWindowStart } from '@/utils/thread-index';

interface Entry { id: string; floor: number; avatar: string; preview: string }
const props = defineProps<{
  entries: Entry[];
  currentId: string;
  readingIndex: number;
  readingPage: number;
  totalPages?: number;
  busy: boolean;
  local?: boolean;
  galleryActive?: boolean;
  favourite: boolean;
  favouriteHere: boolean;
  onlyAuthor: boolean;
  panel?: boolean;
  hasMore?: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  (event: 'navigate', id: string, edge?: 'start' | 'end'): void;
  (event: 'jump' | 'onlyAuthor' | 'bookmark' | 'removeBookmark' | 'gallery' | 'reader'): void;
  (event: 'close'): void;
  (event: 'loadMore'): void;
}>();
const isOpen = ref(Boolean(props.panel));
const windowStart = ref(0);
const listElement = ref<HTMLElement>();
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let followFrame = 0;
let requestedTail = '';
const current = computed(() => props.entries.find(entry => entry.id === props.currentId));
// Keep the full-height outline bounded even for very long threads.
const panelStart = computed(() => props.panel ? Math.max(0, windowStart.value - 4) : 0);
const visibleEntries = computed(() => props.entries.slice(panelStart.value, props.panel ? panelStart.value + 64 : undefined)
  .map((entry, index) => ({ entry, index: panelStart.value + index })));

function rowStep() {
  if (props.panel) return 47;
  const row = listElement.value?.querySelector<HTMLElement>('.floor-entry');
  return row ? row.getBoundingClientRect().height + 3 : 43;
}
async function syncList() {
  await nextTick();
  if (listElement.value) listElement.value.scrollTop = windowStart.value * rowStep();
}
function onListScroll() {
  if (listElement.value) windowStart.value = Math.floor(listElement.value.scrollTop / rowStep());
  requestMore();
}
function requestMore(retry = false) {
  const list = listElement.value;
  if (!props.panel || !props.hasMore || props.busy || (!retry && props.error) || !list) return;
  if (!retry && list.scrollHeight - list.scrollTop - list.clientHeight > 64) return;
  const tail = `${props.entries.length}:${props.entries[props.entries.length - 1]?.id}`;
  if (!retry && requestedTail === tail) return;
  requestedTail = tail;
  emit('loadMore');
}

function open() {
  clearTimeout(closeTimer);
  isOpen.value = true;
}
function close() {
  if (props.panel) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { isOpen.value = false; followCurrent(); }, 160);
}
async function followCurrent(animate = false) {
  await nextTick();
  const list = listElement.value;
  if (!list) return;
  cancelAnimationFrame(followFrame);
  const target = Math.max(0, Math.min(list.scrollHeight - list.clientHeight,
    (props.panel ? props.entries.findIndex(entry => entry.id === props.currentId) * rowStep() - list.clientHeight / 2
      : (props.readingIndex - (FLOOR_INDEX_SIZE - 1) / 2) * rowStep())));
  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    list.scrollTop = target;
    return;
  }
  const from = list.scrollTop;
  const start = performance.now();
  function step(now: number) {
    const progress = Math.min(1, (now - start) / 220);
    list!.scrollTop = from + (target - from) * (1 - Math.pow(1 - progress, 3));
    if (progress < 1) followFrame = requestAnimationFrame(step);
    else followFrame = 0;
  }
  followFrame = requestAnimationFrame(step);
}
watch(() => props.entries.map(entry => entry.id), (ids, previous) => {
  const oldStart = previous?.[windowStart.value];
  const preserved = oldStart ? ids.indexOf(oldStart) : -1;
  windowStart.value = preserved >= 0 ? preserved : floorWindowStart(ids.length, ids.indexOf(props.currentId));
  if (props.panel && preserved >= 0) {
    // Appending index entries must not pull the drawer back to the reading floor.
    const scrollTop = listElement.value?.scrollTop ?? 0;
    void nextTick(() => {
      if (listElement.value) listElement.value.scrollTop = scrollTop;
    });
    return;
  }
  requestedTail = '';
  void followCurrent(Boolean(previous?.length && ids.length > previous.length));
});
watch(() => props.readingIndex, () => { void followCurrent(); });
watch(() => props.currentId, () => { if (props.panel) void followCurrent(); });
onMounted(() => { if (props.panel) void followCurrent(); });

function browseList() {
  cancelAnimationFrame(followFrame);
  followFrame = 0;
  requestMore();
}

function reveal(id: string, edge?: 'start' | 'end') {
  const index = props.entries.findIndex(entry => entry.id === id);
  if (index >= 0) windowStart.value = floorWindowStart(props.entries.length, index, edge);
  void syncList();
}
function navigate(entry: Entry, index: number) {
  emit('navigate', entry.id, index === windowStart.value ? 'start' : index === Math.min(props.entries.length - 1, windowStart.value + FLOOR_INDEX_SIZE - 1) ? 'end' : undefined);
}
function onFocusOut(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) close();
}
onBeforeUnmount(() => { clearTimeout(closeTimer); cancelAnimationFrame(followFrame); });
defineExpose({ reveal });
</script>

<template>
  <nav class="floor-index" :class="{ expanded: isOpen, panel }" aria-label="楼层索引" @mouseenter="open" @mouseleave="close"
    @focusin="open" @focusout="onFocusOut" @keydown.esc.stop="panel ? emit('close') : (isOpen = false)">
    <header v-if="panel" class="outline-heading"><strong>大纲</strong><span>{{ entries.length }} 楼</span><button type="button" aria-label="关闭大纲" @click="emit('close')"><span class="material-symbols-outlined">close</span></button></header>
    <div ref="listElement" class="floor-entries"
      :style="{ '--visible-rows': Math.min(entries.length, FLOOR_INDEX_SIZE) }" @scroll="onListScroll"
      @wheel.stop="browseList" @touchmove.stop="browseList">
      <div v-if="panel" aria-hidden="true" :style="{ height: panelStart * 47 + 'px', flexShrink: 0 }"></div>
      <button v-for="{ entry, index } in visibleEntries" :key="entry.id" type="button" class="floor-entry"
        :class="{ current: entry.id === currentId }" :aria-current="entry.id === currentId ? 'location' : undefined"
        :aria-label="'跳转到第 ' + entry.floor + ' 楼'" :disabled="busy" @click="navigate(entry, index)">
        <span class="floor-summary" :aria-hidden="!isOpen">
          <RemoteImage kind="avatars" v-if="isOpen" :src="entry.avatar" alt="" loading="lazy" referrerpolicy="no-referrer" />
          <span class="floor-number">{{ entry.floor }} 楼</span>
          <span class="floor-preview">{{ entry.preview }}</span>
        </span>
        <span class="floor-tick" aria-hidden="true"></span>
      </button>
      <div v-if="panel" aria-hidden="true" :style="{ height: Math.max(0, entries.length - panelStart - visibleEntries.length) * 47 + 'px', flexShrink: 0 }"></div>
    </div>
    <button v-if="panel && error" class="outline-retry" type="button" :disabled="busy" @click="requestMore(true)">加载失败，重试</button>
    <div v-if="!panel" class="index-tools" :aria-hidden="!isOpen" :inert="!isOpen || undefined">
      <span class="reading-position">{{ current?.floor }}楼 · {{ readingPage }}{{ totalPages ? '/' + totalPages : ''
        }}页</span>
      <button type="button" :aria-label="galleryActive ? '退出看图模式' : '看图模式'" :title="galleryActive ? '退出看图模式' : '看图模式'" :aria-pressed="Boolean(galleryActive)" :disabled="busy" @click="emit('gallery')">
        <span class="material-symbols-outlined">photo_library</span>
      </button>
      <button type="button" aria-label="看文模式" title="看文模式" :disabled="busy" @click="emit('reader')">
        <span class="material-symbols-outlined">auto_stories</span>
      </button>
      <button type="button" aria-label="跳页" title="跳页" :disabled="busy" @click="emit('jump')">
        <span class="material-symbols-outlined">find_in_page</span>
      </button>
      <button type="button" :aria-label="onlyAuthor ? '查看全部回复' : '只看楼主'" :aria-pressed="onlyAuthor"
        :title="local ? '本地帖子暂不支持只看楼主' : onlyAuthor ? '查看全部回复' : '只看楼主'" :disabled="busy || local"
        @click="emit('onlyAuthor')">
        <span class="material-symbols-outlined">{{ onlyAuthor ? 'group' : 'person' }}</span>
      </button>
      <button type="button" :aria-label="favouriteHere ? '取消收藏' : '收藏到当前楼层'"
        :title="favouriteHere ? '取消收藏' : '收藏到第 ' + current?.floor + ' 楼'" :disabled="busy || local"
        @click="emit('bookmark')">
        <span class="material-symbols-outlined">{{ favouriteHere ? 'bookmark_added' : 'bookmark' }}</span>
      </button>
      <button v-if="favourite && !favouriteHere" type="button" aria-label="取消收藏" title="取消收藏" :disabled="busy || local"
        @click="emit('removeBookmark')">
        <span class="material-symbols-outlined">bookmark_remove</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.floor-index {
  position: absolute;
  top: 50%;
  right: 12px;
  /* 低于分屏分隔条工具条（z-index 5），避免展开时盖住它；
     全局标签栏/通知等在更高层级，不受影响 */
  z-index: 4;
  transform: translateY(-50%);
  width: 34px;
  max-width: calc(100% - 24px);
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: rgb(var(--text-color));
  transition: width 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.floor-index.expanded {
  width: 360px;
  background: rgba(var(--background-color), 0.3);
  border-color: rgba(var(--text-color), 0.16);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(20px);
}

/* 紧凑分屏格：悬浮索引会盖住整列内容，直接不显示（楼层跳转仍可用键盘/滚动） */
@container pane (max-width: 480px) {
  .floor-index {
    display: none;
  }
}

.floor-entries {
  --row-height: clamp(20px, calc((100vh - 180px) / 10), 40px);
  display: flex;
  flex-direction: column;
  gap: 3px;
  height: calc(var(--visible-rows) * (var(--row-height) + 3px) - 3px);
  overflow-y: hidden;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.expanded .floor-entries {
  overflow-y: auto;
}

.floor-entries::-webkit-scrollbar {
  display: none;
}

.floor-index .floor-entry {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  height: var(--row-height);
  flex-shrink: 0;
  width: 100%;
  padding: 0 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  box-shadow: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.floor-index .floor-entry:hover {
  background: rgba(var(--text-color), 0.1);
}


.floor-tick {
  width: 14px;
  height: 2px;
  flex-shrink: 0;
  background: currentColor;
  opacity: 0.35;
  border-radius: 2px;
}

.current .floor-tick {
  opacity: 1;
  width: 18px;
}

.floor-summary {
  display: none;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex: 1;
  text-align: left;
}

.expanded .floor-summary {
  display: flex;
}

.floor-summary img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.floor-number {
  font-size: 11px;
  opacity: 0.55;
  flex-shrink: 0;
}

.floor-preview {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  opacity: 0.72;
}

.current .floor-preview {
  opacity: 1;
}

.index-tools {
  height: 38px;
  display: flex;
  gap: 3px;
  align-items: center;
  visibility: hidden;
  overflow: hidden;
  margin-top: 6px;
}

.expanded .index-tools {
  visibility: visible;
  border-top: 1px solid rgba(var(--text-color), 0.08);
}

.reading-position {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  font-size: 11px;
  opacity: 0.6;
  padding-left: 8px;
}

.floor-index .index-tools button {
  padding: 5px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
  color: inherit;
  cursor: pointer;
}

.floor-index .index-tools button:hover {
  background: rgba(var(--text-color), 0.1);
}

.index-tools .material-symbols-outlined {
  font-size: 19px;
}

.floor-index button:disabled {
  opacity: 0.5;
  cursor: default;
}

.floor-index button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .floor-index {
    transition: none;
  }
}

.floor-index.panel { position: absolute; inset: 0; display: flex; flex-direction: column; transform: none; width: 100%; max-width: none; height: 100%; padding: 12px; box-sizing: border-box; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.panel .floor-entries { --row-height: 44px; flex: 1; min-height: 0; height: auto; gap: 0; overflow-y: auto; scrollbar-width: thin; }
.panel .floor-entry { height: 47px; border-radius: 8px; }
.panel .floor-entry.current { background: rgba(var(--primary-color), .12); }
.panel .floor-summary { display: flex; }
.outline-heading { display: flex; align-items: center; gap: 12px; padding: 0 8px 12px; }
.outline-heading > span { opacity: .55; font-size: 12px; }
.outline-heading button { margin-left: auto; display: grid; place-items: center; padding: 5px; border: 0; box-shadow: none; background: transparent; color: inherit; cursor: pointer; }
.outline-retry { flex-shrink: 0; margin-top: 8px; padding: 8px; border: 0; border-radius: 8px; box-shadow: none; color: inherit; background: rgba(var(--text-color), .06); cursor: pointer; }
</style>
