import { reactive, type Component } from 'vue';

// 菜单项：icon 可传组件或 Material Symbols 名称字符串
export interface ContextMenuItem {
    id?: string;
    label?: string;
    icon?: Component | string;
    shortcut?: string;
    /** 分隔线（忽略其他字段） */
    separator?: boolean;
    disabled?: boolean;
    /** 危险操作，红色高亮 */
    destructive?: boolean;
    checked?: boolean;
    children?: ContextMenuItem[];
}

export interface ContextMenuOptions {
    x: number;
    y: number;
    items: ContextMenuItem[];
    minWidth?: number;
}

export interface ContextMenuResult {
    id: string | undefined;
    item: ContextMenuItem;
}

// 通用右键菜单单例：任何组件通过 openContextMenu() 弹出菜单，
// 返回 Promise，在用户选中某项（或菜单被关闭）时决议。
export const contextMenuState = reactive({
    open: false,
    // 每次打开自增，作为 AnimatePresence 的 key，保证重复打开时重新播放入场动画
    session: 0,
    x: 0,
    y: 0,
    items: [] as ContextMenuItem[],
    minWidth: 210
});

let pendingResolve: ((value: ContextMenuResult | null) => void) | null = null;

export function openContextMenu(options: Partial<ContextMenuOptions> = {}): Promise<ContextMenuResult | null> {
    const { x = 0, y = 0, items = [], minWidth = 210 } = options;
    // 若已有菜单打开，先以“未选择”决议旧的 Promise
    if (pendingResolve) pendingResolve(null);
    contextMenuState.session += 1;
    contextMenuState.x = x;
    contextMenuState.y = y;
    contextMenuState.items = items;
    contextMenuState.minWidth = minWidth;
    contextMenuState.open = true;
    return new Promise((resolve) => {
        pendingResolve = resolve;
    });
}

export function selectContextMenuItem(item: ContextMenuItem): void {
    if (!contextMenuState.open || !item) return;
    finish({ id: item.id, item });
}

export function closeContextMenu(): void {
    if (!contextMenuState.open) return;
    finish(null);
}

function finish(value: ContextMenuResult | null): void {
    contextMenuState.open = false;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(value);
}
