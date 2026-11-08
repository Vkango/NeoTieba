<script setup lang="ts">
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type CSSProperties } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { processContentElements } from '@/utils/helper';
import { hydrateVoiceAudios } from '@/utils/amr-voice';
import { toMediaUrl } from '@/utils/settings-policy';
import { isArchiveUrl, useArchiveFallback, useOfflineMedia } from '@/composables/useOfflineMedia';
import { ReaderSource, type ReaderCursor, type ReaderPage } from '@/utils/reader-source';
import { ReaderPaginator, readerGeometry, compareReaderCursor } from '@/utils/reader-layout';
import ThreadReaderSheet from './ThreadReaderSheet.vue';
import RangeSlider from '@/components/common/RangeSlider.vue';
import type { ContentElement } from '@/types/common';
const ThreadReaderReplies = defineAsyncComponent(() => import('./ThreadReaderReplies.vue'));

interface ReadingPost {
  id: string | number;
  author_id: string | number;
  floor?: number;
  content?: ContentElement[];
  sub_post_number?: number | string;
  author?: { name_show?: string; name?: string; user_name?: string; portrait?: string };
}
const props = defineProps<{
  posts: ReadingPost[]; title: string; initialPostId: string; loading: boolean; hasMore: boolean; error: string;
  onlyAuthor?: boolean;
  tid?: string;
  local?: boolean;
}>();
const emit = defineEmits<{
  (event: 'position', id: string): void;
  (event: 'loadMore' | 'close'): void;
  (event: 'jump' | 'onlyAuthor'): void;
  (event: 'openUser', id: string | number): void;
}>();
const settings = useSettingsStore();
const offlineMedia = useOfflineMedia();
const archiveFallback = useArchiveFallback();
const openImageViewer = inject<((url: string) => void) | undefined>('openImageViewer', undefined);
const root = ref<HTMLElement>();
const viewport = ref<HTMLElement>();
const controls = ref<HTMLElement>();
const controlsSpace = ref(80);
const outlineOpen = ref(false);
const outlinePanel = ref<HTMLElement>();
const outlineButton = ref<HTMLButtonElement>();
const sizeOpen = ref(false);
const sizePanel = ref<HTMLElement>();
const sizeButton = ref<HTMLButtonElement>();
const replyPostId = ref('');
const replyPost = computed(() => props.posts.find(post => String(post.id) === replyPostId.value));
let replyTrigger: HTMLElement | undefined;
const fontSize = ref<number>();
const fontWeight = ref(400);
const imageSize = ref(100);
const appliedSize = shallowRef({ fontSize: undefined as number | undefined, fontWeight: 400, imageScale: 1 });
const width = ref(1);
const height = ref(1);
const nearBottom = ref(false);
const busy = ref(false);
const currentIndex = ref(0);
const firstKnown = ref(0);
const lastKnown = ref(0);
const knownStart = shallowRef<ReaderCursor>();
const knownEnd = shallowRef<ReaderCursor>();
const current = shallowRef<ReaderPage>();
const mountedScreens = shallowRef<{ index: number; data: ReaderPage }[]>([]);
const fontFamily = ref('sans-serif');
const geometry = computed(() => readerGeometry(width.value, height.value, fontFamily.value, appliedSize.value));
const layout = computed<CSSProperties>(() => ({
  width: width.value + 'px', height: height.value + 'px', fontFamily: fontFamily.value,
  '--reader-font-size': geometry.value.fontSize + 'px', '--reader-line-height': geometry.value.lineHeight + 'px',
  '--reader-font-weight': geometry.value.fontWeight,
  '--reader-title-line-height': Math.max(36, Math.round((geometry.value.fontSize + 6) * 1.4)) + 'px',
  '--reader-title-size': (geometry.value.fontSize + 6) + 'px', '--reader-columns': geometry.value.columns,
}));
const floorRange = computed(() => {
  const parts = current.value?.parts ?? [];
  return parts.length ? `第 ${parts[0].floor} 楼 - 第 ${parts[parts.length - 1].floor} 楼` : '暂无正文';
});
const atStart = computed(() => !current.value || (current.value.start.post === 0 && current.value.start.offset === 0));
const atEnd = computed(() => !current.value || current.value.end.post >= props.posts.length);

// Only previous/current/next pages own live DOM or HTML. Older pages retain compact, stable source boundaries.
const pages = new Map<number, ReaderPage>();
const boundaries = new Map<number, { start: ReaderCursor; end: ReaderCursor }>();
const sources = new Map<number, ReaderSource>();
const mediaSizes = new Map<string, { width: number; height: number }>();
let sourceUnits = 0;
let observer: ResizeObserver | undefined;
let controlsObserver: ResizeObserver | undefined;
let snapTimer: ReturnType<typeof setTimeout> | undefined;
let wheelAt = 0;
let horizontalAt = -Infinity;
let horizontalDistance = 0;
let horizontalCommitted = false;
let sizeFrame = 0;
let disposed = false;
let resettingScroll = false;
let queuedRebuild: { start: ReaderCursor; reset: boolean } | undefined;
let revision = 0;
let pendingAdvance = false;
let awaitingMore = false;
let prefetchedFor = '';

function source(index: number): ReaderSource {
  const cached = sources.get(index);
  if (cached) { sources.delete(index); sources.set(index, cached); return cached; }
  const post = props.posts[index];
  if (!post) return new ReaderSource('');
  const blocked = {
    avatars: settings.isMediaBlocked('avatars'), images: settings.isMediaBlocked('images'),
    videos: settings.isMediaBlocked('videos'), audio: settings.isMediaBlocked('audio')
  };
  const template = document.createElement('template');
  template.innerHTML = processContentElements(Array.isArray(post.content) && post.content.length
    ? post.content : [{ type: 0, text: props.title }], false, blocked, offlineMedia);
  // Prefer API dimensions before an image loads; the paginator owns its actual page box.
  const dimensions = new Map<string, { width: number; height: number }>();
  for (const item of post.content || []) {
    const key = item.bigCdnSrc || item.big_cdn_src || item.bigSrc || item.big_src || item.originSrc || item.origin_src || item.link;
    const pair = String(item.bsize || item.big_size || '').match(/\d+/g);
    const w = Number(item.width || pair?.[0]);
    const h = Number(item.height || pair?.[1]);
    if (typeof key === 'string' && w > 0 && h > 0) dimensions.set(key, { width: w, height: h });
  }
  for (const media of template.content.querySelectorAll<HTMLImageElement | HTMLVideoElement>('.thread-reply-img')) {
    const key = media.dataset.fullSrc || media.dataset.remoteSrc || media.getAttribute('src') || '';
    const size = dimensions.get(key);
    if (size) { media.setAttribute('width', String(size.width)); media.setAttribute('height', String(size.height)); }
    media.setAttribute('preload', 'none');
  }
  const replies = { postId: String(post.id), count: Number(post.sub_post_number || 0) };
  const parsed = new ReaderSource(template.innerHTML, replies);
  const meaningful = template.content.textContent?.trim() || template.content.querySelector('img, video, audio, hr');
  const result = parsed.length && meaningful ? parsed : new ReaderSource('[该楼层暂无正文]', replies);
  sources.set(index, result);
  sourceUnits += result.length;
  while (sources.size > 64 || (sourceUnits > 65536 && sources.size > 1)) {
    const oldest = sources.keys().next().value!;
    sourceUnits -= sources.get(oldest)!.length;
    sources.delete(oldest);
  }
  return result;
}
function clearSources() { sources.clear(); sourceUnits = 0; }
const paginator = new ReaderPaginator(() => props.posts, source, key => mediaSizes.get(key));
function forward(start: ReaderCursor, stop?: ReaderCursor): ReaderPage {
  return paginator.page(start, geometry.value, props.title, stop);
}
async function backward(end: ReaderCursor): Promise<ReaderPage> {
  const version = revision;
  const items: { post: number; from: number; to: number }[] = [];
  let cursor = { ...end };
  let units = 0;
  for (let examined = 0; examined < 64 && units < 16384 && (cursor.post > 0 || cursor.offset > 0); examined++) {
    if (cursor.offset === 0) { cursor.post--; cursor.offset = source(cursor.post).length; }
    const from = source(cursor.post).previousStart(cursor.offset);
    if (items[0]?.post === cursor.post) items[0].from = from;
    else items.unshift({ post: cursor.post, from, to: cursor.offset });
    units += cursor.offset - from;
    cursor = { post: cursor.post, offset: from };
    const page = forward(cursor, end);
    if (compareReaderCursor(page.end, end) >= 0) continue;
    // Reverse layout is needed only for a previously unseen page before an arbitrary entry point.
    // Visited pages always reuse their exact checkpoints, in both directions.
    let low = 0;
    let high = Math.max(0, units - 1);
    const at = (skip: number): ReaderCursor => {
      for (const item of items) {
        const length = item.to - item.from;
        if (skip >= length) { skip -= length; continue; }
        const offset = source(item.post).pageStartOffset(item.from + skip);
        return offset >= source(item.post).length ? { post: item.post + 1, offset: 0 } : { post: item.post, offset };
      }
      return end;
    };
    let attempts = 0;
    while (low < high && !disposed && version === revision) {
      const middle = Math.floor((low + high) / 2);
      if (compareReaderCursor(forward(at(middle), end).end, end) < 0) low = middle + 1;
      else high = middle;
      if (++attempts % 4 === 0) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return forward(at(low), end);
  }
  return forward(cursor, end);
}
function remember(index: number, data: ReaderPage) {
  pages.set(index, data);
  boundaries.set(index, { start: data.start, end: data.end });
  if (boundaries.size > 1024) boundaries.delete(boundaries.keys().next().value!);
  if (index <= firstKnown.value) knownStart.value = data.start;
  if (index >= lastKnown.value) knownEnd.value = data.end;
  firstKnown.value = Math.min(firstKnown.value, index);
  lastKnown.value = Math.max(lastKnown.value, index);
}
async function publish() {
  if (disposed) return;
  const index = currentIndex.value;
  for (const key of pages.keys()) if (Math.abs(key - index) > 1) pages.delete(key);
  current.value = pages.get(index);
  mountedScreens.value = Array.from(pages, ([i, data]) => ({ index: i, data })).sort((a, b) => a.index - b.index);
  await nextTick();
  if (disposed) return;
  resettingScroll = true;
  // Keep the active page in the middle slot. Pruning/prefetching pages must never
  // resize the scroll track or shift its origin under the browser's scroll anchoring.
  viewport.value?.scrollTo({ left: width.value, behavior: 'instant' });
  requestAnimationFrame(() => { resettingScroll = false; });
  const first = current.value?.parts[0];
  if (first) emit('position', first.id);
  const live = viewport.value?.querySelector(`[data-screen-index="${index}"]`);
  hydrateVoiceAudios(live);
}
async function neighbors() {
  const data = pages.get(currentIndex.value);
  if (!data || disposed) return;
  if ((data.start.post > 0 || data.start.offset > 0) && !pages.has(currentIndex.value - 1)) {
    const previous = boundaries.get(currentIndex.value - 1);
    remember(currentIndex.value - 1, previous && compareReaderCursor(previous.end, data.start) === 0
      ? forward(previous.start, previous.end) : await backward(data.start));
  }
  if (data.end.post < props.posts.length && !pages.has(currentIndex.value + 1)) {
    const next = boundaries.get(currentIndex.value + 1);
    remember(currentIndex.value + 1, next && compareReaderCursor(next.start, data.end) === 0
      ? forward(next.start, next.end) : forward(data.end));
  }
}
function requestMore(force = false) {
  if (props.loading || awaitingMore || !props.hasMore || (!force && props.error)) return;
  const data = current.value;
  const next = pages.get(currentIndex.value + 1);
  if (!data || (!force && (next?.end ?? data.end).post < props.posts.length)) return;
  const key = `${data.start.post}:${data.start.offset}`;
  // One API-page prefetch per user-visible screen. Appending data cannot recursively fetch the whole thread.
  if (!force && prefetchedFor === key) return;
  prefetchedFor = key;
  awaitingMore = true;
  emit('loadMore');
}
async function work(task: () => Promise<void>) {
  busy.value = true;
  try { await task(); }
  finally {
    busy.value = false;
    if (disposed) return;
    if (queuedRebuild) { const queued = queuedRebuild; queuedRebuild = undefined; void rebuild(queued.start, queued.reset); }
    else if (pendingAdvance && pages.has(currentIndex.value + 1)) { pendingAdvance = false; void activate(currentIndex.value + 1); }
    else requestMore();
  }
}
async function rebuild(start = current.value?.start ?? { post: 0, offset: 0 }, reset = false) {
  if (disposed) return;
  if (busy.value) { queuedRebuild = { start, reset }; return; }
  if (reset) { currentIndex.value = 0; firstKnown.value = 0; lastKnown.value = 0; boundaries.clear(); }
  await work(async () => {
    const version = revision;
    const w = viewport.value?.clientWidth ?? 0;
    const h = viewport.value?.clientHeight ?? 0;
    if (!w || !h) return;
    const family = getComputedStyle(root.value!).fontFamily;
    if (width.value !== w || height.value !== h || fontFamily.value !== family) {
      if (fontFamily.value !== family) paginator.clear();
      boundaries.clear(); firstKnown.value = currentIndex.value; lastKnown.value = currentIndex.value;
    }
    width.value = w; height.value = h; fontFamily.value = family;
    pages.clear();
    const data = await forward(start);
    if (version !== revision || disposed) return;
    remember(currentIndex.value, data);
    await publish();
    await neighbors();
    await publish();
  });
}
async function activate(index: number) {
  if (busy.value || disposed || !pages.has(index)) return;
  await work(async () => {
    currentIndex.value = index;
    await publish();
    await neighbors();
    await publish();
  });
}
function step(direction: number) {
  if (busy.value) return;
  const target = currentIndex.value + direction;
  if (pages.has(target)) { void activate(target); return; }
  if (direction > 0 && props.hasMore) { pendingAdvance = true; requestMore(true); }
}
async function navigateToFloor(id: string) {
  const index = props.posts.findIndex(post => String(post.id) === id);
  if (index >= 0) { prefetchedFor = ''; await rebuild({ post: index, offset: 0 }, true); }
}
function interactive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, video, audio, [contenteditable="true"]'));
}
function onWheel(event: WheelEvent) {
  if (event.ctrlKey || interactive(event.target)) return;
  const now = performance.now();
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
  if (horizontal || now - horizontalAt < 180) {
    event.preventDefault();
    if (now - horizontalAt >= 180) { horizontalDistance = 0; horizontalCommitted = false; }
    horizontalAt = now;
    // Lock one swipe (including its momentum tail) to one page; ignore diagonal tail noise.
    if (!horizontal || horizontalCommitted || busy.value) return;
    const delta = event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const pixels = delta * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? width.value : 1);
    if (horizontalDistance * pixels < 0) horizontalDistance = 0;
    horizontalDistance += pixels;
    if (Math.abs(horizontalDistance) < 48) return;
    horizontalCommitted = true;
    clearTimeout(snapTimer);
    step(horizontalDistance > 0 ? 1 : -1);
    return;
  }
  event.preventDefault();
  if (Math.abs(event.deltaY) < 2 || now - wheelAt < 240) return;
  wheelAt = now; step(event.deltaY > 0 ? 1 : -1);
}
function onKey(event: KeyboardEvent) {
  if (replyPostId.value) return;
  if (sizeOpen.value && event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); closeSize(); return;
  }
  if (outlineOpen.value) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeOutline(); }
    if (event.key === 'Tab') {
      const buttons = outlinePanel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, [tabindex="0"]');
      const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey || interactive(event.target)) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return; }
  if (event.target instanceof Element && event.target.closest('button, a')) return;
  if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' '].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  step(event.key === 'ArrowLeft' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -1 : 1);
}
async function toggleOutline() {
  sizeOpen.value = false;
  if (outlineOpen.value) { closeOutline(); return; }
  outlineOpen.value = true;
  await nextTick();
  outlinePanel.value?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
}
function closeOutline() {
  outlineOpen.value = false;
  outlineButton.value?.focus({ preventScroll: true });
}
async function toggleSize() {
  if (sizeOpen.value) { closeSize(); return; }
  sizeOpen.value = true;
  await nextTick();
  sizePanel.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
}
function closeSize(focus = true) {
  sizeOpen.value = false;
  if (focus) sizeButton.value?.focus({ preventScroll: true });
}
function onRootPointerDown(event: PointerEvent) {
  if (sizeOpen.value && event.target instanceof Element && !event.target.closest('.reader-size-panel, .reader-size-button')) closeSize(false);
}
function scheduleSize() {
  if (sizeFrame) return;
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = 0;
    if (disposed) return;
    if (busy.value) { scheduleSize(); return; }
    appliedSize.value = { fontSize: fontSize.value, fontWeight: fontWeight.value, imageScale: imageSize.value / 100 };
    paginator.clear(); boundaries.clear();
    firstKnown.value = currentIndex.value; lastKnown.value = currentIndex.value;
    void rebuild();
  });
}
watch([fontSize, fontWeight, imageSize], scheduleSize);
function onScroll() {
  if (resettingScroll || busy.value) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const offset = (viewport.value?.scrollLeft ?? width.value) - width.value;
    const direction = Math.abs(offset) >= Math.min(64, width.value * .1) ? Math.sign(offset) : 0;
    const target = currentIndex.value + direction;
    if (target !== currentIndex.value && pages.has(target)) void activate(target);
    else viewport.value?.scrollTo({ left: width.value, behavior: 'instant' });
  }, 140);
}
function onPointer(event: PointerEvent) {
  const bounds = root.value?.getBoundingClientRect();
  if (bounds && event.pointerType !== 'touch') nearBottom.value = event.clientY >= bounds.bottom - 120;
}
function onClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const replies = target.closest<HTMLElement>('.reader-replies');
  if (replies && props.tid) {
    replyTrigger = replies;
    replyPostId.value = replies.dataset.postId || '';
    sizeOpen.value = false;
    return;
  }
  const at = target.closest('.at-button');
  if (at) { const id = at.getAttribute('uid'); if (id) emit('openUser', id); }
  if (target instanceof HTMLImageElement && target.classList.contains('thread-reply-img')) openImageViewer?.(offlineMedia(target.dataset.fullSrc || target.src));
}
function closeReplies() {
  replyPostId.value = '';
  void nextTick(() => {
    if (replyTrigger?.isConnected) replyTrigger.focus({ preventScroll: true });
    else root.value?.focus({ preventScroll: true });
    replyTrigger = undefined;
  });
}
function onMediaLoad(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement) || !target.classList.contains('thread-reply-img')) return;
  const key = target.dataset.fullSrc || target.dataset.remoteSrc || target.getAttribute('src') || '';
  const size = target instanceof HTMLImageElement ? { width: target.naturalWidth, height: target.naturalHeight }
    : { width: target.videoWidth, height: target.videoHeight };
  const old = mediaSizes.get(key);
  if (!size.width || !size.height || (old?.width === size.width && old?.height === size.height)) return;
  mediaSizes.set(key, size);
  if (mediaSizes.size > 64) mediaSizes.delete(mediaSizes.keys().next().value!);
  if (Number(target.getAttribute('width')) === size.width && Number(target.getAttribute('height')) === size.height) return;
  boundaries.clear(); firstKnown.value = currentIndex.value; lastKnown.value = currentIndex.value; void rebuild();
}
function mediaError(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || !target.classList.contains('thread-reply-img')) return;
  if (isArchiveUrl(target.src) && settings.archiveOnlineFallback && !target.dataset.remoteFallback) { archiveFallback(event); return; }
  if (!isArchiveUrl(target.src) && !target.dataset.retryAttempted) {
    target.dataset.retryAttempted = 'true'; target.src = `${toMediaUrl(target.dataset.fullSrc || target.src)}?r=1`; return;
  }
  const placeholder = document.createElement('span'); placeholder.textContent = '[图片加载失败]'; target.replaceWith(placeholder);
}
watch(() => [props.posts, props.posts.length, props.posts[0]?.id] as const, (next, previous) => {
  const active = current.value;
  if (active?.parts.length && (next[0] !== previous?.[0] || String(props.posts[active.start.post]?.id) !== active.parts[0].id)) {
    revision++;
    clearSources(); paginator.clear(); boundaries.clear();
    prefetchedFor = '';
    const index = props.posts.findIndex(post => String(post.id) === active.parts[0].id);
    void rebuild({ post: Math.max(0, index), offset: 0 }, true);
  } else {
    if (previous && next[1] > previous[1]) {
      // A checkpoint at the old API tail was provisional, not a permanent book page break.
      // Retaining it would preserve a half-empty page even after the next batch arrived.
      for (const [index, boundary] of boundaries) if (boundary.end.post >= previous[1]) boundaries.delete(index);
      if (knownEnd.value && knownEnd.value.post >= previous[1]) lastKnown.value = currentIndex.value;
    }
    void rebuild();
  }
});
watch(() => props.hasMore, hasMore => { if (hasMore && !busy.value) requestMore(); });
watch(() => props.loading, loading => { if (!loading) { awaitingMore = false; if (props.error) pendingAdvance = false; } });
watch(() => [settings.imageGrid, settings.isMediaBlocked('images'), settings.isMediaBlocked('videos'), settings.isMediaBlocked('audio')], () => {
  clearSources(); paginator.clear(); boundaries.clear(); void rebuild();
});
function onFontsLoaded() {
  paginator.clear(); boundaries.clear(); firstKnown.value = currentIndex.value; lastKnown.value = currentIndex.value;
  void rebuild();
}
watch(() => settings.globalFont, async () => { await nextTick(); await document.fonts.ready; if (!disposed) onFontsLoaded(); });
onMounted(async () => {
  await document.fonts.ready;
  if (disposed) return;
  const index = props.posts.findIndex(post => String(post.id) === props.initialPostId);
  await rebuild({ post: Math.max(0, index), offset: 0 });
  if (disposed) return;
  observer = new ResizeObserver(() => {
    if (viewport.value && (viewport.value.clientWidth !== width.value || viewport.value.clientHeight !== height.value)) void rebuild();
  });
  if (viewport.value) observer.observe(viewport.value);
  controlsObserver = new ResizeObserver(() => {
    // Always reserve the same space, including when the hover toolbar is hidden or wraps.
    controlsSpace.value = Math.ceil(controls.value?.getBoundingClientRect().height ?? 48) + 32;
  });
  if (controls.value) controlsObserver.observe(controls.value);
  document.fonts.addEventListener('loadingdone', onFontsLoaded);
  root.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); controlsObserver?.disconnect(); document.fonts.removeEventListener('loadingdone', onFontsLoaded); clearTimeout(snapTimer); cancelAnimationFrame(sizeFrame); pages.clear(); boundaries.clear(); clearSources(); paginator.clear(); mediaSizes.clear(); });
defineExpose({ navigateToFloor, focus: () => root.value?.focus({ preventScroll: true }) });
</script>

<template>
  <section ref="root" class="thread-reader" :class="{ 'controls-visible': nearBottom || sizeOpen }" tabindex="0" aria-label="看文模式"
    @pointermove="onPointer" @pointerleave="nearBottom = false" @pointerdown="onRootPointerDown" @keydown="onKey">
    <div ref="viewport" class="reader-viewport" :style="{ bottom: controlsSpace + 'px' }"
      :inert="outlineOpen || Boolean(replyPostId) || undefined" @scroll="onScroll" @wheel="onWheel" @click="onClick" @load.capture="onMediaLoad"
      @loadedmetadata.capture="onMediaLoad" @error.capture="mediaError">
      <div class="reader-track" :style="{ width: `${3 * width}px` }">
        <div v-for="screen in mountedScreens" :key="screen.index" class="reader-screen"
          :data-screen-index="screen.index" :aria-hidden="screen.index !== currentIndex"
          :inert="screen.index !== currentIndex || undefined"
          :style="{ left: `${(screen.index - currentIndex + 1) * width}px`, width: `${width}px` }">
          <ThreadReaderSheet :page="screen.data" :layout="layout" @open-user="emit('openUser', $event)" />
        </div>
      </div>
    </div>
    <p v-if="!posts.length" class="reader-empty">暂无正文</p>
    <div class="reader-controls-shell">
      <nav ref="controls" class="reader-controls" aria-label="阅读控制" :inert="outlineOpen || Boolean(replyPostId) || undefined">
        <button type="button" :disabled="atStart" :aria-disabled="busy || atStart" title="上一屏" aria-label="上一屏"
          @click="step(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
        <button type="button" :disabled="atEnd && !hasMore" :aria-disabled="busy || (atEnd && (!hasMore || loading))"
          title="下一屏" aria-label="下一屏" @click="step(1)"><span
            class="material-symbols-outlined">chevron_right</span></button>
        <span class="reader-range" aria-live="polite">{{ floorRange }}</span>
        <button type="button" aria-label="跳页" title="跳转到帖子页" :aria-disabled="busy || loading"
          @click="!busy && !loading && emit('jump')"><span
            class="material-symbols-outlined">find_in_page</span></button>
        <button type="button" :aria-label="onlyAuthor ? '查看全部回复' : '只看楼主'" :title="onlyAuthor ? '查看全部回复' : '只看楼主'"
          :aria-pressed="Boolean(onlyAuthor)" :aria-disabled="busy || loading"
          @click="!busy && !loading && emit('onlyAuthor')"><span class="material-symbols-outlined">{{ onlyAuthor ?
            'group' : 'person' }}</span></button>
        <button ref="outlineButton" type="button" aria-label="大纲" title="大纲" :aria-expanded="outlineOpen"
          @click="toggleOutline"><span class="material-symbols-outlined">format_list_bulleted</span></button>
        <button ref="sizeButton" type="button" class="reader-size-button" aria-label="大小" title="大小" :aria-expanded="sizeOpen"
          @click="toggleSize"><span class="material-symbols-outlined">format_size</span></button>
        <button v-if="error" type="button" :aria-disabled="busy || loading"
          @click="!busy && requestMore(true)">加载失败，重试</button>
        <button type="button" title="退出看文模式" aria-label="退出看文模式" @click="emit('close')"><span
            class="material-symbols-outlined">close</span></button>
      </nav>
    </div>
    <section v-if="sizeOpen" ref="sizePanel" class="reader-size-panel" :style="{ bottom: controlsSpace + 8 + 'px', maxHeight: `calc(100% - ${controlsSpace + 24}px)` }" aria-label="阅读大小">
      <header><strong>阅读大小</strong><button type="button" aria-label="关闭大小设置" @click="closeSize()"><span class="material-symbols-outlined">close</span></button></header>
      <div class="reader-size-row"><div><span>字体大小</span><output>{{ fontSize ?? geometry.fontSize }} px</output></div>
        <RangeSlider :model-value="fontSize ?? geometry.fontSize" @update:model-value="fontSize = $event" :min="14" :max="32" :step="1" aria-label="字体大小" /></div>
      <div class="reader-size-row"><div><span>字体粗细</span><output>{{ fontWeight }}</output></div>
        <RangeSlider v-model="fontWeight" :min="300" :max="700" :step="100" aria-label="字体粗细" /></div>
      <div class="reader-size-row"><div><span>图片大小</span><output>{{ imageSize }}%</output></div>
        <RangeSlider v-model="imageSize" :min="50" :max="250" :step="10" aria-label="图片大小" /></div>
    </section>
    <ThreadReaderReplies v-if="replyPost && tid" :key="replyPostId" :tid="tid" :pid="replyPost.id"
      :floor="replyPost.floor" :count="Number(replyPost.sub_post_number || 0)" :local="local"
      :author-id="replyPost.author_id" :author-name="replyPost.author?.name_show || replyPost.author?.name || replyPost.author?.user_name || '匿名用户'"
      :author-avatar="replyPost.author?.portrait || ''" @close="closeReplies" @open-user="emit('openUser', $event)" />
    <Transition name="reader-drawer">
      <div v-if="outlineOpen" class="reader-outline-overlay" :inert="!outlineOpen || undefined"
        @click.self="closeOutline">
        <aside ref="outlinePanel" class="reader-outline" role="dialog" aria-modal="true" aria-label="大纲">
          <slot name="outline" :close="closeOutline" />
        </aside>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.thread-reader {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: rgb(var(--text-color));
  outline: none;
  background-color: rgba(var(--text-color), 0.02);
  border-radius: 5px;
}

.reader-viewport {
  position: absolute;
  inset: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior: contain;
  overflow-anchor: none;
  scroll-behavior: auto;
}

.reader-viewport::-webkit-scrollbar {
  display: none;
}

.reader-track {
  position: relative;
  height: 100%;
}

.reader-screen {
  position: absolute;
  top: 0;
  height: 100%;
  overflow: hidden;
}

.reader-empty {
  position: absolute;
  top: 40px;
  left: 40px;
  opacity: .6;
}

.reader-controls-shell {
  position: absolute;
  inset: auto 0 0;
  min-height: 120px;
  padding: 16px 12px;
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
}

.reader-controls {
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 100%;
  padding: 6px 10px;
  border-radius: 14px;
  background: rgba(var(--background-color), .48);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font-size: 13px;
}

.controls-visible .reader-controls,
.reader-controls:has(:focus-visible) {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.reader-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  box-shadow: none;
  padding: 4px 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.reader-controls button:hover {
  background: rgba(var(--text-color), .08);
}

.reader-controls button:disabled {
  opacity: .3;
  cursor: default;
}

.reader-controls button:focus-visible {
  outline: 2px solid rgb(var(--primary-color));
  outline-offset: 2px;
}

.reader-range {
  padding: 0 8px;
  font-variant-numeric: tabular-nums;
}

.reader-range {
  white-space: nowrap;
}

.reader-controls button[aria-pressed="true"] {
  background: rgba(var(--primary-color), .16);
  color: rgb(var(--primary-color));
}

.reader-size-panel { position: absolute; z-index: 2; left: 50%; transform: translateX(-50%); width: min(320px, calc(100% - 24px)); box-sizing: border-box; padding: 16px 20px; border: 1px solid rgba(var(--text-color), .1); border-radius: 16px; background: rgba(var(--background-color), .7); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); box-shadow: 0 8px 28px rgba(0, 0, 0, .15); overflow-y: auto; }
.reader-size-panel header { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.reader-size-panel header button { display: grid; place-items: center; padding: 4px; margin-right: -6px; border: 0; box-shadow: none; background: transparent; color: inherit; cursor: pointer; border-radius: 6px; }
.reader-size-row { margin-top: 18px; }
.reader-size-row > div:first-child { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 13px; }
.reader-size-row output { opacity: .6; font-variant-numeric: tabular-nums; }
.reader-size-panel :deep(.range-slider) { width: 100%; }
.reader-size-panel :deep(.range-slider:focus-within .range-thumb) { outline: 2px solid rgb(var(--primary-color)); outline-offset: 3px; }

.reader-outline-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  background: rgba(0, 0, 0, .2);
}

.reader-outline {
  position: absolute;
  inset: 0 auto 0 0;
  width: min(360px, 100%);
  background: rgba(var(--background-color), .55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: 8px 0 24px rgba(0, 0, 0, .18);
}

.reader-drawer-enter-active,
.reader-drawer-leave-active {
  transition: opacity .24s ease;
}

.reader-drawer-enter-active .reader-outline,
.reader-drawer-leave-active .reader-outline {
  transition: transform .24s cubic-bezier(.2, .8, .2, 1);
}

.reader-drawer-enter-from,
.reader-drawer-leave-to {
  opacity: 0;
}

.reader-drawer-enter-from .reader-outline,
.reader-drawer-leave-to .reader-outline {
  transform: translateX(-100%);
}

@media (hover: none) {
  .reader-controls {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {

  .reader-drawer-enter-active,
  .reader-drawer-leave-active,
  .reader-drawer-enter-active .reader-outline,
  .reader-drawer-leave-active .reader-outline {
    transition: none;
  }

  .reader-controls {
    transition: none;
  }
}
</style>
