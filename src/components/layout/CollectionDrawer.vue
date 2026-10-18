<template>
  <Transition name="collection-drawer">
    <aside v-if="collectionStore.drawerOpen" class="collection-drawer"
      :style="{ width: `${collectionStore.drawerWidth}px` }">
      <div class="drawer-inner" :style="{ width: `${collectionStore.drawerWidth}px` }">
        <div class="drawer-head">
          <div class="drawer-title-row">
            <div class="drawer-title">集锦</div>
            <div class="drawer-actions">
              <button type="button" class="icon-button" title="新建分组" aria-label="新建分组" @click="createGroup">
                <span class="material-symbols-outlined">create_new_folder</span>
              </button>
              <button type="button" class="icon-button" title="关闭" aria-label="关闭"
                @click="collectionStore.closeDrawer()">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>
          <!-- <div class="drawer-hint">
            <span class="material-symbols-outlined">info</span>
            <span>以便随时访问。数据保存在本地。</span>
          </div> -->
        </div>
        <div ref="bodyRef" class="drawer-body">
          <div v-if="collectionStore.items.length === 0 && collectionStore.groups.length === 1" class="empty-state">
            <span class="material-symbols-outlined">collections_bookmark</span>
            <div>暂无集锦</div>
            <div class="empty-sub">右键标签页或拖动标签到左侧头像栏即可添加</div>
          </div>
          <section v-for="group in collectionStore.orderedGroups" :key="group.id" class="group">
            <div class="group-header" :class="{ 'dragging': draggingGroupId === group.id }"
              @mousedown="onGroupHeaderMouseDown($event, group)"
              @contextmenu.prevent="openGroupContextMenu($event, group)">
              <template v-if="renamingId === group.id">
                <input ref="renameInputRef" v-model="renamingName" class="rename-input" maxlength="30"
                  @keydown.enter="commitRename" @keydown.esc="cancelRename" @blur="commitRename">
              </template>
              <template v-else>
                <span class="group-pill" @dblclick="startRename(group)">{{ group.name }}</span>
                <span class="group-count">{{ itemsOf(group.id).length }}</span>
                <span class="group-tools">
                  <button v-if="!group.locked" type="button" class="icon-button small" title="重命名分组"
                    :aria-label="`重命名分组 ${group.name}`" @click="startRename(group)">
                    <span class="material-symbols-outlined">edit</span>
                  </button>
                  <button v-if="!group.locked" type="button" class="icon-button small" title="删除分组"
                    :aria-label="`删除分组 ${group.name}`" @click="deleteGroup(group)">
                    <span class="material-symbols-outlined">delete</span>
                  </button>
                </span>
              </template>
            </div>
            <div class="group-items">
              <button v-for="item in itemsOf(group.id)" :key="item.id" type="button" class="collection-item"
                :class="{ 'dragging': draggingId === item.id }" :data-group-id="group.id" :title="item.title"
                @click="onItemClick(item)" @mousedown="onItemMouseDown($event, item)"
                @contextmenu.prevent="openItemContextMenu($event, item)">
                <CollectionAvatar :type="item.type" :user-icon="item.userIcon" :bar-icon="item.barIcon" :size="34" />
                <span class="item-title">{{ item.title }}</span>
              </button>
              <div v-if="itemsOf(group.id).length === 0" class="group-empty">暂无条目</div>
            </div>
          </section>
        </div>
      </div>
      <div class="resize-handle" :class="{ active: collectionStore.resizing }" title="拖动调整宽度"
        @mousedown.prevent="startResize"></div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import CollectionAvatar from '#components/collection/CollectionAvatar.vue';
import { useCollectionStore, type CollectionGroup, type CollectionItem } from '@/stores/collection';
import { useTabNavigation } from '@/composables/useTabNavigation';
import { openContextMenu, type ContextMenuItem } from '@/utils/contextMenu';

const collectionStore = useCollectionStore();
const { openThread, openBar, openUser } = useTabNavigation();

const itemsOf = (groupId: string): CollectionItem[] =>
  collectionStore.itemsByGroup[groupId] || [];

function openItem(item: CollectionItem): void {
  if (item.type === 'thread') openThread(item.target);
  else if (item.type === 'bar') openBar(item.target);
  else openUser(item.target);
}

// ---- 分组管理 ----
const createGroup = (): void => {
  collectionStore.addGroup();
};

const deleteGroup = (group: CollectionGroup): void => {
  if (group.locked) return;
  collectionStore.removeGroup(group.id);
};

const renamingId = ref<string | null>(null);
const renamingName = ref('');
const renameInputRef = ref<HTMLInputElement[] | null>(null);

const startRename = (group: CollectionGroup): void => {
  if (group.locked) return;
  renamingId.value = group.id;
  renamingName.value = group.name;
  void nextTick(() => {
    const input = renameInputRef.value?.[0];
    input?.focus();
    input?.select();
  });
};

const commitRename = (): void => {
  if (renamingId.value) collectionStore.renameGroup(renamingId.value, renamingName.value);
  renamingId.value = null;
};

const cancelRename = (): void => {
  renamingId.value = null;
};

async function openGroupContextMenu(event: MouseEvent, group: CollectionGroup): Promise<void> {
  if (group.locked) return;
  if (renamingId.value === group.id) return;
  const result = await openContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'rename', label: '重命名分组', icon: 'edit' },
      { id: 'delete', label: '删除分组', icon: 'delete', destructive: true }
    ]
  });
  if (!result) return;
  if (result.id === 'rename') startRename(group);
  else if (result.id === 'delete') deleteGroup(group);
}

// ---- 尺寸调节器 ----
function startResize(event: MouseEvent): void {
  if (event.button !== 0) return;
  collectionStore.resizing = true;
  const startX = event.clientX;
  const startWidth = collectionStore.drawerWidth;
  const onMove = (moveEvent: MouseEvent): void => {
    collectionStore.setDrawerWidth(startWidth + (moveEvent.clientX - startX));
  };
  const onUp = (): void => {
    collectionStore.resizing = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---- 条目拖拽排序（组内拓扑顺序）----
const bodyRef = ref<HTMLElement | null>(null);
const draggingId = ref<string | null>(null);
let dragSession: { id: string; groupId: string; moved: boolean } | null = null;
let dragStartY = 0;
let lastTargetIndex = -1;
let suppressClick = false;

function onItemMouseDown(event: MouseEvent, item: CollectionItem): void {
  if (event.button !== 0) return;
  dragSession = { id: item.id, groupId: item.groupId, moved: false };
  dragStartY = event.clientY;
  lastTargetIndex = -1;
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  event.preventDefault();
}

function onDragMove(event: MouseEvent): void {
  const session = dragSession;
  if (!session) return;
  if (!session.moved && Math.abs(event.clientY - dragStartY) < 4) return;
  session.moved = true;
  draggingId.value = session.id;
  const body = bodyRef.value;
  if (!body) return;
  const rows = Array.from(
    body.querySelectorAll<HTMLElement>(`.collection-item[data-group-id="${session.groupId}"]`));
  let target = rows.length - 1;
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      target = i;
      break;
    }
  }
  if (target !== lastTargetIndex) {
    collectionStore.reorderItem(session.id, target);
    lastTargetIndex = target;
  }
}

function onDragEnd(): void {
  const session = dragSession;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  if (session?.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  dragSession = null;
  draggingId.value = null;
}

function onItemClick(item: CollectionItem): void {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  openItem(item);
}

// ---- 分组拖拽排序（面板展示顺序 = 分组数组拓扑顺序）----
const draggingGroupId = ref<string | null>(null);
let groupDragSession: { id: string; moved: boolean } | null = null;
let groupDragStartY = 0;
let lastGroupTargetIndex = -1;

function onGroupHeaderMouseDown(event: MouseEvent, group: CollectionGroup): void {
  if (event.button !== 0) return;
  // 工具按钮/重命名输入框上的按下不触发拖拽
  if (event.target instanceof Element && event.target.closest('button, input')) return;
  if (renamingId.value) return;
  groupDragSession = { id: group.id, moved: false };
  groupDragStartY = event.clientY;
  lastGroupTargetIndex = -1;
  window.addEventListener('mousemove', onGroupDragMove);
  window.addEventListener('mouseup', onGroupDragEnd);
  event.preventDefault();
}

function onGroupDragMove(event: MouseEvent): void {
  const session = groupDragSession;
  if (!session) return;
  if (!session.moved && Math.abs(event.clientY - groupDragStartY) < 4) return;
  session.moved = true;
  draggingGroupId.value = session.id;
  const body = bodyRef.value;
  if (!body) return;
  const headers = Array.from(body.querySelectorAll<HTMLElement>('.group-header'));
  let target = headers.length - 1;
  for (let i = 0; i < headers.length; i += 1) {
    const rect = headers[i].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      target = i;
      break;
    }
  }
  if (target !== lastGroupTargetIndex) {
    collectionStore.reorderGroup(session.id, target);
    lastGroupTargetIndex = target;
  }
}

function onGroupDragEnd(): void {
  window.removeEventListener('mousemove', onGroupDragMove);
  window.removeEventListener('mouseup', onGroupDragEnd);
  groupDragSession = null;
  draggingGroupId.value = null;
}

// ---- 条目右键 ----
async function openItemContextMenu(event: MouseEvent, item: CollectionItem): Promise<void> {
  const otherGroups = collectionStore.orderedGroups.filter(group => group.id !== item.groupId);
  const moveChildren: ContextMenuItem[] = otherGroups.map(group => ({
    id: `move-group:${group.id}`,
    label: group.name,
    icon: 'folder'
  }));
  const items: ContextMenuItem[] = [
    { id: 'open', label: '打开', icon: 'open_in_new' },
    {
      id: 'move',
      label: '移动到分组',
      icon: 'drive_file_move_outline',
      disabled: otherGroups.length === 0,
      children: moveChildren
    },
    { separator: true },
    { id: 'remove', label: '从集锦移除', icon: 'delete', destructive: true }
  ];
  const result = await openContextMenu({ x: event.clientX, y: event.clientY, items });
  if (!result) return;
  if (result.id === 'open') {
    openItem(item);
  } else if (result.id === 'remove') {
    collectionStore.removeItem(item.id);
  } else if (result.id?.startsWith('move-group:')) {
    collectionStore.moveItem(item.id, result.id.slice('move-group:'.length));
  }
}
</script>

<style scoped>
.collection-drawer {
  position: fixed;
  left: 70px;
  top: 0;
  height: 100%;
  z-index: 1150;
  /* 分屏面板：左缘固定，宽度递增展开；不设背景与遮罩，右侧内容区同步避让 */
  overflow: hidden;
}

.collection-drawer-enter-active,
.collection-drawer-leave-active {
  transition: width 0.3s ease;
}

.collection-drawer-enter-from,
.collection-drawer-leave-to {
  width: 0 !important;
}

.drawer-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}

.resize-handle::after {
  content: '';
  position: absolute;
  right: 2px;
  top: 0;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background-color 0.2s ease;
}

.resize-handle:hover::after,
.resize-handle.active::after {
  background: rgba(var(--text-color), 0.25);
}

.drawer-head {
  flex: 0 0 auto;
  padding: 14px 16px 10px;
}

.drawer-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer-title {
  font-size: 16px;
  font-weight: bold;
  color: rgb(var(--text-color));
}

.drawer-actions {
  display: flex;
  gap: 4px;
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 6px;
  cursor: pointer;
  color: rgb(var(--text-color));
  opacity: 0.65;
  transition: opacity 0.2s ease, background-color 0.2s ease;
}

.icon-button:hover {
  opacity: 1;
  background-color: rgba(var(--text-color), 0.08);
}

.icon-button .material-symbols-outlined {
  font-size: 18px;
}

.icon-button.small {
  width: 24px;
  height: 24px;
  opacity: 0.55;
}

.icon-button.small:hover {
  opacity: 1;
}

.icon-button.small .material-symbols-outlined {
  font-size: 15px;
}

.drawer-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(var(--text-color), 0.5);
}

.drawer-hint .material-symbols-outlined {
  font-size: 15px;
}

.drawer-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 16px 20px;
}

.empty-state {
  height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(var(--text-color), 0.45);
}

.empty-state .material-symbols-outlined {
  font-size: 42px;
}

.empty-sub {
  font-size: 12px;
}

.group {
  margin-top: 14px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  cursor: grab;
  user-select: none;
  transition: opacity 0.2s ease;
}

.group-header:active {
  cursor: grabbing;
}

.group-header.dragging {
  opacity: 0.5;
}

.group-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  background-color: rgba(var(--text-color), 0.1);
  font-size: 12px;
  font-weight: bold;
  color: rgb(var(--text-color));
  white-space: nowrap;
}

.group-count {
  font-size: 12px;
  color: rgba(var(--text-color), 0.4);
}

.group-tools {
  display: none;
  align-items: center;
  gap: 2px;
}

.group-header:hover .group-tools {
  display: inline-flex;
}

.rename-input {
  height: 26px;
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid rgba(var(--text-color), 0.3);
  color: rgb(var(--text-color));
  width: 180px;
}

.group-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}

.group-empty {
  padding: 6px 10px;
  font-size: 12px;
  color: rgba(var(--text-color), 0.35);
}

.collection-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 8px;
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  cursor: grab;
  text-align: left;
  user-select: none;
  color: rgb(var(--text-color));
  transition: background-color 0.2s ease;
}

.collection-item:hover {
  background-color: rgba(var(--text-color), 0.08);
}

.collection-item.dragging {
  opacity: 0.5;
  cursor: grabbing;
}

.item-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: rgb(var(--text-color));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
