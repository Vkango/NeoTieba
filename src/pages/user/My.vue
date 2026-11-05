<script setup lang="ts">
import { ref, computed, watch, onMounted, inject, provide, type Ref } from 'vue';
import { PAGE_TAB_KEY } from '@/composables/useOpenedThreadHighlight';
import { getCurrentUserBduss, getCurrentUserCookies } from '@/services/user-manage';
import { useApiStore } from '@/stores';
import { useCollectionStore } from '@/stores/collection';
import UserReply from '@/components/reply/UserReply.vue';
import Container from '@/components/common/Container.vue';
import { useNarrowLayout } from '@/composables/useNarrowLayout';
import { replaceEmoticonsWithImages } from '@/utils/emoticon2code';
import type { ReplyItem, AtItem, TiebaUser } from '@/types/user';

// Props 定义
interface Props {
  key_: string | number;
}

const props = defineProps<Props>();
provide(PAGE_TAB_KEY, props.key_);

// Emits 定义
interface Emits {
  (e: 'openFavourite'): void;
  (e: 'openHistory'): void;
  (e: 'openLibrary'): void;
  (e: 'openUser', uid: string): void;
  (e: 'openBar', name: string): void;
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

// 窄内容区：快捷入口改为纵向入口列表；收藏/历史/归档仍与宽内容区一致开新标签，
// 只有本页自带的“消息”区以页内二级页打开
const containerRef = ref<InstanceType<typeof Container> | null>(null);
const { isNarrow } = useNarrowLayout(() => containerRef.value?.getScrollElement() ?? null);
const messagesOpen = ref(false);
const subOpen = computed(() => isNarrow.value && messagesOpen.value);
watch(isNarrow, narrow => { if (!narrow) messagesOpen.value = false; });

interface MyEntry { id: string; icon: string; label: string; sub?: boolean; action: () => void }
const entries = computed<MyEntry[]>(() => [
  { id: 'favourite', icon: 'favorite', label: '收藏', action: () => emit('openFavourite') },
  { id: 'history', icon: 'history', label: '历史', action: () => emit('openHistory') },
  { id: 'library', icon: 'inventory_2', label: '归档', action: () => emit('openLibrary') },
  { id: 'messages', icon: 'forum', label: '消息', sub: true, action: () => { messagesOpen.value = true; } },
  { id: 'collection', icon: 'collections_bookmark', label: '集锦', action: () => collectionStore.toggleDrawer() },
  { id: 'home', icon: 'gesture', label: '主页', action: () => emit('openUser', uid.value) },
  { id: 'service', icon: 'medical_services', label: '服务', action: () => undefined },
  { id: 'incognito', icon: 'footprint', label: '无痕', action: () => undefined },
  { id: 'dnd', icon: 'dark_mode', label: '勿扰', action: () => undefined },
]);

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
  <Container ref="containerRef" :tab-key="props.key_" :scroll-key="`my-${props.key_}`" @yscroll="onScroll">
    <transition name="fade1">
      <div v-if="!isLoading" class="my-root">
        <!-- 窄内容区“消息”二级页顶栏 -->
        <div v-if="subOpen" class="sub-head">
          <RippleButton class="sub-back" title="返回" @click="messagesOpen = false">
            <span class="material-symbols-outlined">arrow_back</span>
          </RippleButton>
          <span class="sub-title">消息</span>
        </div>

        <template v-if="!subOpen">
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
                <HorizontalMaskScroll class="tags">
                  <Tag>吧龄：{{ returnData.user.tb_age }}年</Tag>
                  <Tag>发帖：{{ returnData.user.post_num }}</Tag>
                  <Tag>获赞：{{ returnData.user.total_agree_num }}</Tag>
                  <Tag>{{ returnData.user.sex == 1 ? '♂' : '♀' }}</Tag>
                  <Tag>IP属地：{{ returnData.user.ip_address == '' ? '未知' : returnData.user.ip_address }}</Tag>
                </HorizontalMaskScroll>
              </div>
            </div>
          </div>

          <!-- 窄内容区：纵向入口列表 -->
          <div v-if="isNarrow" class="entry-list">
            <RippleButton v-for="entry in entries" :key="entry.id" class="entry" @click="entry.action">
              <div class="entry-inner">
                <span class="material-symbols-outlined">{{ entry.icon }}</span>
                <span class="entry-label">{{ entry.label }}</span>
                <span v-if="entry.sub" class="material-symbols-outlined entry-chevron">chevron_right</span>
              </div>
            </RippleButton>
          </div>

          <!-- 宽内容区：快捷入口按钮行 -->
          <div v-else class="pinned-thread-list">
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
        </template>

        <!-- 消息区：宽内容区常驻；窄内容区仅作为“消息”二级页展示 -->
        <div v-if="!isNarrow || messagesOpen" class="message-section">

          <div class="message-head">
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
/* 窄内容区“消息”二级页顶栏 */
.sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 4px;
}

.sub-back {
  display: inline-flex;
  padding: 6px;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
}

.sub-title {
  font-size: 16px;
  font-weight: bold;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
}

.entry {
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  background-color: rgba(var(--text-color), 0.04);
  box-shadow: none;
}

.entry-inner {
  display: flex;
  align-items: center;
  gap: 12px;
}

.entry-label {
  flex: 1;
  min-width: 0;
}

.entry-chevron {
  opacity: 0.4;
}

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

.message-section {
  width: 80%;
  margin: 0 auto;
}

.message-head {
  display: flex;
  gap: 20px;
  margin-bottom: 10px;
  margin-top: 40px;
  align-items: center;
  flex-wrap: wrap;
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

/* 横幅：背景图绝对定位铺底，内容走常规流，横幅随内容撑高（至少 200px），
   窄内容区标题/标签换行变高时不会盖住下方入口列表 */
.banner-content {
  position: relative;
  box-sizing: border-box;
  padding: 75px 45px 15px;
  display: flex;
  gap: 30px;
}

.banner-content > div {
  min-width: 0;
}

.image-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 300px;
  pointer-events: none;
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
  min-height: 200px;
  position: relative;
}
</style>
