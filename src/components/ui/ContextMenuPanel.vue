<template>
    <MotionDiv ref="panelRef" class="ctx-panel" :class="{ 'is-positioned': isPositioned }" :style="panelStyle"
        :initial="{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }"
        :animate="{ opacity: 1, scale: 1, filter: 'blur(0px)' }"
        :exit="{ opacity: 0, scale: 0.94, filter: 'blur(8px)' }" :transition="panelTransition" role="menu"
        :aria-label="ariaLabel" @contextmenu.prevent.stop>
        <template v-for="(item, index) in items" :key="item.id ?? `sep-${index}`">
            <div v-if="item.separator" class="ctx-separator" role="separator" />
            <div v-else class="ctx-item" :class="{
                active: activeIndex === index || openSubmenu?.index === index,
                disabled: item.disabled,
                danger: item.destructive
            }" role="menuitem" :tabindex="-1" :aria-disabled="item.disabled || undefined"
                :aria-haspopup="item.children ? 'menu' : undefined"
                :aria-expanded="item.children ? openSubmenu?.index === index : undefined"
                :data-ctx-index="index" @pointerenter="handleItemPointerEnter(item, index, $event)"
                @click="handleItemClick(item, index, $event)">
                <span class="ctx-item-icon">
                    <span v-if="item.checked" class="material-symbols-outlined ctx-symbol">check</span>
                    <component :is="item.icon" v-else-if="item.icon && !isStringIcon(item.icon)" :size="15"
                        :stroke-width="1.8" />
                    <span v-else-if="item.icon" class="material-symbols-outlined ctx-symbol">{{ item.icon }}</span>
                </span>
                <span class="ctx-item-label">{{ item.label }}</span>
                <span v-if="item.shortcut" class="ctx-item-shortcut">{{ item.shortcut }}</span>
                <span v-if="item.children"
                    class="material-symbols-outlined ctx-item-arrow ctx-symbol">chevron_right</span>
                <!-- 子菜单传送至 body：父面板的 transform/filter 会改变 fixed 定位的包含块，嵌套会被裁剪 -->
                <Teleport to="body">
                    <AnimatePresence>
                        <ContextMenuPanel v-if="openSubmenu?.index === index" :items="openSubmenu.items"
                            :anchor-rect="openSubmenu.rect" :level="level + 1" :focus-first="focusFirstSubmenu"
                            :aria-label="item.label" @select="$emit('select', $event)" />
                    </AnimatePresence>
                </Teleport>
            </div>
        </template>
    </MotionDiv>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { AnimatePresence, motion, useReducedMotion } from 'motion-v';
import { APPLE_SPRING, INSTANT_MOTION } from '@/utils/motion';
import type { ContextMenuItem } from '@/utils/contextMenu';

// 通用菜单面板：既作为根面板（anchorPoint 模式），也递归作为二级菜单（anchorRect 模式）。
// 位置永远保证完整落在窗口内：放不下时自动向屏幕内侧翻转/收缩。
const props = withDefaults(defineProps<{
    items: ContextMenuItem[];
    /** 根模式：以光标点为锚 */
    x?: number;
    y?: number;
    /** 子菜单模式：以父项矩形为锚 */
    anchorRect?: { left?: number; right?: number; top?: number } | null;
    level?: number;
    minWidth?: number;
    ariaLabel?: string;
    /** 键盘打开子菜单时，自动高亮第一项 */
    focusFirst?: boolean;
}>(), {
    items: () => [],
    x: 0,
    y: 0,
    anchorRect: null,
    level: 0,
    minWidth: 210,
    ariaLabel: '',
    focusFirst: false
});

const emit = defineEmits<{
    (e: 'select', item: ContextMenuItem): void;
}>();

const EDGE_MARGIN = 8;
const ROOT_Y_OFFSET = 6;
const SUBMENU_OVERLAP = 4;
const PANEL_PADDING = 6;

const MotionDiv = motion.div as unknown as Component;
const reducedMotion = useReducedMotion();
const panelTransition = computed(() => (reducedMotion.value ? INSTANT_MOTION : APPLE_SPRING));

const panelRef = ref<{ $el: HTMLElement } | null>(null);
const isPositioned = ref(false);
const position = ref({ left: 0, top: 0 });
const transformOrigin = ref('left top');
const activeIndex = ref(props.focusFirst ? firstEnabledIndex(props.items) : -1);
const openSubmenu = ref<{ items: ContextMenuItem[]; index: number; rect: AnchorRect } | null>(null);
const focusFirstSubmenu = ref(false);

type AnchorRect = { left?: number; right?: number; top?: number } | null;

interface KeyboardHost {
    register(panel: unknown): void;
    unregister(panel: unknown): void;
    closeAll(): void;
}

const keyboard = inject<KeyboardHost | null>('contextMenuKeyboard', null);

const panelStyle = computed(() => ({
    '--ctx-min-width': `${props.minWidth}px`,
    left: `${position.value.left}px`,
    top: `${position.value.top}px`,
    transformOrigin: transformOrigin.value
}));

const getPanelElement = (): HTMLElement | null => panelRef.value?.$el ?? null;

const isStringIcon = (icon: Component | string): boolean => typeof icon === 'string';

const isEnabled = (item: ContextMenuItem | undefined): boolean =>
    Boolean(item) && !item!.separator && !item!.disabled;

function firstEnabledIndex(items: ContextMenuItem[]): number {
    return items.findIndex((item) => isEnabled(item));
}

const measurePanel = (): { width: number; height: number } | null => {
    const element = getPanelElement();
    if (!element) return null;
    return {
        width: Math.max(element.offsetWidth, props.minWidth),
        height: element.offsetHeight
    };
};

const place = (): void => {
    const size = measurePanel();
    if (!size) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(size.width, viewportWidth - EDGE_MARGIN * 2);
    const height = Math.min(size.height, viewportHeight - EDGE_MARGIN * 2);
    let left = 0;
    let top = 0;
    let originX = 'left';
    let originY = 'top';

    if (props.anchorRect) {
        // 二级菜单：优先贴父项右侧（留 4px 重叠，方便指针斜向移动），右侧放不下翻到左侧
        const rect: AnchorRect = props.anchorRect.left !== undefined
            ? props.anchorRect
            : { left: EDGE_MARGIN, right: EDGE_MARGIN, top: EDGE_MARGIN };
        if ((rect.right ?? EDGE_MARGIN) - SUBMENU_OVERLAP + width <= viewportWidth - EDGE_MARGIN) {
            left = (rect.right ?? EDGE_MARGIN) - SUBMENU_OVERLAP;
            originX = 'left';
        } else {
            left = (rect.left ?? EDGE_MARGIN) - width + SUBMENU_OVERLAP;
            originX = 'right';
        }
        // 垂直方向与父项顶对齐；底部越界则整体上移，仍不够则贴顶
        top = (rect.top ?? EDGE_MARGIN) - PANEL_PADDING;
        if (top + height > viewportHeight - EDGE_MARGIN) {
            top = viewportHeight - EDGE_MARGIN - height;
            originY = 'bottom';
        }
        if (top < EDGE_MARGIN) {
            top = EDGE_MARGIN;
            originY = 'top';
        }
    } else {
        // 根菜单：光标右下角展开；水平越界翻到光标左侧，垂直越界翻到光标上方
        if (props.x + width <= viewportWidth - EDGE_MARGIN) {
            left = props.x;
            originX = 'left';
        } else {
            left = props.x - width;
            originX = 'right';
        }
        if (props.y + ROOT_Y_OFFSET + height <= viewportHeight - EDGE_MARGIN) {
            top = props.y + ROOT_Y_OFFSET;
            originY = 'top';
        } else {
            top = props.y - height;
            originY = 'bottom';
        }
    }

    left = Math.max(EDGE_MARGIN, Math.min(left, viewportWidth - EDGE_MARGIN - width));
    top = Math.max(EDGE_MARGIN, Math.min(top, viewportHeight - EDGE_MARGIN - height));

    position.value = { left, top };
    transformOrigin.value = `${originX} ${originY}`;
    isPositioned.value = true;
};

const closeOwnSubmenu = (): void => {
    if (!openSubmenu.value) return;
    openSubmenu.value = null;
    focusFirstSubmenu.value = false;
};

const openSubmenuFor = (item: ContextMenuItem, index: number, rect: AnchorRect): void => {
    focusFirstSubmenu.value = false;
    if (openSubmenu.value?.index === index) return;
    openSubmenu.value = { items: item.children ?? [], index, rect };
};

const handleItemPointerEnter = (item: ContextMenuItem, index: number, event: PointerEvent): void => {
    if (!isEnabled(item)) return;
    activeIndex.value = index;
    if (item.children) {
        openSubmenuFor(item, index, (event.currentTarget as HTMLElement).getBoundingClientRect());
    } else {
        closeOwnSubmenu();
    }
};

const handleItemClick = (item: ContextMenuItem, index: number, event: MouseEvent): void => {
    if (!isEnabled(item)) return;
    activeIndex.value = index;
    if (item.children) {
        // 已展开则先收起（再悬停/点击会重新展开）
        if (openSubmenu.value?.index === index) {
            closeOwnSubmenu();
            return;
        }
        openSubmenuFor(item, index, (event.currentTarget as HTMLElement).getBoundingClientRect());
        return;
    }
    emit('select', item);
};

const moveActive = (delta: number): void => {
    if (!props.items.length) return;
    let index = activeIndex.value;
    for (let step = 0; step < props.items.length; step += 1) {
        index = (index + delta + props.items.length) % props.items.length;
        if (isEnabled(props.items[index])) {
            activeIndex.value = index;
            return;
        }
    }
};

const itemElementAt = (index: number): HTMLElement | null =>
    getPanelElement()?.querySelector(`[data-ctx-index="${index}"]`) ?? null;

const activateItem = (item: ContextMenuItem, index: number): void => {
    if (!isEnabled(item)) return;
    if (item.children) {
        const element = itemElementAt(index);
        // 键盘路径可能拿不到单项元素，退回整个面板右缘作为锚点
        const rect = element?.getBoundingClientRect()
            ?? getPanelElement()?.getBoundingClientRect()
            ?? null;
        focusFirstSubmenu.value = true;
        openSubmenu.value = { items: item.children, index, rect };
        return;
    }
    emit('select', item);
};

// 键盘导航：由 ContextMenu 宿主路由到最深层打开的面板；返回 true 表示已消费
const handleMenuKey = (event: KeyboardEvent): boolean => {
    const key = event.key;
    if (key === 'ArrowDown') {
        moveActive(1);
        return true;
    }
    if (key === 'ArrowUp') {
        moveActive(-1);
        return true;
    }
    if (key === 'ArrowRight') {
        const item = props.items[activeIndex.value];
        if (item?.children) activateItem(item, activeIndex.value);
        return true;
    }
    if (key === 'ArrowLeft') {
        if (openSubmenu.value) {
            closeOwnSubmenu();
            return true;
        }
        return false;
    }
    if (key === 'Enter' || key === ' ') {
        const item = props.items[activeIndex.value];
        if (item) activateItem(item, activeIndex.value);
        return true;
    }
    if (key === 'Escape') {
        if (openSubmenu.value) {
            closeOwnSubmenu();
            return true;
        }
        if (props.level === 0) {
            keyboard?.closeAll();
            return true;
        }
        return false;
    }
    if (key === 'Home') {
        const index = firstEnabledIndex(props.items);
        if (index >= 0) activeIndex.value = index;
        return true;
    }
    if (key === 'End') {
        for (let index = props.items.length - 1; index >= 0; index -= 1) {
            if (isEnabled(props.items[index])) {
                activeIndex.value = index;
                break;
            }
        }
        return true;
    }
    return false;
};

const keyboardHandler = {
    handleKey: handleMenuKey,
    closeSubmenu: closeOwnSubmenu
};

keyboard?.register(keyboardHandler);

// 键盘打开子菜单：父面板 focusFirst 变化时同步高亮到子面板第一项
watch(() => props.focusFirst, (value) => {
    if (!value) return;
    const index = firstEnabledIndex(props.items);
    if (index >= 0) activeIndex.value = index;
});

watch(() => props.items, () => {
    activeIndex.value = -1;
    closeOwnSubmenu();
    isPositioned.value = false;
    nextTick(() => requestAnimationFrame(place));
});

onMounted(() => {
    nextTick(() => requestAnimationFrame(place));
});

onBeforeUnmount(() => {
    keyboard?.unregister(keyboardHandler);
});
</script>

<style scoped>
.ctx-panel {
    position: fixed;
    z-index: 1260;
    min-width: var(--ctx-min-width, 210px);
    max-height: calc(100vh - 16px);
    padding: 6px;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    color: rgb(var(--text-color));
    background: color-mix(in srgb, rgb(var(--background-color)) 62%, transparent);
    border: 1px solid rgba(var(--text-color), 0.14);
    border-radius: 13px;
    box-shadow: 0 18px 46px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12);
    backdrop-filter: blur(28px) saturate(1.3);
    font-size: 12.5px;
    will-change: transform, opacity, filter;
}

/* 未完成定位前隐藏，避免在错误位置闪现一帧 */
.ctx-panel:not(.is-positioned) {
    visibility: hidden;
    pointer-events: none;
}

.ctx-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    cursor: default;
    white-space: nowrap;
    transition: background-color 120ms ease;
}

.ctx-item.active {
    background: rgba(var(--text-color), 0.1);
}

.ctx-item.disabled {
    opacity: 0.38;
}

.ctx-item.danger {
    color: #e05b5b;
}

.ctx-item.danger.active {
    background: rgba(224, 91, 91, 0.14);
}

.ctx-item-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 16px;
    opacity: 0.78;
}

.ctx-symbol {
    font-size: 15px;
    line-height: 1;
    font-variation-settings:
        'FILL' 0,
        'wght' 300,
        'GRAD' 0,
        'opsz' 20;
}

.ctx-item-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ctx-item-shortcut {
    flex: 0 0 auto;
    margin-left: 18px;
    color: rgba(var(--text-color), 0.38);
    font-size: 11px;
    letter-spacing: 0.5px;
}

.ctx-item-arrow {
    flex: 0 0 auto;
    margin-left: 6px;
    font-size: 14px;
    opacity: 0.45;
}

.ctx-separator {
    height: 1px;
    margin: 5px 9px;
    background: rgba(var(--text-color), 0.14);
}

.ctx-panel::-webkit-scrollbar {
    width: 4px;
}

.ctx-panel::-webkit-scrollbar-thumb {
    background: rgba(var(--text-color), 0.3);
    border-radius: 2px;
}
</style>
