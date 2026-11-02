<script setup lang="ts">
import { getCurrentUser } from '@/services/user-manage';
import { useApiStore } from '@/stores';
import { ref, onMounted, inject } from 'vue';
import Container from '@/components/common/Container.vue';
import RemoteImage from '@/components/common/RemoteImage.vue';
import PageState from '@/components/common/PageState.vue';
import type { FollowedForum } from '@/api/followed-forums';

interface Props {
  key_: string | number;
}

interface Emits {
  (e: 'openBar', barName: string): void;
  (e: 'setTabInfo', info: { key: string | number; title: string; icon: string }): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

const naviListItem = ref<FollowedForum[]>([]);
const isLoading = ref(true);
const loadError = ref('');
const api = useApiStore().getApi();

async function loadFollowedForums(): Promise<void> {
  isLoading.value = true;
  loadError.value = '';
  try {
    const user = await getCurrentUser();
    const result = (await api.followbar_list(user.bduss, user.stoken)).forum_info.sort(
      (a, b) => b.user_level - a.user_level
    );
    naviListItem.value = window.pluginManager
      ? await window.pluginManager.dispatchEvent('followBarUpdated', result)
      : result;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  updateTabMeta?.({ key: props.key_, title: '进吧', icon: '/assets/apps.svg', icon_invert: true });
  void loadFollowedForums();
});
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`follow-bar-${props.key_}`">
    <div class="bgr">
      <div class="list-title">关注的吧</div>
      <PageState v-if="loadError && !isLoading" :error="loadError" :retry="loadFollowedForums" />
      <transition name="fade1">
        <div class="list-view" v-if="!isLoading && !loadError">
          <button class="bar-button" data-kb-item v-for="item in naviListItem" :key="item.forum_id || item.forum_name"
            @click="emit('openBar', item.forum_name)">
            <RemoteImage class="avatar" :src="item.avatar" />
            <div style="margin-left: 5px;">
              <div class="bar-name">{{ item.forum_name }} </div>
              <div class="desc"><span class="level"
                  :class="{ 'color1': item.user_level >= 0 && item.user_level < 4, 'color2': item.user_level >= 4 && item.user_level < 10, 'color3': item.user_level >= 10 && item.user_level < 16, 'color4': item.user_level > 16 }">{{
                    item.user_level }}</span><span>{{ item.user_level_name }} | {{ item.is_sign_in ? `已签` : `未签` }}</span>
              </div>
            </div>
          </button>
          <div v-if="naviListItem.length === 0">没有关注的吧</div>
        </div>
      </transition>
    </div>
    <transition name="fade1">
      <Loading class="loading-box" v-if="isLoading"></Loading>
    </transition>
  </Container>
</template>

<style scoped>
.list-view {
  display: grid;
  gap: 10px 10px;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  align-items: start;
}

.level {
  margin: 0;
}

.bgr {
  width: 80%;
  margin: 0 auto;
  margin-bottom: 10px;
}

.desc {
  font-size: 13px;
  opacity: 0.5;
  display: flex;
  align-items: center;
  gap: 5px;
}

.bar-name {
  font-size: 16px;
  font-weight: bold;
  width: 200px;
  height: 30px;
  line-height: 30px;
  overflow: hidden;
}

.bar-button {
  display: flex;
  gap: 10px;
  background-color: rgba(var(--text-color), 0.05);
  box-shadow: none;
  text-align: left;
  flex-direction: row;
  flex-wrap: wrap;
  padding: 10px 15px;
  border-radius: 5px;
  align-items: center;
}

.avatar {
  width: 50px;
  height: 50px;
  border-radius: 8px;
}

.list-title {
  padding: 10px 5px;
  font-size: 16px;
  font-weight: bold;
  position: relative;
}
</style>
