<script setup lang="ts">
import { ref, onMounted, inject } from 'vue';
import { useApiStore } from '@/stores';
import Thread from '@/components/thread/Thread.vue';
import RemoteImage from '@/components/common/RemoteImage.vue';
import { sanitize } from '@/utils/sanitizer';

interface Props {
  key_: string | number;
}

const isLoading = ref(false);
const searchResult = ref();
const searchType = ref(0);
const searchContent = ref('');
const props = defineProps<Props>();
const emit = defineEmits(['openThread', 'setTabInfo', 'openUser', 'openBar']);
const sendToast = inject<(title: string, duration: number) => void>('sendToast');
const updateTabMeta = inject<(info: { key: unknown; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

onMounted(() => {
  updateTabMeta?.({ key: props.key_, title: '搜索', icon: '/assets/search.svg', icon_invert: true });
});

async function handleEnter(pageSwitch = false) {
  if (searchContent.value.length < 1) {
    if (!pageSwitch) {
      sendToast?.('请输入搜索内容', 3000);
      return;
    }
    searchResult.value = undefined;
    return;
  }

  isLoading.value = true;
  const apiStore = useApiStore();
  const api = apiStore.getApi();

  switch (searchType.value) {
    case 0:
      searchResult.value = (await api.searchBar(searchContent.value)).data;
      break;
    case 1:
      searchResult.value = (await api.searchThread(searchContent.value, '1', '0', '0', '0', '1', '0', '0', '0')).data.post_list;
      break;
    case 2:
      searchResult.value = (await api.searchUser(searchContent.value)).data;
      break;
  }

  if ((searchType.value === 0 || searchType.value === 2) &&
    (!searchResult.value?.fuzzyMatch?.length && !searchResult.value?.exactMatch?.id && !searchResult.value?.exactMatch?.avatar)) {
    sendToast?.('没有搜索到相关结果', 3000);
  } else if (searchType.value === 1 && (!Array.isArray(searchResult.value) || !searchResult.value.length)) {
    sendToast?.('没有搜索到相关结果', 3000);
  }

  isLoading.value = false;
}

const onScroll = () => {
  // Handle scroll if needed
};
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`search-${props.key_}`" @yscroll="onScroll">
    <div class="container1">
      <div class="list-title">搜索</div>
      <div class="navi-buttons">
        <RippleButton class="button-nostyle" :class="{ 'selected': searchType == 0 }"
          @click="searchResult = undefined; searchType = 0; handleEnter(true)">搜吧
        </RippleButton>
        <RippleButton class="button-nostyle" :class="{ 'selected': searchType == 1 }"
          @click="searchResult = undefined; searchType = 1; handleEnter(true)">搜帖
        </RippleButton>
        <RippleButton class="button-nostyle" :class="{ 'selected': searchType == 2 }"
          @click="searchResult = undefined; searchType = 2; handleEnter(true)">搜人
        </RippleButton>
      </div>
      <input data-kb-search placeholder="输入关键词后按下回车键进行搜索…" @keyup.enter="handleEnter(false)" v-model="searchContent">
      <TransitionGroup name="fade1">
        <div class="result" v-if="searchType == 0 && searchResult">
          <div v-if="searchResult?.exactMatch?.avatar != undefined">
            <Tag>最佳匹配</Tag>
            <div class="card-grid">
              <button class="bar-button" data-kb-item @click="emit('openBar', searchResult.exactMatch.forum_name)">
                <RemoteImage class="avatar" :src="searchResult.exactMatch.avatar" />
                <div style="margin-left: 5px;">
                  <div class="bar-name">{{ searchResult.exactMatch.forum_name }} </div>
                  <div class="desc"><span>帖子数 {{ searchResult.exactMatch.post_num }}</span></div>
                </div>
              </button>
            </div>
          </div>

          <div v-if="searchResult?.fuzzyMatch?.[0]?.avatar != undefined">
            <Tag>相关匹配</Tag>
            <div class="card-grid">
              <button class="bar-button" data-kb-item v-for="item in searchResult?.fuzzyMatch"
                @click="emit('openBar', item.forum_name)">
                <RemoteImage class="avatar" :src="item.avatar" />
                <div style="margin-left: 5px;">
                  <div class="bar-name">{{ item.forum_name }} </div>
                  <div class="desc"><span>帖子数 {{ item.post_num }}</span></div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div class="result" v-if="searchType == 1 && searchResult">
          <Thread :tid="item.tid" :uid="item.user.uid" @openUser="emit('openUser', item.user.uid)" @openThread="emit('openThread', item.tid)"
            v-for="item in searchResult" :thread_title="item.title"
            :user_name="item.user.user_name || item.user.show_nickname || '(未知)'"
            :avatar="item.user.portrait.match(/tb\.1\.[^/]+/) ? item.user.portrait.match(/tb\.1\.[^/]+/)[0] : '0'"
            :thread_content="[{ type: 0, text: item.content }]" :create_time="item.time" :reply_num="item.post_num"
            :media="[]">
          </Thread>
        </div>

        <div class="result" v-if="searchType == 2 && searchResult">
          <div v-if="searchResult?.exactMatch?.id != undefined">
            <Tag>最佳匹配</Tag>
            <div class="card-grid">
              <button class="bar-button" @click="emit('openUser', searchResult.exactMatch.id)">
                <RemoteImage class="avatar" :src="searchResult.exactMatch.portrait" />
                <div style="margin-left: 5px;">
                  <div class="bar-name">{{ searchResult.exactMatch.name }} ({{ searchResult.exactMatch.show_nickname }})</div>
                  <div class="desc"><span v-html="sanitize(searchResult.exactMatch.intro)"></span></div>
                </div>
              </button>
            </div>
          </div>
          <div v-if="searchResult?.fuzzyMatch?.[0]?.id != undefined">
            <Tag>相关匹配</Tag>
            <div class="card-grid">
              <button class="bar-button" v-for="item in searchResult.fuzzyMatch"
                @click="emit('openUser', item.id)">
                <RemoteImage class="avatar" :src="item.portrait" />
                <div style="margin-left: 5px;">
                  <div class="bar-name">{{ item.name }} ({{ item.show_nickname }})</div>
                  <div class="desc"><span>{{ item.intro }}</span></div>
                </div>
              </button>
            </div>
          </div>
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
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 卡片网格：轨道下限不超过容器宽，窄列时单列铺满而非撑破 */
.card-grid {
  margin-top: 10px;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  align-items: start;
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
  flex-wrap: wrap;
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
