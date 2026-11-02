import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type CollectionTargetType = 'thread' | 'bar' | 'user';

export interface CollectionItem {
    id: string;
    type: CollectionTargetType;
    target: string;
    title: string;
    /** thread：作者头像；user：用户头像 */
    userIcon?: string;
    /** thread：角标吧头像；bar：吧头像 */
    barIcon?: string;
    groupId: string;
    addedAt: number;
}

export interface CollectionGroup {
    id: string;
    name: string;
    /** 内置默认分组：不可删除/重命名 */
    locked?: boolean;
}

export const DEFAULT_GROUP_ID = 'default';

export interface CollectionItemPayload {
    type: CollectionTargetType;
    target: string;
    title: string;
    userIcon?: string;
    barIcon?: string;
}

export interface AddItemResult {
    created: boolean;
    groupName: string;
}

let groupSeq = 0;

export const useCollectionStore = defineStore('collection', () => {
    const groups = ref<CollectionGroup[]>([{ id: DEFAULT_GROUP_ID, name: '默认', locked: true }]);
    const items = ref<CollectionItem[]>([]);
    const drawerOpen = ref(false);
    /** 分屏面板宽度（px） */
    const drawerWidth = ref(380);
    /** 实际渲染宽度：窄窗口下封顶，内容区至少保留 320px（70px 导航栏之外） */
    const drawerWidthCss = computed(() => `min(${drawerWidth.value}px, calc(100vw - 70px - 320px))`);
    /** 正在拖拽右缘尺寸调节器：内容区避让过渡临时禁用，保证实时跟随 */
    const resizing = ref(false);

    const defaultGroup = computed<CollectionGroup>(() =>
        groups.value.find(group => group.id === DEFAULT_GROUP_ID) || { id: DEFAULT_GROUP_ID, name: '默认', locked: true }
    );

    const orderedGroups = computed<CollectionGroup[]>(() => groups.value);

    const itemsByGroup = computed<Record<string, CollectionItem[]>>(() => {
        const map: Record<string, CollectionItem[]> = {};
        for (const group of groups.value) map[group.id] = [];
        for (const item of items.value) {
            const list = map[item.groupId] || (map[item.groupId] = []);
            list.push(item);
        }
        return map;
    });

    /** 全局拓扑顺序：与集锦面板一致（分组顺序 × 组内顺序），头像栏等直接消费 */
    const orderedItems = computed<CollectionItem[]>(() =>
        orderedGroups.value.flatMap(group => itemsByGroup.value[group.id] || []));

    function groupName(id: string): string {
        return groups.value.find(group => group.id === id)?.name || defaultGroup.value.name;
    }

    function addGroup(name?: string): CollectionGroup {
        const base = (name || '').trim() || '新分组';
        let groupName_ = base;
        let suffix = 2;
        while (groups.value.some(group => group.name === groupName_)) {
            groupName_ = `${base} ${suffix++}`;
        }
        const group: CollectionGroup = { id: `g-${Date.now().toString(36)}-${groupSeq++}`, name: groupName_ };
        groups.value.push(group);
        return group;
    }

    function renameGroup(id: string, name: string): void {
        const group = groups.value.find(g => g.id === id);
        if (!group || group.locked) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        group.name = trimmed;
    }

    /** 删除分组：其中条目回落到默认分组 */
    function removeGroup(id: string): void {
        if (id === DEFAULT_GROUP_ID) return;
        groups.value = groups.value.filter(group => group.id !== id);
        for (const item of items.value) {
            if (item.groupId === id) item.groupId = DEFAULT_GROUP_ID;
        }
    }

    /** 分组排序：面板与头像栏展示顺序即此数组顺序（拓扑顺序，非时间序） */
    function reorderGroup(id: string, targetIndex: number): void {
        const from = groups.value.findIndex(group => group.id === id);
        if (from < 0) return;
        const to = Math.max(0, Math.min(targetIndex, groups.value.length - 1));
        if (from === to) return;
        const [moved] = groups.value.splice(from, 1);
        groups.value.splice(to, 0, moved);
    }

    function itemId(type: CollectionTargetType, target: string): string {
        return `${type}:${target}`;
    }

    function itemExists(type: CollectionTargetType, target: string): boolean {
        return items.value.some(item => item.id === itemId(type, target));
    }

    /**
     * 添加条目：已存在则仅刷新标题/头像，保持在原分组（不擅自移动），
     * 返回 { created: false, groupName: 现有分组名 }
     */
    function addItem(payload: CollectionItemPayload, groupId = DEFAULT_GROUP_ID): AddItemResult {
        const targetGroupId = groups.value.some(group => group.id === groupId) ? groupId : DEFAULT_GROUP_ID;
        const id = itemId(payload.type, payload.target);
        const existing = items.value.find(item => item.id === id);
        let created = false;
        if (existing) {
            existing.title = payload.title;
            existing.userIcon = payload.userIcon;
            existing.barIcon = payload.barIcon;
            return { created, groupName: groupName(existing.groupId) };
        }
        created = true;
        items.value.unshift({
            ...payload,
            id,
            groupId: targetGroupId,
            addedAt: Date.now()
        });
        return { created, groupName: groupName(targetGroupId) };
    }

    function removeItem(id: string): void {
        items.value = items.value.filter(item => item.id !== id);
    }

    function moveItem(id: string, groupId: string): boolean {
        if (!groups.value.some(group => group.id === groupId)) return false;
        const item = items.value.find(entry => entry.id === id);
        if (!item) return false;
        item.groupId = groupId;
        return true;
    }

    /** 在分组内调整条目顺序：targetIndex 为该分组内的目标下标（其余分组条目的相对位置不变） */
    function reorderItem(id: string, targetIndex: number): void {
        const item = items.value.find(entry => entry.id === id);
        if (!item) return;
        const slots: number[] = [];
        items.value.forEach((entry, index) => {
            if (entry.groupId === item.groupId) slots.push(index);
        });
        const from = slots.findIndex(slot => items.value[slot]?.id === id);
        if (from < 0) return;
        const to = Math.max(0, Math.min(targetIndex, slots.length - 1));
        if (from === to) return;
        const groupItems = slots.map(slot => items.value[slot]);
        const [moved] = groupItems.splice(from, 1);
        groupItems.splice(to, 0, moved);
        const next = [...items.value];
        slots.forEach((slot, k) => { next[slot] = groupItems[k]; });
        items.value = next;
    }

    function setDrawerWidth(width: number): void {
        drawerWidth.value = Math.round(Math.max(280, Math.min(560, width)));
    }

    function openDrawer(): void {
        drawerOpen.value = true;
    }

    function closeDrawer(): void {
        drawerOpen.value = false;
        resizing.value = false;
    }

    function toggleDrawer(): void {
        drawerOpen.value = !drawerOpen.value;
        if (!drawerOpen.value) resizing.value = false;
    }

    return {
        groups,
        items,
        drawerOpen,
        drawerWidth,
        drawerWidthCss,
        resizing,
        defaultGroup,
        orderedGroups,
        itemsByGroup,
        orderedItems,
        groupName,
        addGroup,
        renameGroup,
        removeGroup,
        reorderGroup,
        itemExists,
        addItem,
        removeItem,
        moveItem,
        reorderItem,
        setDrawerWidth,
        openDrawer,
        closeDrawer,
        toggleDrawer
    };
}, {
    persist: {
        storage: localStorage,
        pick: ['groups', 'items', 'drawerWidth']
    }
});
