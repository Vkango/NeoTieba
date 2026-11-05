<script setup lang="ts">
import { onMounted, ref, inject, provide, type Ref } from 'vue';
import { PAGE_TAB_KEY } from '@/composables/useOpenedThreadHighlight';
import { getCurrentUserBduss } from '@/services/user-manage';
import { useApiStore } from '@/stores';
import ThreadLite from '@/components/thread/ThreadLite.vue';

interface Props {
  key_: string | number;
}

interface Emits {
  (e: 'setTabInfo', info: { key: string | number; title: string; icon: string }): void;
  (e: 'openThread', id: string | number): void;
}

interface ThreadAuthor {
  user_id?: string;
  name_show?: string;
  name: string;
  user_portrait: string;
}

interface ThreadItem {
  thread_id: string | number;
  title: string;
  media?: any[];
  author: ThreadAuthor;
  last_time: number;
  is_deleted: boolean;
  forum_name: string;
  post_no_msg: string;
}

const props = defineProps<Props>();
provide(PAGE_TAB_KEY, props.key_);
const emit = defineEmits<Emits>();
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

const isLoading = ref<boolean>(true);
const isThreadsLoading = ref<boolean>(true);
const threadList: Ref<ThreadItem[]> = ref([]);
const offset = ref<number>(0);

const apiStore = useApiStore();
const api = apiStore.getApi();
let bduss = '';

const loadData = async (): Promise<void> => {
  try {
    isThreadsLoading.value = true;
    const response = await api.Favourite(bduss, offset.value);
    threadList.value = [...threadList.value, ...response.store_thread];
  } catch (error) {
    console.error('加载收藏列表失败:', error);
  } finally {
    isLoading.value = false;
    isThreadsLoading.value = false;
  }
};

onMounted(async (): Promise<void> => {
  const bdussValue = await getCurrentUserBduss();
  bduss = `BDUSS=${bdussValue}`;
  await loadData();
  updateTabMeta?.({ key: props.key_, title: '我的收藏', icon: '/assets/favourite.svg', icon_invert: true });
});

const onScroll = (target: HTMLElement): void => {
  const { scrollTop, clientHeight, scrollHeight } = target;
  if (scrollTop + clientHeight + 20 >= scrollHeight) {
    if (!isThreadsLoading.value) {
      offset.value += 20;
      loadData();
    }
  }
};

const handleClick = (id: string | number): void => {
  emit('openThread', id);
};
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`favourite-${props.key_}`" @yscroll="onScroll">
    <transition name="fade1">
      <div class="bgr" v-if="!isLoading">
        <div class="list-title">我的收藏</div>
        <div style="display: flex; gap: 10px; flex-direction: row; flex-wrap: wrap;">
          <ThreadLite :tid="item.thread_id" :uid="item.author.user_id" @click="handleClick(item.thread_id)" v-for="item in threadList"
            :thread_title="item.title" :media="item.media" :user_name="item.author.name_show || item.author.name"
            :avatar="item.author.user_portrait" :create_time="item.last_time"
            :style="{ opacity: item.is_deleted ? 0.5 : 1 }"
            :msg="item.is_deleted ? '贴子已被删除' : `${item.forum_name}吧 | ${item.post_no_msg === '' ? '无更新' : item.post_no_msg}`">
          </ThreadLite>
        </div>
      </div>
    </transition>
    <transition name="fade1">
      <Loading class="loading-box" v-if="isThreadsLoading"></Loading>
    </transition>
  </Container>
</template>

<style scoped>
.bgr {
  width: 80%;
  padding: 0 10px;
  margin: 0 auto;
}

.thread {
  width: 100%;
}

.desc {
  font-size: 13px;
  opacity: 0.5;
  margin-top: 5px;
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
  width: 300px;
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
