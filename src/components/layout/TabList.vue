<template>
  <div style="padding-bottom: 10px;">

    <div class="drawer-header">
      <div class="drawer-title">打开的标签 ({{ displayedTabs.length }})</div>
      <div class="drawer-actions">
        <RippleButton class="drawer-action" title="刷新当前标签" aria-label="刷新当前标签"
          :disabled="!currentTab" @click="refreshCurrentTab">
          <span class="material-symbols-outlined">refresh</span>
        </RippleButton>
        <RippleButton class="drawer-action" title="复制当前标签链接" aria-label="复制当前标签链接"
          :disabled="!currentTab" @click="copyCurrentTabLink">
          <span class="material-symbols-outlined">content_copy</span>
        </RippleButton>
        <RippleButton class="drawer-action" title="添加当前标签到集锦" aria-label="添加当前标签到集锦"
          :disabled="!currentTab || !currentCollectionPayload" @click="addCurrentTabToCollection">
          <span class="material-symbols-outlined">bookmark_add</span>
        </RippleButton>
      </div>
    </div>
    <div class="tabs-list-">
      <transition-group name="tab-list" tag="div" class="tabs-list-">
        <RippleButton class="tab-ripplebutton" v-for="tab in displayedTabs"
          :class="{ 'selected': tab.selected, 'invert': tab.icon_invert, 'show': !tab.show }" :key="tab.id"
          @click="tabStore.switchTab(tab.key)">
          <div class="tab-content">
            <img class="icon" :class="{ 'invert': tab.icon_invert }" :src="getIconPath(tab.icon)"
              referrerpolicy="no-referrer" />
            <div class="title">{{ tab.title }}</div>
            <span v-if="tab.closable !== false" class="material-symbols-outlined" id="close" style="font-size: 12px;" @click.stop
              @click="tabStore.removeTab(tab.id)">close</span>
          </div>
        </RippleButton>
      </transition-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import RippleButton from '#components/common/RippleButton.vue';
import { useTabStore } from '@/stores/tabs';
import { useCollectionStore, DEFAULT_GROUP_ID } from '@/stores/collection';
import { computed, inject } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { errorService } from '@/core/error-service';
import { getTabLink } from '@/utils/tab-link';
import { tabToCollectionPayload } from '@/utils/collection-capture';

const emit = defineEmits<{ (e: 'refresh', id: number): void }>();

const tabStore = useTabStore();
const collectionStore = useCollectionStore();
const sendToast = inject<(title: string, duration?: number) => void>('sendToast');
const displayedTabs = computed(() => tabStore.tabs.filter(tab => tab.show));
const currentTab = computed(() => tabStore.currentTab);
const currentCollectionPayload = computed(() =>
  currentTab.value ? tabToCollectionPayload(currentTab.value) : null);

function refreshCurrentTab(): void {
  if (currentTab.value) emit('refresh', currentTab.value.id);
}

function addCurrentTabToCollection(): void {
  const tab = currentTab.value;
  if (!tab) return;
  const payload = tabToCollectionPayload(tab);
  if (!payload) {
    sendToast?.('页面尚未加载完成，或该标签类型不支持加入集锦', 2500);
    return;
  }
  const result = collectionStore.addItem(payload, DEFAULT_GROUP_ID);
  sendToast?.(result.created
    ? `已添加到集锦「${result.groupName}」`
    : `已存在于集锦「${result.groupName}」`, 2500);
}

async function copyCurrentTabLink(): Promise<void> {
  const tab = currentTab.value;
  if (!tab) return;
  try {
    await writeText(getTabLink(tab));
  } catch (error) {
    errorService.handleError(error, '复制标签链接');
  }
}

const getIconPath = (icon: string | undefined): string => {
  if (!icon) return '';
  if (icon.startsWith('http') || icon.startsWith('data:')) {
    return icon;
  }
  if (icon.startsWith('/')) {
    return icon;
  }
  try {
    return new URL(`${icon}`, import.meta.url).href;
  } catch {
    console.error('Failed to load icon:', icon);
    return '/assets/vue.svg';
  }
};
</script>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 10px;
}

.drawer-title {
  font-weight: bold;
  font-size: 15px;
}

.drawer-actions {
  display: flex;
  gap: 4px;
}

.drawer-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.drawer-action .material-symbols-outlined {
  font-size: 18px;
}

.drawer-action:disabled {
  opacity: 0.35;
  cursor: default;
}

.tab-list-enter-active,
.tab-list-leave-active {
  transition: all 0.3s ease;
}

.tab-list-enter-from,
.tab-list-leave-to {
  opacity: 0;
  width: 0%;
  transform: translateY(100%);
}

#close {
  position: absolute;
  right: 10px;
}

#close:hover {
  opacity: 0.5;
}

.icon {
  width: 16px;
  height: 16px;
  border-radius: 16px;
}

.icon.invert {
  filter: invert(var(--invert));
}


.tab-ripplebutton:hover {
  background-color: rgba(var(--text-color), 0.1);
}

.tab-ripplebutton {
  text-align: left;
  background-color: transparent;
  border: none;
  box-shadow: none;
  padding: 5px 10px;
  font-size: 13px;
  font-weight: normal;
  height: 35px;
  width: 100%;
  transition: all 0.3s ease;
}

.tab-content {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
}

.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: absolute;
  left: 36px;
  width: calc(100% - 60px);
}

.ripple-button-title {
  font-size: 13px;
  margin-top: 5px;
}

.tab-ripplebutton.selected {
  background-color: rgba(var(--text-color), 0.1);
  box-shadow: none;
  font-weight: bold;
  backdrop-filter: blur(10px);
}

.tab-ripplebutton.show {
  display: none;
}

#RippleButton {
  background-color: transparent;
  box-shadow: none;
  padding: 10px 5px;
}

.material-symbols-outlined {
  font-variation-settings:
    'FILL' 0,
    'wght' 100,
    'GRAD' 0,
    'opsz' 24
}

.tabbutton {
  width: 100%;
  text-align: left;
  padding: 0;
}

.tabs-list {
  display: flex;
  flex-direction: column;
}

.tag {
  display: inline-block;
  padding: 0px 7px;
  border-radius: 5px;
  color: rgba(var(--text-color));
  font-size: 12px;
  margin: 0px 3px;
}
</style>
