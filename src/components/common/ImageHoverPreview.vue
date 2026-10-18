<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';

// 悬停快速预览（Quick Look 式）：
// - 鼠标在帖子图片上停留后才展示，快速掠过不打扰；
// - 利用阅读区右侧空余空间浮动展示，不改动帖子排版，不加暗色蒙层；
// - 右侧空间不足时自动不展示，点击图片仍进入完整图片查看器。

/** 首次悬停的意图延迟：快速掠过缩略图不会触发 */
const SHOW_DELAY = 300;
/** 预览已展示时，切换到相邻图片的延迟 */
const SWITCH_DELAY = 120;
/** 离开缩略图后的宽限期，给指针移入预览（滚动长图）留时间 */
const HIDE_GRACE = 220;
/** 预览与窗口边缘的安全距离 */
const VIEWPORT_MARGIN = 16;
/** 预览与缩略图的间距 */
const THUMB_GAP = 14;
/** 右侧可用宽度低于该值时视为空间不足，直接不展示 */
const MIN_PREVIEW_WIDTH = 260;
/** 缩略图已能看清（放大收益低于 15%）时不展示，如小图、表情包尺寸的图 */
const MIN_GAIN = 1.15;

const settings = useSettingsStore();

const open = ref(false);
const src = ref('');
const alt = ref('');
const boxStyle = ref<Record<string, string>>({});
const previewBox = ref<HTMLElement | null>(null);

let hoverTarget: HTMLImageElement | null = null;
let shownFor: HTMLImageElement | null = null;
let showTimer = 0;
let hideTimer = 0;

function hoverCapable(): boolean {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function isInsidePreview(target: EventTarget | null): boolean {
    return target instanceof Node && previewBox.value?.contains(target) === true;
}

/** 是否为可预览的帖子配图；排除查看器内部、看图模式、分享卡片中的图片 */
function findPreviewable(target: EventTarget | null): HTMLImageElement | null {
    if (!(target instanceof Element)) return null;
    const img = target.closest('img.thread-reply-img');
    if (!(img instanceof HTMLImageElement)) return null;
    if (!settings.hoverImagePreview || !hoverCapable()) return null;
    if (img.closest('.image-viewer-overlay, .gallery-open, .card-content')) return null;
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null;
    return img;
}

/** 计算缩略图右侧的可用空间；空间不足返回 null */
function availableSpace(img: HTMLImageElement): { width: number; height: number } | null {
    const rect = img.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    // 缩略图本身已经足够大时不再打扰
    const gain = Math.max(img.naturalWidth / rect.width, img.naturalHeight / rect.height);
    if (gain < MIN_GAIN) return null;
    const width = window.innerWidth - rect.right - THUMB_GAP - VIEWPORT_MARGIN;
    if (width < MIN_PREVIEW_WIDTH) return null;
    return { width, height: window.innerHeight - VIEWPORT_MARGIN * 2 };
}

function clearTimers(): void {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
}

function hide(): void {
    clearTimers();
    hoverTarget = null;
    if (shownFor) shownFor = null;
    if (open.value) open.value = false;
}

function scheduleHide(): void {
    window.clearTimeout(showTimer);
    hoverTarget = null;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, HIDE_GRACE);
}

function renderPreview(img: HTMLImageElement): void {
    const space = availableSpace(img);
    if (!space) {
        hide();
        return;
    }
    const rect = img.getBoundingClientRect();
    // 尺寸受可用窗口宽高约束，且不放大大于原始分辨率的尺寸
    const scale = Math.min(space.width / img.naturalWidth, space.height / img.naturalHeight, 1);
    const width = Math.round(img.naturalWidth * scale);
    const contentHeight = Math.round(img.naturalHeight * scale);
    const height = Math.min(contentHeight, space.height);
    const left = Math.max(VIEWPORT_MARGIN,
        Math.min(rect.right + THUMB_GAP, window.innerWidth - VIEWPORT_MARGIN - width));
    const top = Math.max(VIEWPORT_MARGIN,
        Math.min(Math.round(rect.top + rect.height / 2 - height / 2), window.innerHeight - VIEWPORT_MARGIN - height));
    src.value = img.currentSrc || img.getAttribute('src') || '';
    alt.value = img.alt || '';
    boxStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
    };
    shownFor = img;
    hoverTarget = img;
    open.value = true;
    // 切换图片时回到长图顶部
    void nextTick(() => { if (previewBox.value) previewBox.value.scrollTop = 0; });
}

function onPointerOver(event: PointerEvent): void {
    if (isInsidePreview(event.target)) {
        window.clearTimeout(hideTimer);
        return;
    }
    const img = findPreviewable(event.target);
    if (img) {
        window.clearTimeout(hideTimer);
        // 回到当前正在展示的缩略图：保持现状，不重播
        if (img === shownFor) {
            hoverTarget = img;
            return;
        }
        hoverTarget = img;
        window.clearTimeout(showTimer);
        showTimer = window.setTimeout(() => renderPreview(img), shownFor ? SWITCH_DELAY : SHOW_DELAY);
        return;
    }
    if (shownFor || hoverTarget) scheduleHide();
}

function onPointerOut(event: PointerEvent): void {
    if (!event.relatedTarget && (shownFor || hoverTarget)) scheduleHide();
}

function onPointerDown(): void {
    if (shownFor || hoverTarget) hide();
}

function onDocumentScroll(event: Event): void {
    if (!shownFor && !hoverTarget) return;
    // 预览自身的滚动（查看长图）不算页面滚动
    if (event.target instanceof Node && previewBox.value?.contains(event.target)) return;
    hide();
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && shownFor) hide();
}

watch(() => settings.hoverImagePreview, enabled => { if (!enabled) hide(); });

onMounted(() => {
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onDocumentScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
});

onBeforeUnmount(() => {
    clearTimers();
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('scroll', onDocumentScroll, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', hide);
    window.removeEventListener('blur', hide);
});
</script>

<template>
    <Teleport to="body">
        <Transition name="hpv">
            <div v-if="open" ref="previewBox" class="image-hover-preview" :style="boxStyle" role="img"
                :aria-label="alt || '图片预览'">
                <img :src="src" :alt="alt" draggable="false" referrerpolicy="no-referrer">
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.image-hover-preview {
    position: fixed;
    z-index: 3400;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    border-radius: 10px;
    background: rgb(var(--background-color));
    border: 1px solid rgba(var(--text-color), 0.12);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.image-hover-preview img {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
}

.hpv-enter-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.hpv-leave-active {
    transition: opacity 0.12s ease;
}

.hpv-enter-from {
    opacity: 0;
    transform: translateX(8px);
}

.hpv-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {

    .hpv-enter-active,
    .hpv-leave-active {
        transition: none;
    }
}
</style>
