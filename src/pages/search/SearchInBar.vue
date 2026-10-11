<script setup lang="ts">
import { ref, onMounted, inject } from 'vue';
import { useApiStore } from '@/stores';
import Thread from '@/components/thread/Thread.vue';

interface Props {
  key_: string | number;
  barName: string;
  barIcon: string;
}

const isLoading = ref(false);
const searchResult = ref<any[]>([]);
const searchType = ref(0);
const searchContent = ref('');
const currentPage = ref(1);
let has_more = false;
const props = defineProps<Props>();
const emit = defineEmits(['openThread', 'setTabInfo', 'openUser', 'openBar']);
const sendToast = inject<(title: string, duration: number) => void>('sendToast');
const updateTabMeta = inject<(info: { key: unknown; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');
const apiStore = useApiStore();
const api = apiStore.getApi();

onMounted(() => {
  updateTabMeta?.({ key: props.key_, title: `吧内搜索 - ${props.barName}`, icon: props.barIcon, icon_invert: false });
});

const loadData = async () => {
  isLoading.value = true;
  switch (searchType.value) {
    case 0: {
      const barResult = await api.searchPostInBar(props.barName, searchContent.value, currentPage.value);
      searchResult.value = [...searchResult.value, ...barResult.data.post_list];
      has_more = barResult?.data?.has_more;
      break;
    }
    case 1: {
      const threadResult = await api.searchThreadInBar(props.barName, searchContent.value, currentPage.value);
      searchResult.value = [...searchResult.value, ...threadResult.data.post_list];
      has_more = threadResult?.data?.has_more;
      break;
    }
  }

  if (!Array.isArray(searchResult.value) || !searchResult.value.length) {
    sendToast?.('没有搜索到相关结果', 3000);
  }
  isLoading.value = false;
};

async function handleEnter(pageSwitch = false) {
  if (searchContent.value.length < 1) {
    if (!pageSwitch) {
      sendToast?.('请输入搜索内容', 3000);
      return;
    }
    searchResult.value = [];
    has_more = false;
    currentPage.value = 1;
    return;
  }
  loadData();
}

const nextPage = async () => {
  currentPage.value++;
  loadData();
};

const onScroll = (target: HTMLElement) => {
  if (target.scrollTop + target.clientHeight + 20 >= target.scrollHeight && has_more) {
    nextPage();
  } else if (target.scrollTop + target.clientHeight + 20 >= target.scrollHeight && !has_more) {
    sendToast?.('没有更多内容了', 2000);
  }
};
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`search-in-bar-${props.key_}`" @yscroll="onScroll">
    <div class="container1">
      <div class="list-title">在 {{ barName }} 吧内搜索</div>
      <div class="navi-buttons">
        <RippleButton class="button-nostyle" :class="{ 'selected': searchType == 0 }"
          @click="searchResult = []; searchType = 0; currentPage = 1; handleEnter(true)">回复
        </RippleButton>
        <RippleButton class="button-nostyle" :class="{ 'selected': searchType == 1 }"
          @click="searchResult = []; searchType = 1; currentPage = 1; handleEnter(true)">主题帖
        </RippleButton>
      </div>
      <input data-kb-search placeholder="输入关键词后按下回车键进行搜索…" @keyup.enter="handleEnter(false)" v-model="searchContent">
      <TransitionGroup name="fade1">
        <div class="result" v-if="searchType == 0 && Array.isArray(searchResult)">
          <Thread :tid="item.tid" :uid="item.user.uid" @openUser="emit('openUser', item.user.uid)" @openThread="emit('openThread', item.tid)"
            v-for="item in searchResult" :thread_title="item?.title"
            :user_name="item?.user?.user_name || item?.user?.show_nickname || '(未知)'"
            :avatar="item?.user?.portrait.match(/tb\.1\.[^/]+/) ? item?.user?.portrait.match(/tb\.1\.[^/]+/)[0] : '0'"
            :thread_content="[{ type: 0, text: item?.main_post?.content }]" :create_time="item?.time"
            :reply_num="item?.post_num" :media="item?.media">
          </Thread>
        </div>
        <div class="result" v-if="searchType == 1 && searchResult">
          <Thread :tid="item.tid" :uid="item.user.uid" @openUser="emit('openUser', item.user.uid)" @openThread="emit('openThread', item.tid)"
            v-for="item in searchResult" :thread_title="item?.title"
            :user_name="item?.user?.user_name || item?.user?.show_nickname || '(未知)'"
            :avatar="item?.user?.portrait.match(/tb\.1\.[^/]+/) ? item?.user?.portrait.match(/tb\.1\.[^/]+/)[0] : '0'"
            :thread_content="[{ type: 0, text: item?.content }]" :create_time="item?.time"
            :reply_num="item?.post_num" :media="item?.media">
          </Thread>
        </div>
      </TransitionGroup>
    </div>
    <transition name="fade1">
      <Loading class="loading-box" v-if="isLoading"></Loading>
    </transition>
  </Container>
</template>

<style scoped>
.thread {
  width: 100%;
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
  height: 100%;
  border-radius: 5px;
  align-items: center;
}

.avatar {
  width: 50px;
  height: 50px;
  border-radius: 8px;
}

.result {
  margin: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.button-nostyle.selected {
  color: rgba(var(--text-color), 1);
  border-bottom: 2px solid rgba(var(--text-color), 1);
  font-weight: bold;
}

.button-nostyle {
  background-color: transparent;
  box-shadow: none;
  width: fit-content;
  justify-self: center;
  font-size: 13px;
  color: rgba(var(--text-color), 0.5);
  border-radius: 0;
}

.navi-buttons {
  margin-bottom: 10px;
  display: flex;
  gap: 10px;
}

.list-title {
  padding: 10px 5px;
  font-size: 16px;
  font-weight: bold;
  position: relative;
}

.container1 {
  width: 80%;
  margin: 0 auto;
}

input {
  width: 100%;
}
</style>
