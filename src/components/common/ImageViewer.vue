<template>
    <Transition name="fade">
        <div v-if="props.visible" class="image-viewer-overlay"
            :class="{ embedded: props.embedded, 'controls-visible': nearBottom || keyboardControls }"
            :style="props.contentWidth !== undefined ? { '--viewer-content-width': props.contentWidth + 'px' } : undefined"
            @pointermove="trackControlsProximity" @pointerleave="nearBottom = false" @click.self="handleClose"
            @contextmenu="handleContextMenu" tabindex="0" @keydown="handleKeydown" ref="overlayRef">
            <!-- Main Image Container -->
            <div class="image-wrapper" :style="wrapperStyle" @mousedown="handleMouseDown" @wheel.prevent="handleWheel"
                @touchstart="handleTouchStart" @touchmove.prevent="handleTouchMove" @touchend="handleTouchEnd">
                <p v-if="imageFailed" class="image-error" role="status">图片加载失败</p>
                <p v-if="imageBlocked" role="status">配图已禁用</p>
                <img v-if="!imageBlocked" v-show="!imageFailed" ref="imageRef" :src="resolvedImageSrc"
                    :style="fittedImageStyle" class="viewer-image" alt="Preview" draggable="false"
                    referrerpolicy="no-referrer" @load="onImageLoad" @error="handleImageError" />
            </div>

            <!-- Controls Bar -->
            <div class="controls-shell">
                <div class="controls-bar" @click.stop>
                    <slot name="gallery-controls"></slot>
                    <div class="zoom-info" role="button" tabindex="0" @keydown.enter="handleZoomMenu"
                        :title="`DPI: ${dpiScale.toFixed(2)}x`" @click="handleZoomMenu">
                        {{ Math.round(scale * 100) }}%
                    </div>

                    <div class="divider"></div>

                    <button class="control-btn" @click="zoomOut" title="缩小">
                        <span class="material-symbols-outlined">remove</span>
                    </button>

                    <RangeSlider v-model="zoomSliderValue" :min="10" :max="1000" :step="1" class="zoom-slider"
                        aria-label="图片缩放" :aria-value-text="`${Math.round(scale * 100)}%`" />

                    <button class="control-btn" @click="zoomIn" title="放大">
                        <span class="material-symbols-outlined">add</span>
                    </button>

                    <div class="divider"></div>

                    <button class="control-btn" @click="rotateLeft" title="向左旋转">
                        <span class="material-symbols-outlined">rotate_left</span>
                    </button>
                    <button class="control-btn" @click="rotateRight" title="向右旋转">
                        <span class="material-symbols-outlined">rotate_right</span>
                    </button>

                    <div class="divider"></div>

                    <button class="control-btn" :disabled="copying" @click="copyImage"
                        :title="copying ? '正在复制…' : '复制图片'">
                        <span class="material-symbols-outlined" :class="{ spinning: copying }">{{ copying ?
                            'progress_activity' : 'content_copy' }}</span>
                    </button>

                    <div class="divider"></div>

                    <button class="control-btn" @click="resetView" title="重置">
                        <span class="material-symbols-outlined">restart_alt</span>
                    </button>

                    <div v-if="!props.embedded" class="divider"></div>

                    <button v-if="!props.embedded" class="control-btn close-btn" @click="handleClose" title="关闭">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

            </div>

            <!-- Context Menu -->
            <div v-if="contextMenu.visible" class="context-menu"
                :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }" @click.stop>
                <div class="menu-item" @click="copyImage">
                    <span class="material-symbols-outlined">content_copy</span>
                    <span>复制图片</span>
                </div>
                <div class="menu-divider"></div>
                <div class="menu-item" @click="resetView">
                    <span class="material-symbols-outlined">restart_alt</span>
                    <span>重置视图</span>
                </div>
            </div>

            <!-- Zoom Preset Menu -->
            <div v-if="zoomMenu.visible" class="zoom-preset-menu" :style="{ bottom: '85px', left: zoomMenu.x + 'px' }"
                @click.stop>
                <div v-for="preset in [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8]" :key="preset" class="preset-item"
                    @click="setZoom(preset)" :class="{ active: Math.abs(scale - preset) < 0.01 }">
                    {{ Math.round(preset * 100) }}%
                </div>
            </div>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { fetchImage } from '@/core/request';
import { normalizeMediaUrl } from '@/utils/settings-policy';
import { copyImageToClipboard } from '@/utils/clipboard-image';
import { useSendToast } from '@/composables/useGlobalProvides';
import { useSettingsStore } from '@/stores/settings';
import { isArchiveUrl } from '@/composables/useOfflineMedia';
const settings = useSettingsStore();
import RangeSlider from './RangeSlider.vue';

const props = defineProps<{
    imageSrc: string;
    /** 原始远程 URL：归档副本缺失时按设置回退联网加载。 */
    fallbackSrc?: string;
    visible?: boolean;
    embedded?: boolean;
    contentWidth?: number;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
}>();


// State
const nearBottom = ref(false);
const keyboardControls = ref(false);
function trackControlsProximity(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    keyboardControls.value = false;
    const bounds = overlayRef.value?.getBoundingClientRect();
    if (!bounds) return;
    const x = event.clientX - bounds.left;
    nearBottom.value = x >= 0 && x <= (props.contentWidth ?? bounds.width)
        && event.clientY >= bounds.bottom - 120 && event.clientY <= bounds.bottom;
}
const imageFailed = ref(false);
const viewportWidth = ref(0);
const viewportHeight = ref(0);
const naturalWidth = ref(0);
const naturalHeight = ref(0);
const availableWidth = computed(() => Math.max(1, props.contentWidth ?? viewportWidth.value));
const fittedImageStyle = computed(() => {
    if (props.contentWidth === undefined || !naturalWidth.value || !naturalHeight.value) return undefined;
    const rotated = Math.abs(rotation.value / 90) % 2 !== 0;
    const width = rotated ? naturalHeight.value : naturalWidth.value;
    const height = rotated ? naturalWidth.value : naturalHeight.value;
    const fit = Math.min(availableWidth.value * .85 / width, viewportHeight.value * .85 / height);
    return { width: naturalWidth.value * fit + 'px', height: naturalHeight.value * fit + 'px', maxWidth: 'none', maxHeight: 'none' };
});
function measureViewport() {
    viewportWidth.value = overlayRef.value?.clientWidth ?? 0;
    viewportHeight.value = overlayRef.value?.clientHeight ?? 0;
    void nextTick(clampTranslation);
}
let resizeObserver: ResizeObserver | undefined;
const scale = ref(1);
const rotation = ref(0);
const translateX = ref(0);
const translateY = ref(0);
const isDragging = ref(false);
const dpiScale = ref(1);

// Interaction State
const lastMouseX = ref(0);
const lastMouseY = ref(0);
const overlayRef = ref<HTMLElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
const imageBlocked = computed(() => /^https?:|^\/\//.test(props.imageSrc) && settings.isMediaBlocked('images'));
const resolvedImageSrc = ref(imageBlocked.value ? '' : props.imageSrc);
let imageGeneration = 0;
const proxyAttempted = ref(false);
const fallbackAttempted = ref(false);

// Context Menu State
const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0
});

// Zoom Menu State
const zoomMenu = ref({
    visible: false,
    x: 0
});

// Computed
const wrapperStyle = computed(() => ({
    transform: `translate(${translateX.value - (props.contentWidth === undefined ? 0 : (viewportWidth.value - availableWidth.value) / 2)}px, ${translateY.value}px) rotate(${rotation.value}deg) scale(${scale.value})`,
    transition: isDragging.value || props.contentWidth !== undefined ? 'none' : 'transform 0.15s ease-out'
}));

const zoomSliderValue = computed({
    get: () => Math.round(scale.value * 100),
    set: (val) => {
        scale.value = val / 100;
    }
});

function clampTranslation() {
    if (!imageRef.value) return;

    const img = imageRef.value;
    const containerWidth = props.contentWidth ?? (overlayRef.value?.clientWidth || window.innerWidth);
    const containerHeight = overlayRef.value?.clientHeight || window.innerHeight;

    const isRotated = (rotation.value / 90) % 2 !== 0;

    // Calculate the actual visual size of the image on screen
    const visualW = img.clientWidth * scale.value;
    const visualH = img.clientHeight * scale.value;

    const currentW = isRotated ? visualH : visualW;
    const currentH = isRotated ? visualW : visualH;

    const maxDx = Math.max(0, (currentW - containerWidth) / 2);
    const maxDy = Math.max(0, (currentH - containerHeight) / 2);

    translateX.value = Math.max(-maxDx, Math.min(maxDx, translateX.value));
    translateY.value = Math.max(-maxDy, Math.min(maxDy, translateY.value));
}

// Lifecycle
onMounted(() => {
    dpiScale.value = window.devicePixelRatio || 1;
    window.addEventListener('resize', handleResize);
    resizeObserver = new ResizeObserver(measureViewport);
    if (overlayRef.value) resizeObserver.observe(overlayRef.value);
});

onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
    resizeObserver?.disconnect();
    handleMouseUp();
});

watch(() => props.visible, (newVal) => {
    if (newVal) {
        resetView();
        contextMenu.value.visible = false;
        zoomMenu.value.visible = false;
        nextTick(() => {
            if (!props.embedded) overlayRef.value?.focus();
            if (overlayRef.value) resizeObserver?.observe(overlayRef.value);
        });
    }
});

watch(() => [props.imageSrc, imageBlocked.value], () => {
    imageGeneration++;
    resolvedImageSrc.value = imageBlocked.value ? '' : props.imageSrc;
    proxyAttempted.value = false;
    fallbackAttempted.value = false;
});

const normalizeImageUrl = normalizeMediaUrl;

async function handleImageError(): Promise<void> {
    if (imageBlocked.value) return;
    const source = props.imageSrc;
    if (source.startsWith('data:')) {
        imageFailed.value = true;
        return;
    }
    // 归档副本缺失（如未保存图片/头像）：按设置换回原始远程 URL 联网加载。
    if (isArchiveUrl(source)) {
        if (props.fallbackSrc && settings.archiveOnlineFallback && !fallbackAttempted.value) {
            fallbackAttempted.value = true;
            proxyAttempted.value = false;
            resolvedImageSrc.value = normalizeImageUrl(props.fallbackSrc);
            return;
        }
        imageFailed.value = true;
        return;
    }
    if (proxyAttempted.value || !source) {
        imageFailed.value = true;
        return;
    }
    proxyAttempted.value = true;
    const generation = imageGeneration;
    try {
        const result = await fetchImage(normalizeImageUrl(source));
        if (!imageBlocked.value && generation === imageGeneration && props.imageSrc === source) resolvedImageSrc.value = result;
    } catch (error) {
        if (props.imageSrc === source) imageFailed.value = true;
        console.warn('原图加载失败:', source, error);
    }
}


watch(() => props.imageSrc, () => {
    imageFailed.value = false;
    fallbackAttempted.value = false;
    naturalWidth.value = 0;
    naturalHeight.value = 0;
    handleMouseUp();
    resetView();
    contextMenu.value.visible = false;
    zoomMenu.value.visible = false;
});

watch(() => props.contentWidth, () => { void nextTick(clampTranslation); });

watch([scale, rotation], () => {
    nextTick(() => clampTranslation());
});

// Event Handlers
function handleClose() {
    if (!props.embedded) emit('close');
}

function onImageLoad() {
    naturalWidth.value = imageRef.value?.naturalWidth ?? 0;
    naturalHeight.value = imageRef.value?.naturalHeight ?? 0;
    measureViewport();
    resetView();
}

function handleResize() {
    dpiScale.value = window.devicePixelRatio || 1;
    clampTranslation();
}

function handleKeydown(e: KeyboardEvent) {
    if (!props.visible) return;
    if (e.key === 'Tab') keyboardControls.value = true;

    if ((e.target as HTMLElement)?.closest('button, input')) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(e.key)) e.preventDefault();
    if (e.key === 'Escape') handleClose();
    if (e.key === 'ArrowLeft') translateX.value -= 50;
    if (e.key === 'ArrowRight') translateX.value += 50;
    if (e.key === 'ArrowUp') translateY.value -= 50;
    if (e.key === 'ArrowDown') translateY.value += 50;
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-') zoomOut();
    clampTranslation();
}

// Mouse Interaction
function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging.value = true;
    lastMouseX.value = e.clientX;
    lastMouseY.value = e.clientY;
    contextMenu.value.visible = false;
    zoomMenu.value.visible = false;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e: MouseEvent) {
    if (!isDragging.value) return;
    e.preventDefault();

    const deltaX = e.clientX - lastMouseX.value;
    const deltaY = e.clientY - lastMouseY.value;

    const rad = -rotation.value * (Math.PI / 180);
    const dx = deltaX * Math.cos(rad) - deltaY * Math.sin(rad);
    const dy = deltaX * Math.sin(rad) + deltaY * Math.cos(rad);

    translateX.value += dx;
    translateY.value += dy;

    clampTranslation();

    lastMouseX.value = e.clientX;
    lastMouseY.value = e.clientY;
}

function handleMouseUp() {
    isDragging.value = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
}

function handleWheel(e: WheelEvent) {
    contextMenu.value.visible = false;
    zoomMenu.value.visible = false;

    let zoomFactor = 0;
    if (e.ctrlKey) {
        // Pinch gesture or Ctrl+Wheel
        zoomFactor = -e.deltaY * 0.01;
    } else {
        zoomFactor = -e.deltaY * 0.001;
    }

    const newScale = Math.max(0.1, Math.min(10, scale.value + scale.value * zoomFactor));
    scale.value = newScale;
}

// Touch Interaction
interface TouchState {
    distance: number;
    lastCenter: { x: number, y: number };
}
let lastTouchState: TouchState | null = null;

function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
        isDragging.value = true;
        lastMouseX.value = e.touches[0].clientX;
        lastMouseY.value = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        isDragging.value = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const centerX = (t1.clientX + t2.clientX) / 2;
        const centerY = (t1.clientY + t2.clientY) / 2;
        lastTouchState = { distance, lastCenter: { x: centerX, y: centerY } };
    }
}

function handleTouchMove(e: TouchEvent) {
    if (e.touches.length === 1 && isDragging.value) {
        const t = e.touches[0];
        const deltaX = t.clientX - lastMouseX.value;
        const deltaY = t.clientY - lastMouseY.value;

        const rad = -rotation.value * (Math.PI / 180);
        const dx = deltaX * Math.cos(rad) - deltaY * Math.sin(rad);
        const dy = deltaX * Math.sin(rad) + deltaY * Math.cos(rad);

        translateX.value += dx;
        translateY.value += dy;
        clampTranslation();

        lastMouseX.value = t.clientX;
        lastMouseY.value = t.clientY;
    } else if (e.touches.length === 2 && lastTouchState) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const centerX = (t1.clientX + t2.clientX) / 2;
        const centerY = (t1.clientY + t2.clientY) / 2;

        const ratio = distance / lastTouchState.distance;
        scale.value = Math.max(0.1, Math.min(10, scale.value * ratio));

        const deltaX = centerX - lastTouchState.lastCenter.x;
        const deltaY = centerY - lastTouchState.lastCenter.y;

        const rad = -rotation.value * (Math.PI / 180);
        const dx = deltaX * Math.cos(rad) - deltaY * Math.sin(rad);
        const dy = deltaX * Math.sin(rad) + deltaY * Math.cos(rad);

        translateX.value += dx;
        translateY.value += dy;
        clampTranslation();

        lastTouchState = { distance, lastCenter: { x: centerX, y: centerY } };
    }
}

function handleTouchEnd() {
    isDragging.value = false;
    lastTouchState = null;
}

// Controls
function zoomIn() {
    scale.value = Math.min(10, scale.value * 1.2);
}
function zoomOut() {
    scale.value = Math.max(0.1, scale.value * 0.8);
}
function rotateLeft() {
    rotation.value -= 90;
}
function rotateRight() {
    rotation.value += 90;
}
function resetView() {
    scale.value = 1;
    rotation.value = 0;
    translateX.value = 0;
    translateY.value = 0;
    nextTick(() => clampTranslation());
}

// Copy Image
const sendToast = useSendToast();
const copying = ref(false);
async function copyImage() {
    if (copying.value || imageFailed.value || imageBlocked.value) return;
    copying.value = true;
    contextMenu.value.visible = false;
    try {
        await copyImageToClipboard(resolvedImageSrc.value || props.imageSrc);
        sendToast('图片已复制到剪贴板', 2000);
    } catch (error) {
        console.warn('复制图片失败:', props.imageSrc, error);
        sendToast('复制图片失败，请稍后重试', 3000);
    } finally {
        copying.value = false;
    }
}

// Context Menu
function handleContextMenu(e: MouseEvent) {
    e.preventDefault();

    const menuWidth = 220;
    const menuHeight = 130;
    const bounds = overlayRef.value?.getBoundingClientRect();
    let x = e.clientX - (bounds?.left ?? 0);
    let y = e.clientY - (bounds?.top ?? 0);

    if (x + menuWidth > (overlayRef.value?.clientWidth || window.innerWidth)) x -= menuWidth;
    if (y + menuHeight > (overlayRef.value?.clientHeight || window.innerHeight)) y -= menuHeight;

    zoomMenu.value.visible = false;
    contextMenu.value = {
        visible: true,
        x: Math.max(0, x),
        y: Math.max(0, y)
    };
}

// Zoom Preset Menu
function handleZoomMenu(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    zoomMenu.value = {
        visible: !zoomMenu.value.visible,
        x: Math.max(0, rect.left - (overlayRef.value?.getBoundingClientRect().left ?? 0) + rect.width / 2 - 50) // Center roughly
    };
    contextMenu.value.visible = false;
}

function setZoom(preset: number) {
    scale.value = preset;
    zoomMenu.value.visible = false;
}


</script>

<style scoped>
.image-viewer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(var(--background-color), 0.5);
    z-index: 20000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    user-select: none;
    outline: none;
}

.image-viewer-overlay.embedded {
    position: relative;
    width: 100%;
    height: 100%;
    z-index: 0;
    backdrop-filter: none;
    background: transparent;
}

/* Native macOS window controls sit over the WebView. Keep all image panning
   and its grab cursor below the 45px titlebar, even while the image is zoomed. */
html.macos .image-viewer-overlay:not(.embedded) {
    top: 45px;
    height: calc(100vh - 45px);
}

.image-error {
    color: rgba(var(--text-color), .65);
}

.controls-shell {
    position: absolute;
    bottom: 0;
    left: 0;
    width: var(--viewer-content-width, 100%);
    min-height: 120px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 16px 12px;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 20001;
}

.controls-visible .controls-bar {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
}

.embedded .context-menu,
.embedded .zoom-preset-menu {
    position: absolute;
    z-index: 3;
}


@media (hover: none) {
    .controls-bar {
        opacity: 1;
        transform: none;
        pointer-events: auto;
    }
}

@media (prefers-reduced-motion: reduce) {
    .controls-bar {
        transition: none;
    }
}

.image-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    will-change: transform;
    cursor: grab;
}

.image-wrapper:active {
    cursor: grabbing;
}

.viewer-image {
    max-width: 85%;
    max-height: 85%;
    object-fit: contain;
    /* box-shadow: 0 0 40px rgba(0, 0, 0, 0.7); */
    pointer-events: auto;
}

.controls-bar {
    position: relative;
    opacity: 0;
    pointer-events: none;
    transform: translateY(8px);
    transition: opacity .18s ease, transform .18s ease;
    background-color: rgba(var(--background-color), 0.48);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    padding: 6px 10px;
    border-radius: 14px;
    max-width: 100%;
    box-sizing: border-box;
    justify-content: center;
    flex-wrap: wrap;
    display: flex;
    align-items: center;
    gap: 4px;
    box-shadow: none;
    z-index: 20001;
    color: rgb(var(--text-color));
    border: 1px solid rgba(var(--text-color), 0.12);
}

.control-btn {
    background: transparent;
    border: none;
    color: rgb(var(--text-color));
    cursor: pointer;
    width: 28px;
    height: 28px;
    padding: 4px;
    flex-shrink: 0;
    border-radius: 8px;
    box-shadow: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.control-btn:hover {
    background-color: rgba(var(--text-color), 0.12);
    color: rgb(var(--text-color));
    transform: scale(1.15);
}

.control-btn:active {
    transform: scale(0.9);
}

.control-btn.close-btn:hover {
    background-color: rgba(255, 60, 60, 0.45);
}

.material-symbols-outlined {
    font-size: 18px;
}

.material-symbols-outlined.spinning {
    animation: viewer-spin 0.9s linear infinite;
}

@keyframes viewer-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .material-symbols-outlined.spinning {
        animation: none;
    }
}

.zoom-info {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 40px;
    box-sizing: border-box;
    text-align: center;
    opacity: 0.95;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    transition: background-color 0.2s;
}

.zoom-info:hover {
    background-color: rgba(var(--text-color), 0.1);
}

.zoom-slider {
    flex: 0 0 88px;
    width: 88px;
    min-width: 88px;
    height: 28px;
    padding: 12px 0;
    box-sizing: border-box;
}

.zoom-slider :deep(.range-input) {
    padding: 0;
}

.zoom-slider:focus-within {
    outline: 2px solid rgba(var(--text-color), .7);
    outline-offset: 2px;
    border-radius: 6px;
}

.divider {
    width: 1px;
    height: 18px;
    flex-shrink: 0;
    background-color: rgba(var(--text-color), 0.2);
    margin: 0 2px;
}

.context-menu {
    position: fixed;
    background: rgb(var(--background-color));
    border-radius: 12px;
    padding: 8px;
    min-width: 220px;
    box-shadow: 0 15px 50px rgba(0, 0, 0, 0.7);
    z-index: 20002;
    color: rgb(var(--text-color));
    border: 1px solid rgba(var(--text-color), 0.15);
    animation: menu-pop 0.15s cubic-bezier(0, 0, 0.2, 1);
}

@keyframes menu-pop {
    from {
        opacity: 0;
        transform: scale(0.9);
    }

    to {
        opacity: 1;
        transform: scale(1);
    }
}

.context-menu .menu-item {
    padding: 10px 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 14px;
    border-radius: 8px;
    transition: background 0.2s;
}

.context-menu .menu-item:hover {
    background-color: rgba(var(--text-color), 0.12);
}

.context-menu .menu-item .material-symbols-outlined {
    font-size: 20px;
    color: rgba(var(--text-color), .7);
}

.menu-divider {
    height: 1px;
    background-color: rgba(var(--text-color), 0.1);
    margin: 6px 8px;
}

.zoom-preset-menu {
    position: fixed;
    background: rgb(var(--background-color));
    border-radius: 12px;
    padding: 6px;
    min-width: 100px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 20002;
    color: rgb(var(--text-color));
    border: 1px solid rgba(var(--text-color), 0.15);
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.zoom-preset-menu .preset-item {
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    border-radius: 6px;
    text-align: center;
    transition: background 0.2s;
}

.zoom-preset-menu .preset-item:hover {
    background-color: rgba(var(--text-color), 0.1);
}

.zoom-preset-menu .preset-item.active {
    background-color: #3b82f6;
    color: white;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
