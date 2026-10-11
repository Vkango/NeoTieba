<script setup lang="ts">
import { ref, onMounted, inject, type Ref } from 'vue';
import { useApiStore } from '@/stores';
import UserReply from '@/components/reply/UserReply.vue';
import { sanitize } from '@/utils/sanitizer';

// 类型定义
interface Props {
  uid: number;
  key_: number;
}

interface Emits {
  (e: 'setTabInfo', info: { key: number; title: string; icon: string }): void;
  (e: 'openThread', id: string | number): void;
  (e: 'openBar', barName: string): void;
}

interface UserData {
  user: {
    name_show: string;
    portrait: string;
    [key: string]: any;
  };
}

interface UserCardData {
  data: {
    honor: {
      grade: Record<string, {
        forum_list: string[];
      }>;
    };
  };
}

interface PostItem {
  [key: string]: any;
}

function mapUserPost(item: any): PostItem {
  const content = Array.isArray(item?.content) ? item.content : [];
  return {
    ...item,
    thread_id: String(item?.thread_id ?? ''),
    user_name: item?.user_name ?? '',
    name_show: item?.name_show ?? item?.user_name ?? '',
    user_portrait: item?.user_portrait ?? '',
    title: item?.title ?? '',
    content: content.map((block: any) => ({
      postContent: Array.isArray(block?.post_content) ? block.post_content : [],
      createTime: Number(block?.create_time ?? 0),
    })),
  };
}

interface FollowBarItem {
  forum_name: string;
  level_id: string | number;
}

// Props & Emits
const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// Injects
const openImageViewer = inject<(url: string) => void>('openImageViewer');
const updateTabMeta = inject<(info: { key: number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

// State
const returnData: Ref<UserData> = ref({ user: { name_show: '', portrait: '' } });
const returnData1: Ref<UserCardData> = ref({ data: { honor: { grade: {} } } });
const returnData2: Ref<PostItem[]> = ref([]);
const isLoading = ref<boolean>(true);
const isThreadsLoading = ref<boolean>(true);
const FollowBarList: Ref<FollowBarItem[]> = ref([]);
const currentPage = ref<number>(1);
const hasMore = ref<boolean>(true);

// API实例
const apiStore = useApiStore();
const api = apiStore.getApi();

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
    qrUrl: userUrl(user.portrait || String(props.uid))
  });
};

// 加载下一页
const nextPage = async (): Promise<void> => {
  try {
    currentPage.value++;
    isThreadsLoading.value = true;

    const response = await api.user_post(props.uid, currentPage.value);
    const pageData = response?.data?.post_list;

    if (Array.isArray(pageData) && pageData.length > 0) {
      returnData2.value = [...returnData2.value, ...pageData.map(mapUserPost)];
      hasMore.value = pageData.length !== 0;
    } else {
      hasMore.value = false;
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

// 生命周期
onMounted(async (): Promise<void> => {
  try {
    isLoading.value = true;
    isThreadsLoading.value = true;

    // 加载用户信息
    const userInfo = await api.user_info(Number(props.uid), 1);
    returnData.value = { ...userInfo.data, user: userInfo.data?.user ?? returnData.value.user };
    console.log('用户信息:', returnData.value);

    // 加载用户卡片
    returnData1.value = await api.userCard(returnData.value.user.portrait);

    // 加载用户帖子
    const postResponse = await api.user_post(props.uid);
    const post_list = postResponse.data.post_list;

    if (Array.isArray(post_list)) {
      returnData2.value = post_list.map(mapUserPost);
      hasMore.value = post_list.length !== 0;
    } else {
      hasMore.value = false;
    }

    // 设置标签信息
    const portraitUrl = returnData.value.user.portrait
      ? `https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/${returnData.value.user.portrait}`
      : '/assets/person.svg'; // Use a default icon if portrait is missing

    updateTabMeta?.({
      key: props.key_,
      title: `${returnData.value.user.name_show}的贴吧`,
      icon: portraitUrl,
      icon_invert: !returnData.value.user.portrait
    });

    // 处理关注吧列表
    try {
      const gradeEntries = Object.entries(returnData1.value.data.honor.grade);
      for (const [level, info] of gradeEntries) {
        for (const forumName of info.forum_list) {
          FollowBarList.value.push({
            forum_name: forumName,
            level_id: level
          });
        }
      }
    } catch (error) {
      console.error('处理关注吧列表失败:', error);
    }
  } catch (error) {
    console.error('加载用户数据失败:', error);
  } finally {
    isLoading.value = false;
    isThreadsLoading.value = false;
  }
});

const onScroll = (target: any) => {
  if ((target.scrollTop + target.clientHeight + 20 >= target.scrollHeight)) {
    if (isThreadsLoading.value || hasMore.value !== true) {
      return;
    }
    nextPage();
  }
}
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`user-${props.key_}`" @yscroll="onScroll">
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
              @click="() => openImageViewer && openImageViewer('https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + returnData.user.portrait)" />
            <div>
              <div class="title">{{ returnData.user.name_show }} ({{ returnData.user.name }})
                <RippleButton style="padding: 4px; border-radius: 50%; background: transparent; box-shadow: none; vertical-align: middle;"
                  @click="handleShare" title="生成分享卡片">
                  <span class="material-symbols-outlined" style="font-size: 20px;">share</span>
                </RippleButton>
              </div>
              <div class="description" v-html="sanitize(returnData.user.intro == '' ? '没有签名喵' : returnData.user.intro)">
              </div>
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

        <div class="content">
          <div style="width: 80%; display: flex;">
            <div class="post-list">
              <h3>回复</h3>
              <div class="reply-list">
                <div v-if="returnData2 == undefined">还没有回复</div>
                <UserReply :uid="props.uid" @openThread="onThreadClicked(item.thread_id)" v-for="item in returnData2" msg=""
                  :user_name="item.name_show + ' (' + item.user_name + ')'" :thread_title="item.title"
                  :avatar="item.user_portrait" :media="item.content" :create_time="Number(item.create_time || 0)" :threadId="item.thread_id">
                </UserReply>
                <div v-if="!hasMore">到底了</div>
              </div>
            </div>
            <div class="user-cards">
              <div>
                <h3>关注的吧</h3>
                <div class="bar-buttons">
                  <div class="bar-button" data-kb-item v-for="item in FollowBarList"
                    @click="emit('openBar', item.forum_name)">
                    <span class="bar-name">{{ item.forum_name }} </span>
                    <span class="level"
                      :class="{ 'color1': Number(item.level_id) >= 0 && Number(item.level_id) < 4, 'color2': Number(item.level_id) >= 4 && Number(item.level_id) < 10, 'color3': Number(item.level_id) >= 10 && Number(item.level_id) < 16, 'color4': Number(item.level_id) > 16 }">{{
                        item.level_id }}</span>
                  </div>
                </div>
                <div v-if="FollowBarList.length < 1">没有关注的吧</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
    <transition name="fade1">
      <Loading class="loading-box" v-if="isThreadsLoading"></Loading>
    </transition>
  </Container>
</template>

<style scoped>
hr {
  opacity: 0.1;
}

.level {
  margin: 10px;
}

.bar-button {
  padding: 10px 15px;
  border: 1px solid rgba(var(--text-color), 0.05);
  border-radius: 5px;
}

.user-cards {
  flex: auto;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.post-list {
  min-width: 500px;
  width: calc(100% - 300px);
}

.my-btn {
  width: 200px;
  height: 200px;
}

.tags {
  margin-top: 5px;
}

.thread-filter {
  width: 90%;
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

.content {
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

.bar-buttons {
  width: 100%;
  background-color: transparent;
  box-shadow: none;
  display: flex;
  gap: 10px;
  flex-direction: column;
}
</style>
