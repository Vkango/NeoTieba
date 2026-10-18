<template>
    <div ref="containerRef" class="vertical-mask-scroll" :style="scrollStyle" @scroll="updateScrollState">
        <slot />
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

defineOptions({
    name: 'VerticalMaskScroll'
})

const props = withDefaults(defineProps<{
    fadeWidth?: number
    gap?: number | string
}>(), {
    fadeWidth: 20,
    gap: 0
})

const emit = defineEmits<{
    'scroll-state-change': [{ canScrollUp: boolean; canScrollDown: boolean; hasOverflow: boolean }]
}>()

const containerRef = ref<HTMLElement | null>(null)
const canScrollUp = ref(false)
const canScrollDown = ref(false)
const hasOverflow = ref(false)
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

const scrollStyle = computed(() => {
    const gapValue = typeof props.gap === 'number' ? `${props.gap}px` : props.gap
    const fade = `${props.fadeWidth}px`

    const maskImage = hasOverflow.value
        ? canScrollUp.value && canScrollDown.value
            ? `linear-gradient(180deg, transparent 0, rgba(0, 0, 0, 1) ${fade}, rgba(0, 0, 0, 1) calc(100% - ${fade}), transparent 100%)`
            : canScrollUp.value
                ? `linear-gradient(180deg, transparent 0, rgba(0, 0, 0, 1) ${fade}, rgba(0, 0, 0, 1) 100%)`
                : canScrollDown.value
                    ? `linear-gradient(180deg, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 1) calc(100% - ${fade}), transparent 100%)`
                    : 'none'
        : 'none'

    return {
        '--vertical-mask-scroll-gap': gapValue,
        maskImage,
        WebkitMaskImage: maskImage
    }
})

function emitScrollState() {
    emit('scroll-state-change', {
        canScrollUp: canScrollUp.value,
        canScrollDown: canScrollDown.value,
        hasOverflow: hasOverflow.value
    })
}

function updateScrollState() {
    const container = containerRef.value
    if (!container) {
        canScrollUp.value = false
        canScrollDown.value = false
        hasOverflow.value = false
        emitScrollState()
        return
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    hasOverflow.value = maxScrollTop > 1
    canScrollUp.value = container.scrollTop > 1
    canScrollDown.value = container.scrollTop < maxScrollTop - 1
    emitScrollState()
}

onMounted(() => {
    const container = containerRef.value
    if (!container) return

    updateScrollState()

    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
            updateScrollState()
        })
        resizeObserver.observe(container)
    }

    if (typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(() => {
            updateScrollState()
        })
        mutationObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true
        })
    }
})

onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
})

defineExpose({
    refresh: updateScrollState
})
</script>

<style scoped>
.vertical-mask-scroll {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    gap: var(--vertical-mask-scroll-gap, 0px);
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.vertical-mask-scroll::-webkit-scrollbar {
    display: none;
}
</style>
