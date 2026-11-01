import { reactive } from 'vue';

/**
 * 分屏拖拽全局状态：拖动标签开始即高亮所有可用落区，
 * 提示胶囊直接锚定在各落区旁（由 App.vue 渲染），不跟随鼠标。
 */
export interface SplitDragOverlayState {
    /** 拖拽标签期间为 true：显示所有落区高亮与就近提示胶囊 */
    zonesActive: boolean;
    /** 被拖标签所在分屏（自身不高亮） */
    sourceGroupId: string;
}

const state = reactive<SplitDragOverlayState>({
    zonesActive: false,
    sourceGroupId: ''
});

/** 拖拽开始：立即高亮所有落区并显示各自的就近提示 */
export function beginSplitDrag(sourceGroupId: string): void {
    state.zonesActive = true;
    state.sourceGroupId = sourceGroupId;
}

/** 拖拽结束：隐藏全部提示并复位 */
export function endSplitDrag(): void {
    state.zonesActive = false;
    state.sourceGroupId = '';
}

export function useSplitDragOverlay(): SplitDragOverlayState {
    return state;
}
