<template>
    <Teleport to="body">
        <AnimatePresence>
            <ContextMenuPanel v-if="contextMenuState.open" :key="contextMenuState.session"
                :items="contextMenuState.items" :x="contextMenuState.x" :y="contextMenuState.y"
                :min-width="contextMenuState.minWidth" :level="0" aria-label="上下文菜单"
                @select="selectContextMenuItem" />
        </AnimatePresence>
    </Teleport>
</template>

<script setup lang="ts">
// 通用右键菜单宿主：挂在 App 根部一次，全局任何位置都可通过
// openContextMenu()（见 @/utils/contextMenu.ts）弹出菜单。
import { provide, onMounted, onBeforeUnmount } from 'vue';
import { AnimatePresence } from 'motion-v';
import ContextMenuPanel from './ContextMenuPanel.vue';
import { contextMenuState, selectContextMenuItem, closeContextMenu } from '@/utils/contextMenu';

interface MenuKeyboardPanel {
    handleKey(event: KeyboardEvent): boolean;
    closeSubmenu(): void;
}

interface MenuKeyboardHost {
    register(panel: MenuKeyboardPanel): void;
    unregister(panel: MenuKeyboardPanel): void;
    closeAll(): void;
}

// 键盘导航：维护“打开中的面板”栈，按键始终路由到最深层面板
const keyboardStack: MenuKeyboardPanel[] = [];

provide<MenuKeyboardHost>('contextMenuKeyboard', {
    register(panel) {
        keyboardStack.push(panel);
    },
    unregister(panel) {
        const index = keyboardStack.lastIndexOf(panel);
        if (index >= 0) keyboardStack.splice(index, 1);
    },
    closeAll: closeContextMenu
});

const handleWindowKeydown = (event: KeyboardEvent): void => {
    if (!contextMenuState.open) return;
    for (let index = keyboardStack.length - 1; index >= 0; index -= 1) {
        if (keyboardStack[index]?.handleKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    }
};

// 在菜单外按下任意键（含右键）即关闭；菜单内部通过 .ctx-panel 根节点识别
const handleDocumentPointerdown = (event: PointerEvent): void => {
    if (!contextMenuState.open) return;
    if (event.target instanceof Element && event.target.closest('.ctx-panel')) return;
    closeContextMenu();
};

// 滚动 / 窗口尺寸变化 / 失焦时收起菜单（菜单面板内部的滚动除外）
const handleScroll = (event: Event): void => {
    if (!contextMenuState.open) return;
    if (event.target instanceof Element && event.target.closest('.ctx-panel')) return;
    closeContextMenu();
};

const handleResize = (): void => closeContextMenu();
const handleBlur = (): void => closeContextMenu();

onMounted(() => {
    window.addEventListener('keydown', handleWindowKeydown, true);
    document.addEventListener('pointerdown', handleDocumentPointerdown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    window.addEventListener('blur', handleBlur);
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleWindowKeydown, true);
    document.removeEventListener('pointerdown', handleDocumentPointerdown, true);
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('blur', handleBlur);
});
</script>
