import { reactive } from 'vue';

/**
 * 集锦拖拽全局浮层状态：头像栏/集锦面板悬停与拖拽共用的
 * 「分组名+标题」双行胶囊，以及「拖拽到此处以删除」高亮区。
 * 胶囊与删除区相互独立：悬停只出胶囊，拖拽才出删除区。
 */
export interface CollectionDragOverlayState {
    /** 双行胶囊：上行分组名，下行条目标题 */
    capsuleVisible: boolean;
    capsuleText: string;
    capsuleSubText: string;
    capsuleX: number;
    capsuleY: number;
    /** 删除区是否显示（仅拖拽期间） */
    deleteZoneActive: boolean;
    /** 光标是否悬停在删除区上（高亮加强） */
    deleteZoneHovered: boolean;
}

const state = reactive<CollectionDragOverlayState>({
    capsuleVisible: false,
    capsuleText: '',
    capsuleSubText: '',
    capsuleX: 0,
    capsuleY: 0,
    deleteZoneActive: false,
    deleteZoneHovered: false
});

/** 显示双行胶囊：text=分组名（上），subText=条目标题（下，可空） */
export function showCollectionCapsule(x: number, y: number, text: string, subText = ''): void {
    state.capsuleVisible = true;
    state.capsuleX = x;
    state.capsuleY = y;
    state.capsuleText = text;
    state.capsuleSubText = subText;
}

/** 更新胶囊位置，可选刷新文本（跨组移动时更新分组名） */
export function updateCollectionCapsule(x: number, y: number, text?: string, subText?: string): void {
    state.capsuleX = x;
    state.capsuleY = y;
    if (text !== undefined) state.capsuleText = text;
    if (subText !== undefined) state.capsuleSubText = subText;
}

export function hideCollectionCapsule(): void {
    state.capsuleVisible = false;
    state.capsuleSubText = '';
}

/** 拖拽开始：显示删除区。deletable=false 时不显示（如锁定分组） */
export function beginCollectionDrag(deletable = true): void {
    state.deleteZoneActive = deletable;
    state.deleteZoneHovered = false;
}

/** 设置删除区悬停高亮 */
export function setCollectionDragDeleteHovered(hovered: boolean): void {
    if (!state.deleteZoneActive) return;
    state.deleteZoneHovered = hovered;
}

/** 判断 (x, y) 是否落在删除区内（删除区仅拖拽期间显示，必可命中） */
export function isOverCollectionDeleteZone(x: number, y: number): boolean {
    if (!state.deleteZoneActive) return false;
    const el = document.elementFromPoint(x, y);
    return Boolean(el && el.closest('.collection-delete-zone'));
}

/** 拖拽结束：隐藏删除区并复位 */
export function endCollectionDrag(): void {
    state.deleteZoneActive = false;
    state.deleteZoneHovered = false;
}

export function useCollectionDragOverlay(): CollectionDragOverlayState {
    return state;
}
