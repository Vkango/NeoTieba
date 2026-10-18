<script setup lang="ts">
import { ref, onMounted, inject, type Ref } from 'vue';
import { getCurrentUserBduss, getCurrentUserCookies } from '@/services/user-manage';
import { useApiStore } from '@/stores';
import { useCollectionStore } from '@/stores/collection';
import UserReply from '@/components/reply/UserReply.vue';
import { replaceEmoticonsWithImages } from '@/utils/emoticon2code';
import type { ReplyItem, AtItem, TiebaUser } from '@/types/user';

// Props 定义
interface Props {
  key_: string | number;
}

const props = defineProps<Props>();

// Emits 定义
interface Emits {
  (e: 'openFavourite'): void;
  (e: 'openHistory'): void;
  (e: 'openLibrary'): void;
  (e: 'openUser', uid: string): void;
  (e: 'openThread', id: string | number): void;
  (e: 'setTabInfo', info: { key: string | number; title: string; icon: string }): void;
}

const emit = defineEmits<Emits>();

// State 定义
const returnData: Ref<{ user: TiebaUser }> = ref({
  user: {} as TiebaUser
});
const isLoading = ref<boolean>(true);
const returnData2 = ref<ReplyItem[]>([]);
const returnData3 = ref<AtItem[]>([]);
const currentPage = ref<number>(1);
const isThreadsLoading = ref<boolean>(true);
const atReplyPage = ref<boolean>(true);
const uid = ref<string>('');
const hasMore = ref<boolean>(true);

// API 实例
const apiStore = useApiStore();
const api = apiStore.getApi();
const collectionStore = useCollectionStore();

import { useShareCard, shareAvatarUrl, userUrl, stripHtml } from '@/services/share-card/useShareCard';
const shareCard = useShareCard();
const handleShare = () => {
  const user = returnData.value.user;
  if (!user?.portrait && !user?.name_show) return;
  shareCard({
    title: user.name_show || user.name || '贴吧用户',
    subtitle: user.name ? user.name : undefined,
    avatar: shareAvatarUrl(user.portrait),
    content: stripHtml(user.intro),
    stats: [
      { label: '吧龄', value: `${user.tb_age || 0}年` },
      { label: '发帖', value: user.post_num || 0 },
      { label: '获赞', value: user.total_agree_num || 0 },
      { label: 'IP', value: user.ip_address || '未知' }
    ],
    qrUrl: userUrl(user.portrait || uid.value)
  });
};

// Inject 定义
const openImageViewer = inject<(url: string) => void>('openImageViewer');
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

// 初始化加载
onMounted(async (): Promise<void> => {
  try {
    isLoading.value = true;
    const cookie = await getCurrentUserCookies();
    const userId = await api.get_self_id(cookie);
    uid.value = userId;

    returnData.value = (await api.user_info(Number(userId), 1)).data;

    const bduss = await getCurrentUserBduss();
    returnData2.value = (await api.get_reply_me(bduss, 1)).reply_list || [];
    hasMore.value = returnData2.value.length !== 0;

    updateTabMeta?.({ key: props.key_, title: '我的', icon: '/assets/user.svg', icon_invert: true });
  } catch (error) {
    console.error('加载用户信息失败:', error);
  } finally {
    isLoading.value = false;
    isThreadsLoading.value = false;
  }
});

// 切换页面
const switchPage = async (): Promise<void> => {
  try {
    currentPage.value = 1;
    isThreadsLoading.value = true;
    const bduss = await getCurrentUserBduss();

    if (atReplyPage.value) {
      const response = await api.get_reply_me(bduss, 1);
      returnData2.value = response.reply_list || [];
      hasMore.value = returnData2.value.length !== 0;
    } else {
      const response = await api.get_at_me(bduss, 1);
      returnData3.value = response.at_list || [];
      hasMore.value = returnData3.value.length !== 0;
    }
  } catch (error) {
    console.error('切换页面失败:', error);
  } finally {
    isLoading.value = false;
    isThreadsLoading.value = false;
  }
};

// 滚动处理
const onScroll = (target: HTMLElement): void => {
  const { scrollTop, clientHeight, scrollHeight } = target;
  if (scrollTop + clientHeight + 20 >= scrollHeight) {
    if (!isThreadsLoading.value && hasMore.value) {
      nextPage();
    }
  }
};

// 加载下一页
const nextPage = async (): Promise<void> => {
  try {
    currentPage.value++;
    const bduss = await getCurrentUserBduss();
    isThreadsLoading.value = true;

    if (atReplyPage.value) {
      const response = await api.get_reply_me(bduss, currentPage.value);
      const pageData = response.reply_list;

      if (Array.isArray(pageData) && pageData.length > 0) {
        returnData2.value = [...returnData2.value, ...pageData];
        hasMore.value = pageData.length !== 0;
      } else {
        hasMore.value = false;
      }
    } else {
      const response = await api.get_at_me(bduss, currentPage.value);
      const pageData = response.at_list;

      if (Array.isArray(pageData) && pageData.length > 0) {
        returnData3.value = [...returnData3.value, ...pageData];
        hasMore.value = pageData.length !== 0;
      } else {
        hasMore.value = false;
      }
    }
  } catch (error) {
    console.error('加载下一页失败:', error);
    hasMore.value = false;
  } finally {
    isThreadsLoading.value = false;
  }
};

// 线程点击处理
const onThreadClicked = (id: string | number): void => {
  emit('openThread', id);
};

// 历史记录
const history = (): void => {
  emit('openHistory');
};
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`my-${props.key_}`" @yscroll="onScroll">
    <transition name="fade1">
      <div v-if="!isLoading">
        <div class="bar-banner">
          <div class="image-container">
            <img class="background-image"
              :src="'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + returnData.user.portrait"
              referrerpolicy="no-referrer">
          </div>
          <div class="banner-content">
            <RemoteImage kind="avatars" class="avatar"
              :src="'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + returnData.user.portrait"
              referrerpolicy="no-referrer"
              @click="openImageViewer && openImageViewer('https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + returnData.user.portrait)" />
            <div>
              <div class="title">{{ returnData.user.name_show }} ({{ returnData.user.name }})
                <RippleButton style="padding: 4px; border-radius: 50%; background: transparent; box-shadow: none; vertical-align: middle;"
                  @click="handleShare" title="生成分享卡片">
                  <span class="material-symbols-outlined" style="font-size: 20px;">share</span>
                </RippleButton>
              </div>
              <div class="description">{{ returnData.user.intro }}</div>
              <div class="tags">
                <Tag>吧龄：{{ returnData.user.tb_age }}年</Tag>
                <Tag>发帖：{{ returnData.user.post_num }}</Tag>
                <Tag>获赞：{{ returnData.user.total_agree_num }}</Tag>
                <Tag>{{ returnData.user.sex == 1 ? '♂' : '♀' }}</Tag>
                <Tag>IP属地：{{ returnData.user.ip_address == '' ? '未知' : returnData.user.ip_address }}</Tag>
              </div>
            </div>
          </div>
        </div>
        <div class="pinned-thread-list">
          <RippleButton class="my-btn">
            <div class="button-content" @click="emit('openFavourite')"><span
                class="material-symbols-outlined">favorite</span>收藏</div>
          </RippleButton>
          <RippleButton class="my-btn">
            <div class="button-content" @click="history()"><span class="material-symbols-outlined">history</span>历史
            </div>
          </RippleButton>
          <RippleButton class="my-btn">
            <div class="button-content" @click="emit('openLibrary')"><span
                class="material-symbols-outlined">inventory_2</span>归档
            </div>
          </RippleButton>
          <RippleButton class="my-btn">
            <div class="button-content" @click="collectionStore.toggleDrawer()"><span
                class="material-symbols-outlined">collections_bookmark</span>集锦
            </div>
          </RippleButton>
          <RippleButton class="my-btn">
            <div class="button-content" @click="emit('openUser', uid)"><span
                class="material-symbols-outlined">gesture</span>主页</div>
          </RippleButton>
          <RippleButton class="my-btn">
            <div class="button-content"><span class="material-symbols-outlined">medical_services</span>服务</div>
          </RippleButton>
          <RippleButton class="my-btn" style="border: 1px rgba(var(--text-color), 0.2) solid;">
            <div class="button-content"><span class="material-symbols-outlined">footprint</span>无痕</div>
          </RippleButton>
          <RippleButton class="my-btn" style="border: 1px rgba(var(--text-color), 0.2) solid;">
            <div class="button-content"><span class="material-symbols-outlined">dark_mode</span>勿扰</div>
          </RippleButton>

        </div>
        <div style="width: 80%; margin: 0 auto;">

          <div style="display: flex; gap: 20px; margin-bottom: 10px; margin-top: 40px; align-items: center;">
            <div style="font-size: 18px; font-weight: bold;">消息</div>
            <div style="margin-left: auto;">
              <RippleButton class="filter-button" :class="{ selected: atReplyPage }"
                @click="atReplyPage = true; switchPage()"
                style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: left;">
                <div style="display: flex; gap: 10px; align-items: center;">
                  <img src="/assets/reply.svg" width="18px" class="icon_">
                  <span>回复我的</span>
                </div>
              </RippleButton>
              <RippleButton class="filter-button" :class="{ selected: !atReplyPage }"
                @click="atReplyPage = false; switchPage()"
                style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: left;">
                <div style="display: flex; gap: 10px; align-items: center;">
                  <img src="/assets/at.svg" width="18px" class="icon_">
                  <span>提到我的</span>
                </div>
              </RippleButton>
            </div>
          </div>
          <TransitionGroup name="fade1">
            <div class="reply-list" v-if="atReplyPage">
              <UserReply :uid="item.replyer.id" @openThread="onThreadClicked(item.thread_id)"
                v-for="item in returnData2" msg="" :user_name="item.replyer.name || item.replyer.name_show"
                :thread_title="replaceEmoticonsWithImages(item.content)" :avatar="item.replyer.portrait"
                :media="[{ postContent: [{ type: 0, text: replaceEmoticonsWithImages(item.quote_content) }], createTime: String(item.time) }]"
                :create_time="0" :threadId="item.thread_id">
              </UserReply>
            </div>
            <div class="at-list" v-if="!atReplyPage">
              <UserReply :uid="item.replyer.id" @openThread="onThreadClicked(item.thread_id)"
                v-for="item in returnData3" msg="" :user_name="item.replyer.name || item.replyer.name_show"
                :thread_title="item.content" :avatar="item.replyer.portrait"
                :media="[{ postContent: [{ type: 0, text: item.title }], createTime: item.time }]" :create_time="0"
                :threadId="item.thread_id">
              </UserReply>
            </div>
            <div v-if="!hasMore" style="margin: 10px 0">到底了</div>
          </TransitionGroup>
        </div>
      </div>
    </transition>
    <transition name="fade1">
      <Loading class="loading-box" v-if="isLoading || isThreadsLoading"></Loading>
    </transition>
  </Container>
</template>

<style scoped>
.button-content {
  display: flex;
  gap: 10px;
}

.my-btn {
  width: fit-content;
  height: fit-content;
  background-color: rgba(var(--background-color), 0.3);
}

.tags {
  margin-top: 5px;
}

.thread-filter {
  width: 80%;
  margin: 0 auto;
}

.thread-list {
  padding: 10px;
  border-radius: 5px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
}

.pinned-thread-list {
  padding: 10px;
  border-radius: 5px;
  position: relative;
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.banner-content .title {
  font-size: 20px;
  font-weight: bold;
}

.banner-content .description {
  margin-top: 5px;
  opacity: 0.5;
}

.banner-content {
  position: absolute;
  top: 60px;
  padding: 15px 45px;
  display: flex;
  gap: 30px;
}

.bar-banner .background-image {
  width: 100%;
  height: 300px;
  object-fit: cover;
}

.image-container img {
  -webkit-mask-image: linear-gradient(rgba(0, 0, 0, 0.1), transparent);
  mask-image: linear-gradient(rgba(0, 0, 0, 0.1), transparent);
  filter: blur(20px);
}

.bar-banner .avatar {
  width: 80px;
  height: 80px;
  border-radius: 80px;
}

.bar-banner {
  width: 100%;
  height: 200px;
  position: relative;
}
</style>
