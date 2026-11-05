<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, inject, provide, type Ref } from 'vue';
import { PAGE_TAB_KEY } from '@/composables/useOpenedThreadHighlight';
import { useApiStore } from '@/stores';
import PinnedThread from '@/components/thread/PinnedThread.vue';
import Thread from '@/components/thread/Thread.vue';
import RemoteImage from '@/components/common/RemoteImage.vue';
import type { BawuGroup } from '@/types/common';
import { getCurrentUser, type User as ManagedUser } from '@/services/user-manage';
import { useShareCard, barUrl } from '@/services/share-card/useShareCard';
import { useSettingsStore } from '@/stores/settings';
import { currentAccentHex, setForumAccentPair } from '@/styles/theme';
import { extractAccentPair } from '@/utils/color-extract';
import { formatNumber } from '@/utils/helper';

interface Props {
  barName: string;
  key_: string | number;
}

interface Emits {
  (e: 'setTabInfo', info: { key: string | number; title: string; icon: string }): void;
  (e: 'openSearchInBar', data: { barName: string; barIcon: string }): void;
  (e: 'openUser', uid: string | number): void;
  (e: 'openThread', id: string | number): void;
}

interface MediaItem {
  type: number;
  big_pic?: string;
  vpic?: string;
  [key: string]: unknown;
}

interface ThreadItem {
  id: string | number;
  is_top: number;
  author_id: string | number;
  author?: User;
  title: string;
  media?: MediaItem[];
  rich_abstract?: unknown[];
  last_time_int: number;
  reply_num: number;
  view_num: number;
  [key: string]: unknown;
}

interface User {
  id: string | number;
  name: string;
  name_show?: string;
  portrait: string;
  ip_address: string;
  [key: string]: unknown;
}

interface ForumData {
  forum: {
    name: string;
    id?: string | number;
    avatar: string;
    slogan?: string;
    member_num?: number;
    post_num?: number;
    thread_num?: number;
    first_class?: string;
    second_class?: string;
    managers?: Array<{
      id?: string | number;
      name?: string;
      show_name?: string;
      portrait?: string;
      level?: number;
      level_id?: number;
      [key: string]: unknown;
    }>;
    cur_score?: number;
    level_id?: number;
    level_name?: string;
    levelup_score?: number;
    user_level?: number;
  };
  thread_list: ThreadItem[];
  user_list: User[];
  page?: {
    has_more: number;
  };
}

// Props & Emits
const props = defineProps<Props>();
provide(PAGE_TAB_KEY, props.key_);
const emit = defineEmits<Emits>();

// Injects
const openImageViewer = inject<(url: string) => void>('openImageViewer');
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');
const sendToast = inject<(title: string, duration: number) => void>('sendToast');

// State
const BAR_SORT_REPLY = 6;
const BAR_SORT_CREATE = 1;
const barInfoExpanded: Ref<boolean> = ref<boolean>(false);
const barInfoTab: Ref<'info' | 'rules' | 'bawu'> = ref('info');
const panelDataLoaded: Ref<boolean> = ref<boolean>(false);
const barRule = ref<{
  title: string;
  preface: string;
  rules: Array<{ title: string; content: Array<{ type: string; text: string; link?: string }> }>;
}>({ title: '', preface: '', rules: [] });
const bawuLoading: Ref<boolean> = ref<boolean>(false);
const bawuGroups: Ref<BawuGroup[]> = ref<BawuGroup[]>([]);
const barDescription = ref<string>('');
const totalSignNum = ref<number>(0);
const followDays = ref<number>(0);
const myThreadNum = ref<number>(0);
const dayPostNum = ref<number>(0);
const shareCard = useShareCard();

const handleShare = async () => {
  const forum = returnData.value.forum;
  if (!forum?.name) return;
  const category = [forum.first_class, (forum as { second_class?: string }).second_class]
    .filter(Boolean).join(' · ');
  await shareCard({
    title: `${forum.name}吧`,
    subtitle: category || undefined,
    avatar: forum.avatar,
    content: barDescription.value || forum.slogan || '',
    stats: [
      { label: '关注', value: formatNumber(Number(forum.member_num || 0)) },
      { label: '帖子', value: formatNumber(Number(forum.post_num || 0)) },
      { label: '主题帖', value: formatNumber(Number(forum.thread_num || 0)) }
    ],
    qrUrl: barUrl(forum.name)
  });
};

const returnData: Ref<ForumData> = ref<ForumData>({
  forum: { name: '', avatar: '' },
  thread_list: [],
  user_list: []
});
const settingsStore = useSettingsStore();
const isLoading: Ref<boolean> = ref<boolean>(true);
const isThreadsLoading: Ref<boolean> = ref<boolean>(true);
const pinnedThreadList: Ref<ThreadItem[]> = ref<ThreadItem[]>([]);
const threadList: Ref<ThreadItem[]> = ref<ThreadItem[]>([]);
const currentPage: Ref<number> = ref<number>(1);
const currentUser = ref<ManagedUser | null>(null);
const isGoodOnly = ref<boolean>(false);
const threadSortType = ref<number>(BAR_SORT_REPLY);
const threadScopeLabel = computed(() => isGoodOnly.value ? '精华帖子' : '全部帖子');
const threadSortLabel = computed(() => threadSortType.value === BAR_SORT_CREATE ? '发布时间排序' : '回复时间排序');
const themeColor = computed(() => currentAccentHex.value || 'var(--primary-color)');
const forumLevelId = computed(() => Number(returnData.value.forum.level_id ?? returnData.value.forum.user_level ?? 0));
const isSignedIn = ref<boolean>(false);
const isFollowed = ref<boolean>(false);
const contSignNum = ref<number>(0);
const isSigning = ref<boolean>(false);
const isFollowing = ref<boolean>(false);
const signButtonBackground = computed(() => {
  const color = themeColor.value;
  return color.startsWith('var(') ? `rgba(${color.slice(4, -1)}, 1)` : color;
});
const signButtonState = computed(() => {
  if (!isFollowed.value) {
    return { main: isFollowing.value ? '关注中…' : '关注', signed: false };
  }
  if (isSignedIn.value) {
    return { main: '已签到', signed: true };
  }
  return { main: isSigning.value ? '签到中…' : '签到', signed: false };
});
const forumLevelName = computed(() => returnData.value.forum.level_name?.trim() || '吧等级');
const forumCurScore = computed(() => Math.max(0, Number(returnData.value.forum.cur_score ?? 0)));
const forumLevelupScore = computed(() => Math.max(0, Number(returnData.value.forum.levelup_score ?? 0)));
const levelProgressPercent = computed(() => {
  if (forumLevelupScore.value <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((forumCurScore.value / forumLevelupScore.value) * 100));
});
const levelScoreText = computed(() => {
  if (forumLevelupScore.value <= 0) {
    return `${forumCurScore.value}`;
  }
  return `${forumCurScore.value}/${forumLevelupScore.value}`;
});

// API实例
const apiStore = useApiStore();
const api = apiStore.getApi();

const loadCurrentUser = async (): Promise<void> => {
  if (currentUser.value) {
    return;
  }

  try {
    currentUser.value = await getCurrentUser();
  } catch {
    currentUser.value = null;
  }
};

// 搜索吧内
const openSearchInBar = (): void => {
  emit('openSearchInBar', {
    barName: props.barName,
    barIcon: returnData.value.forum.avatar
  });
};

// 展开/收起吧信息面板
const toggleBarInfo = async (): Promise<void> => {
  barInfoExpanded.value = !barInfoExpanded.value;
  if (barInfoExpanded.value && !panelDataLoaded.value) {
    panelDataLoaded.value = true;
    await Promise.all([loadBawuInfo(), loadBarRules(), loadForumDescription()]);
  }
};

const loadForumDescription = async (): Promise<void> => {
  const forumId = returnData.value.forum.id;
  if (!forumId) {
    return;
  }

  try {
    const detail = await api.getForumDetail(String(forumId), currentUser.value?.bduss ?? '', currentUser.value?.stoken ?? '');
    if (detail && String(detail.error_code) === '0' && detail.forum_info) {
      const text = detail.forum_info.content?.[0]?.text;
      if (text) {
        barDescription.value = String(text);
      }
    }
  } catch (error) {
    console.warn('获取吧简介失败:', error);
  }
};

const loadBarRules = async (): Promise<void> => {
  const forumId = returnData.value.forum.id;
  if (!forumId) {
    return;
  }

  try {
    const ruleData = await api.getForumRule(String(forumId), currentUser.value?.bduss ?? '', currentUser.value?.stoken ?? '');

    if (ruleData && String(ruleData.error_code) === '0' && ruleData.forum_rule_id) {
      barRule.value = {
        title: ruleData.title || '',
        preface: ruleData.preface || '',
        rules: ([
          ...(ruleData.rules || []),
          ...(ruleData.default_rules || []),
          ...(ruleData.new_rules || [])
        ] as Array<Record<string, any>>).map((rule) => ({
          title: rule.title,
          content: rule.content_list?.flatMap((item: Record<string, any>) => item.content || []) || rule.content || []
        }))
      };
    }
  } catch (error) {
    console.warn('获取吧规失败:', error);
  }
};

const loadBawuInfo = async (): Promise<void> => {
  const forumId = returnData.value.forum.id;
  if (!forumId || bawuLoading.value) {
    return;
  }

  bawuLoading.value = true;
  try {
    const bawuInfo = await api.getBawuInfo(String(forumId));
    const teamList = bawuInfo?.bawu_team_info?.bawu_team_list;

    if (String(bawuInfo?.error_code) === '0' && Array.isArray(teamList)) {
      bawuGroups.value = teamList
        .map((group) => ({
          type: group.role_name || '吧务',
          members: ((group.role_info || []) as Array<Record<string, any>>).map((member) => ({
            id: String(member.user_id),
            name: member.name_show || member.user_name || '匿名吧务',
            portrait: member.portrait ? `http://tb.himg.baidu.com/sys/portrait/item/${member.portrait}` : '',
            level: Number(member.user_level ?? 0),
            type: group.role_name || '吧务'
          }))
        }))
        .filter((group) => group.members.length > 0);
    }
  } catch (error) {
    console.warn('获取吧务信息失败:', error);
  } finally {
    bawuLoading.value = false;
  }
};

// 用户名点击
const onUserNameClicked = (uid: string | number): void => {
  emit('openUser', uid);
};

// 线程点击
const handleClick = (id: string | number): void => {
  emit('openThread', id);
};

// 下一页
const nextPage = async (): Promise<void> => {
  currentPage.value++;
  await loadData();
};

const resetThreadList = (): void => {
  currentPage.value = 1;
  pinnedThreadList.value = [];
  threadList.value = [];
  returnData.value = {
    ...returnData.value,
    thread_list: [],
    user_list: [],
    page: { has_more: 1 }
  };
};

const reloadThreads = async (): Promise<void> => {
  if (isThreadsLoading.value) {
    return;
  }

  resetThreadList();
  await loadData();
};

const toggleThreadScope = async (): Promise<void> => {
  if (isThreadsLoading.value) {
    return;
  }

  isGoodOnly.value = !isGoodOnly.value;
  await reloadThreads();
};

const toggleThreadSort = async (): Promise<void> => {
  if (isThreadsLoading.value) {
    return;
  }

  threadSortType.value = threadSortType.value === BAR_SORT_CREATE ? BAR_SORT_REPLY : BAR_SORT_CREATE;
  await reloadThreads();
};

// 滚动处理
const onScroll = (target: { scrollTop: number; clientHeight: number; scrollHeight: number }): void => {
  if ((target.scrollTop + target.clientHeight + 20 >= target.scrollHeight)) {
    if (isThreadsLoading.value || returnData.value.page?.has_more !== 1) {
      return;
    }
    nextPage();
  }
};

// 加载数据
const loadData = async (): Promise<void> => {
  try {
    isThreadsLoading.value = true;
    await loadCurrentUser();

    // 获取吧数据
    let data = await api.browseBar(props.barName, currentPage.value, {
      isGood: isGoodOnly.value,
      sortType: threadSortType.value,
      bduss: currentUser.value?.bduss,
      stoken: currentUser.value?.stoken
    });

    // 通过插件管理器处理数据
    const win = window as unknown as { pluginManager?: { dispatchEvent: (event: string, data: ForumData) => Promise<ForumData> } };
    if (win.pluginManager) {
      data = await win.pluginManager.dispatchEvent('threadListUpdated', data);
    }

    returnData.value = data;

    // 首页特殊处理
    if (currentPage.value === 1) {
      await loadForumLevelInfo();
      await loadSignInfo();

      updateTabMeta?.({
        key: props.key_,
        title: `${returnData.value.forum.name}吧`,
        icon: returnData.value.forum.avatar,
        icon_invert: false
      });

      // 提取置顶帖
      const pinnedThreads = returnData.value.thread_list.filter(item => item.is_top === 1);
      pinnedThreadList.value = [...pinnedThreadList.value, ...pinnedThreads];
    }

    // 过滤非置顶帖并去重
    const previousThreadLen = threadList.value.length;
    const existingIds = new Set(threadList.value.map(item => item.id));
    const newThreads = returnData.value.thread_list
      .filter(item => item.is_top !== 1)
      .filter(item => !existingIds.has(item.id));

    threadList.value = [...threadList.value, ...newThreads];

    // 关联作者信息
    const userMap = new Map(returnData.value.user_list.map(user => [user.id, user]));
    for (let i = previousThreadLen; i < threadList.value.length; i++) {
      threadList.value[i].author = userMap.get(threadList.value[i].author_id);
    }

    // 从吧头像本地提取主题色（仅 forum 模式，异步不阻塞列表渲染）
    if (settingsStore.accentMode === 'forum') {
      void loadForumAccent();
    }
  } catch (error) {
    console.error('加载吧数据失败:', error);
  } finally {
    isThreadsLoading.value = false;
  }
};

let forumAccentGeneration = 0;
const loadForumAccent = async (): Promise<void> => {
  const avatar = returnData.value.forum.avatar;
  if (!avatar) return;
  const generation = ++forumAccentGeneration;
  setForumAccentPair(null);
  const pair = await extractAccentPair(avatar);
  if (generation !== forumAccentGeneration || !pair) return;
  setForumAccentPair(pair);
};

// 吧主题色只在该吧标签页处于激活状态时生效，切走即回退
const activeTabKey = inject<Ref<string>>('activeTabKey', ref(''));
watch(() => String(activeTabKey.value) === String(props.key_), (isActive) => {
  if (isActive) {
    if (settingsStore.accentMode === 'forum' && returnData.value.forum.avatar) {
      void loadForumAccent();
    }
  } else {
    forumAccentGeneration++;
    setForumAccentPair(null);
  }
});

const loadForumLevelInfo = async (): Promise<void> => {
  const forumId = returnData.value.forum.id;
  const user = currentUser.value;

  if (!forumId || !user?.bduss) {
    return;
  }

  try {
    const response = await api.getUserForumLevelInfo(String(forumId), user.bduss, user.stoken);
    const userForumInfo = response?.data?.user_forum_info ?? {};

    isFollowed.value = Number(userForumInfo.is_follow ?? 0) === 1;
    followDays.value = parseInt(userForumInfo.follow_days, 10) || 0;
    myThreadNum.value = parseInt(userForumInfo.thread_num, 10) || 0;
    dayPostNum.value = parseInt(userForumInfo.day_post_num, 10) || 0;

    returnData.value.forum = {
      ...returnData.value.forum,
      level_id: Number(userForumInfo.level_id ?? returnData.value.forum.level_id ?? 0),
      level_name: String(userForumInfo.level_name ?? returnData.value.forum.level_name ?? ''),
      cur_score: Number(userForumInfo.cur_score ?? returnData.value.forum.cur_score ?? 0),
      levelup_score: Number(userForumInfo.levelup_score ?? returnData.value.forum.levelup_score ?? 0),
    };
  } catch (error) {
    console.warn('Failed to load forum level info:', error);
  }
};

const loadSignInfo = async (): Promise<void> => {
  const forumId = returnData.value.forum.id;
  const user = currentUser.value;

  if (!forumId || !user?.bduss) {
    return;
  }

  try {
    const response = await api.getUserSign(String(forumId), user.bduss, user.stoken);
    const info = response?.data?.forum?.[0]?.sign_in_info?.user_info;
    if (info) {
      isSignedIn.value = Number(info.is_sign_in) === 1;
      contSignNum.value = parseInt(info.cont_sign_num, 10) || 0;
      totalSignNum.value = parseInt(info.cout_total_sign_num, 10) || 0;
    }
  } catch (error) {
    console.warn('Failed to load sign info:', error);
  }
};

const handleSignIn = async (): Promise<void> => {
  if (isSignedIn.value || isSigning.value) {
    return;
  }

  const forumId = returnData.value.forum.id;
  const user = currentUser.value;

  if (!forumId || !user?.bduss) {
    sendToast?.('请先登录后再签到', 2000);
    return;
  }

  isSigning.value = true;
  try {
    const response = await api.signForum(props.barName, String(forumId), user.bduss, user.stoken);
    const errorCode = String(response?.error_code);
    const errorMsg = String(response?.error_msg || '');

    if (errorCode === '0') {
      const cont = parseInt(response?.data?.cont_sign_num ?? '', 10);
      if (!Number.isNaN(cont) && cont > 0) {
        contSignNum.value = cont;
      } else {
        contSignNum.value += 1;
      }
      sendToast?.(`签到成功，已连续签到${contSignNum.value}天`, 2000);
    } else if (errorCode === '1602' || errorMsg.includes('已签')) {
      isSignedIn.value = true;
      sendToast?.('今日已签到过啦', 2000);
    } else {
      throw new Error(errorMsg || '签到失败，请稍后再试');
    }

    await loadSignInfo();
  } catch (error) {
    console.error('签到失败:', error);
    sendToast?.(error instanceof Error && error.message ? error.message : '签到失败，请稍后再试', 2000);
  } finally {
    isSigning.value = false;
  }
};

const handleToggleFollow = async (): Promise<void> => {
  if (isFollowing.value) {
    return;
  }

  const forumId = returnData.value.forum.id;
  const user = currentUser.value;
  const forumName = returnData.value.forum.name || props.barName;

  if (!forumId || !user?.bduss) {
    sendToast?.('请先登录后再操作', 2000);
    return;
  }

  isFollowing.value = true;
  try {
    const response = isFollowed.value
      ? await api.unfollowBar(props.barName, String(forumId), user.bduss, user.stoken)
      : await api.followBar(props.barName, String(forumId), user.bduss, user.stoken);
    const errorCode = String(response?.error_code);

    if (errorCode === '0') {
      isFollowed.value = !isFollowed.value;
      sendToast?.(isFollowed.value ? `关注${forumName}吧成功，现在可以签到啦` : `已取消关注${forumName}吧`, 2000);
      await loadForumLevelInfo();
    } else {
      const message = String(response?.error_msg || '操作失败，请稍后再试');
      if (message.includes('已关注')) {
        isFollowed.value = true;
        sendToast?.(message, 2000);
      } else {
        throw new Error(message);
      }
    }

    await loadSignInfo();
  } catch (error) {
    console.error('关注操作失败:', error);
    sendToast?.(error instanceof Error && error.message ? error.message : '操作失败，请稍后再试', 2000);
  } finally {
    isFollowing.value = false;
  }
};

const handleSignButtonClick = (): void => {
  if (!isFollowed.value) {
    handleToggleFollow();
  } else {
    handleSignIn();
  }
};

onMounted(async (): Promise<void> => {
  isLoading.value = true;
  await loadData();
  isLoading.value = false;
});

onBeforeUnmount((): void => {
  forumAccentGeneration++;
  setForumAccentPair(null);
});
</script>

<template>
  <Container :tab-key="props.key_" :scroll-key="`bar-${props.key_}`" @yscroll="onScroll">
    <transition name="fade1">
      <div v-if="!isLoading">
        <div class="bar-banner">
          <div class="image-container">
            <RemoteImage class="background-image" :src="returnData.forum.avatar" />
          </div>
          <div class="banner-content">
            <RemoteImage v-if="openImageViewer" class="avatar" :src="returnData.forum.avatar"
              @click="openImageViewer(returnData.forum.avatar)" />
            <RemoteImage v-else class="avatar" :src="returnData.forum.avatar" />
            <div>
              <div class="title">
                {{ returnData.forum.name }}吧
                <RippleButton
                  style="padding: 4px; border-radius: 50%; background: transparent; box-shadow: none; vertical-align: middle;"
                  @click.stop="handleShare" title="生成分享卡片">
                  <span class="material-symbols-outlined" style="font-size: 20px;">share</span>
                </RippleButton>
              </div>
              <div class="description">{{ returnData.forum.slogan || '暂无简介' }}</div>
              <div class="level-info">
                <div class="level-text">
                  <span class="level-label" :style="{ color: themeColor }">Lv.{{ forumLevelId }}</span>
                  <span>{{ forumLevelName }}</span>
                </div>
                <div class="level-progress">
                  <div class="level-progress-bar"
                    :style="{ width: `${levelProgressPercent}%`, backgroundColor: themeColor }"></div>
                </div>
                <span class="level-score"> ({{ levelScoreText }})</span>
              </div>
              <RippleButton class="sign-button" :class="{ signed: signButtonState.signed }"
                :style="signButtonState.signed ? {} : { backgroundColor: signButtonBackground }"
                :disabled="isSignedIn || isSigning || isFollowing" @click.stop="handleSignButtonClick">
                <span class="sign-main">{{ signButtonState.main }}</span>
              </RippleButton>
            </div>
          </div>
        </div>

        <div class="pinned-thread-list">
          <HorizontalMaskScroll class="thread-filter">
            <RippleButton class="filter-button" :class="{ active: isGoodOnly }"
              style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: right;"
              @click="toggleThreadScope">
              <div style="display: flex; gap: 10px; align-items: center;">
                <img src="/assets/chevrondown.svg" class="icon_">
                <span>{{ threadScopeLabel }}</span>
              </div>
            </RippleButton>
            <RippleButton class="filter-button" :class="{ active: threadSortType === BAR_SORT_CREATE }"
              style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: left;"
              @click="toggleThreadSort">
              <div style="display: flex; gap: 10px; align-items: center;">
                <img src="/assets/schedule.svg" width="18px" class="icon_">
                <span>{{ threadSortLabel }}</span>
              </div>
            </RippleButton>

            <RippleButton class="filter-button"
              style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: right;"
              @click="openSearchInBar()">
              <div style="display: flex; gap: 10px; align-items: center;">
                <img src="/assets/search.svg" width="18px" class="icon_">
                <span>吧内搜索</span>
              </div>
            </RippleButton>

            <RippleButton class="filter-button bar-info-toggle" :class="{ active: barInfoExpanded }"
              style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: right;"
              @click="toggleBarInfo">
              <div style="display: flex; gap: 10px; align-items: center;">
                <img src="/assets/info.svg" width="18px" class="icon_">
                <span>吧信息</span>
              </div>
            </RippleButton>
          </HorizontalMaskScroll>

          <div class="bar-info-panel-wrap" :class="{ expanded: barInfoExpanded }">
            <div class="bar-info-panel">
              <div class="bar-info-card">
                <div class="bar-info-tabs">
                  <RippleButton class="bar-info-tab" :class="{ active: barInfoTab === 'info' }"
                    @click="barInfoTab = 'info'">
                    <img src="/assets/info.svg" width="16px" class="icon_">
                    <span>概览</span>
                  </RippleButton>
                  <RippleButton class="bar-info-tab" :class="{ active: barInfoTab === 'rules' }"
                    @click="barInfoTab = 'rules'">
                    <img src="/assets/list.svg" width="16px" class="icon_">
                    <span>吧规</span>
                  </RippleButton>
                  <RippleButton class="bar-info-tab" :class="{ active: barInfoTab === 'bawu' }"
                    @click="barInfoTab = 'bawu'">
                    <img src="/assets/user.svg" width="16px" class="icon_">
                    <span>吧务</span>
                  </RippleButton>
                </div>

                <div v-if="barInfoTab === 'info'" class="bar-info-content">
                  <!-- <div class="bar-summary">
                    <RemoteImage class="bar-summary-avatar" :src="returnData.forum.avatar" />
                    <div class="bar-summary-main">
                      <div class="bar-summary-name">{{ returnData.forum.name }}吧</div>
                      <div class="bar-summary-slogan">{{ returnData.forum.slogan || '暂无简介' }}</div>
                    </div>
                  </div> -->
                  <div class="bar-stat-tags">
                    <Tag>关注数：{{ formatNumber(Number(returnData.forum.member_num || 0)) }}</Tag>
                    <Tag>帖子数：{{ formatNumber(Number(returnData.forum.post_num || 0)) }}</Tag>
                    <Tag>主题帖数：{{ formatNumber(Number(returnData.forum.thread_num || 0)) }}</Tag>
                    <Tag v-if="returnData.forum.first_class">
                      {{ returnData.forum.first_class }}{{ returnData.forum.second_class ? ' · ' +
                        returnData.forum.second_class : '' }}
                    </Tag>
                  </div>

                  <div class="info-columns">
                    <div class="info-col my-bar-section">
                      <div class="section-title">我在本吧</div>
                      <template v-if="currentUser?.bduss">
                        <div class="follow-status">
                          <span>{{ isFollowed ? `你已关注 ${returnData.forum.name}吧` : `你还未关注 ${returnData.forum.name}吧`
                          }}</span>
                          <button class="mini-action-btn" :disabled="isFollowing" @click="handleToggleFollow">
                            {{ isFollowed ? '取消关注' : '关注' }}
                          </button>
                        </div>
                        <div class="my-level">
                          <span class="my-level-badge" :style="{ color: themeColor }">Lv.{{ forumLevelId }}</span>
                          <span class="my-level-name">{{ forumLevelName }}</span>
                          <div class="my-level-progress">
                            <div class="my-level-progress-bar"
                              :style="{ width: `${levelProgressPercent}%`, backgroundColor: themeColor }"></div>
                          </div>
                          <span class="my-level-score">{{ levelScoreText }}</span>
                        </div>
                        <div class="sign-row">
                          <button class="mini-sign-btn" :class="{ signed: isSignedIn }"
                            :disabled="isSignedIn || isSigning" @click="handleSignIn">
                            {{ isSignedIn ? '今日已签到' : (isSigning ? '签到中…' : '签到') }}
                          </button>
                          <span class="sign-stat">累计 {{ totalSignNum }} 天</span>
                          <span class="sign-stat">连续 {{ contSignNum }} 天</span>
                        </div>
                        <div class="activity-row">
                          <span class="activity-item">关注 {{ followDays }} 天</span>
                          <span class="activity-item">总发帖 {{ myThreadNum }}</span>
                          <span class="activity-item">今日发帖 {{ dayPostNum }}</span>
                        </div>
                      </template>
                      <div v-else class="bar-info-placeholder">请先登录以查看你在本吧的信息</div>
                    </div>

                    <div class="info-col desc-section">
                      <div v-if="barDescription" class="bar-description">
                        <div class="section-title">简介</div>
                        <p class="bar-description-text">{{ barDescription }}</p>
                      </div>
                      <div v-else class="bar-info-placeholder">暂无简介</div>
                    </div>
                  </div>
                </div>

                <div v-else-if="barInfoTab === 'rules'" class="bar-info-content">
                  <div v-if="barRule.title" class="rule-content">
                    <h3 class="rule-title">{{ barRule.title }}</h3>
                    <div v-if="barRule.preface" class="rule-preface">{{ barRule.preface }}</div>
                    <div v-for="(rule, index) in barRule.rules" :key="index" class="rule-section">
                      <div class="rule-section-title">{{ rule.title }}</div>
                      <div v-for="(item, idx) in rule.content" :key="idx" class="rule-item">
                        <p v-if="item.type === '0'">{{ item.text }}</p>
                        <a v-else-if="item.type === '1'" :href="item.link" target="_blank">{{ item.text }}</a>
                      </div>
                    </div>
                  </div>
                  <div v-else class="bar-info-placeholder">本吧暂无吧规，请遵守贴吧社区规范</div>
                </div>

                <div v-else class="bar-info-content">
                  <div v-if="bawuGroups.length" class="bawu-groups">
                    <div v-for="group in bawuGroups" :key="group.type" class="bawu-group">
                      <h4 class="bawu-group-title">{{ group.type }}<span class="bawu-count">{{ group.members.length
                      }}</span></h4>
                      <div class="bawu-members">
                        <div v-for="member in group.members" :key="member.id" class="bawu-capsule"
                          @click="onUserNameClicked(member.id)">
                          <RemoteImage v-if="member.portrait" :src="member.portrait" :alt="member.name"
                            class="bawu-avatar" />
                          <span v-else class="bawu-avatar bawu-avatar-fallback">{{ member.name.charAt(0) }}</span>
                          <span class="bawu-name">{{ member.name }}</span>
                          <span v-if="member.level > 0" class="bawu-level">Lv.{{ member.level }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="bawuLoading" class="bar-info-placeholder">加载中...</div>
                  <div v-else class="bar-info-placeholder">暂无吧务信息</div>
                </div>
              </div>
            </div>
          </div>

          <PinnedThread v-for="item in pinnedThreadList" :key="item.id" :title="item.title"
            @click="handleClick(item.id)" :color="themeColor" />
        </div>

        <div class="thread-list">
          <Thread :tid="item.id" :uid="item.author?.id" @openUser="onUserNameClicked(item.author?.id || 0)"
            @openThread="handleClick(item.id)" v-for="item in threadList" :key="item.id" :thread_title="item.title"
            :media="(item.media || []) as any" :user_name="item.author?.name_show || item.author?.name || '匿名用户'"
            :avatar="item.author?.portrait || ''"
            :thread_content="(item.rich_abstract?.length === 0 || !Array.isArray(item.rich_abstract) ? [{ type: 0, text: item.title }] : item.rich_abstract) as any"
            :create_time="item.last_time_int" :reply_num="item.reply_num"
            :is_good="Boolean(item.isGood ?? item.is_good)" :theme_color="themeColor"></Thread>
        </div>
      </div>
    </transition>

    <transition name="fade1">
      <Loading class="loading-box" v-if="isThreadsLoading"></Loading>
    </transition>
  </Container>
</template>

<style scoped>
/* 筛选行：横向蒙版滚动，窄内容区下保持单行不换行 */
.thread-filter {
  width: 80%;
  margin: 0 auto;
}

.filter-button {
  transition: background-color 0.2s ease;
}

.filter-button.active {
  background-color: rgba(var(--primary-color), 0.12) !important;
}

.bar-info-toggle.active {
  background-color: transparent !important;
  opacity: 1;
  font-weight: 600;
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

.bar-info-panel-wrap {
  width: 80%;
  align-self: center;
  flex-shrink: 0;
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.bar-info-panel-wrap.expanded {
  grid-template-rows: 1fr;
}

.bar-info-panel {
  width: 100%;
  overflow: hidden;
  min-height: 0;
}

.bar-info-card {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 15px;
  border-radius: 8px;
  background-color: rgba(var(--text-color), 0.02);
}

.bar-info-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  margin-left: -10px;
}

.bar-info-tab {
  padding: 5px 12px !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border-radius: 8px;
  font-size: 13px;
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.bar-info-tab :deep(.ripple-content) {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bar-info-tab.active {
  opacity: 1;
  font-weight: 600;
}

.bar-info-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar-info-placeholder {
  text-align: center;
  padding: 16px;
  color: rgba(var(--text-color), 0.5);
  font-size: 13px;
}

.bar-summary {
  display: flex;
  gap: 12px;
  align-items: center;
}

.bar-summary-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bar-summary-name {
  font-size: 16px;
  font-weight: bold;
}

.bar-summary-slogan {
  font-size: 12px;
  opacity: 0.6;
}

.bar-stat-tags {
  display: flex;
  flex-wrap: wrap;
  margin-left: -5px;
  align-items: center;
}

.info-columns {
  display: flex;
  align-items: stretch;
  gap: 24px;
}

.info-col {
  min-width: 0;
  flex: 1 1 0%;
}

.info-columns>.desc-section {
  position: relative;
  min-height: 0;
}

.info-columns>.desc-section>* {
  position: absolute;
  inset: 0;
  overflow-y: auto;
}

.bar-description {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bar-description-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.8;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 窄内容区：吧信息面板双栏改为上下排列，简介由绝对定位填充改回常规流并限高滚动 */
@container page (max-width: 900px) {
  .info-columns {
    flex-direction: column;
    gap: 10px;
  }

  .info-col {
    flex: 0 1 auto;
  }

  .info-columns>.desc-section>* {
    position: static;
    overflow-y: visible;
  }

  .bar-description-text {
    max-height: 240px;
    overflow-y: auto;
  }
}

.my-bar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.7;
}

.follow-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.mini-action-btn {
  padding: 4px 14px;
  border: none;
  border-radius: 999px;
  background-color: rgba(var(--text-color), 0.08);
  color: rgb(var(--text-color));
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.mini-action-btn:hover:not(:disabled) {
  background-color: rgba(var(--text-color), 0.15);
}

.mini-action-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.my-level {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.my-level-badge {
  font-weight: 700;
  white-space: nowrap;
}

.my-level-name {
  white-space: nowrap;
}

.my-level-progress {
  flex: 1;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgba(var(--text-color), 0.14);
}

.my-level-progress-bar {
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  transition: width 0.2s ease;
}

.my-level-score {
  opacity: 0.65;
  white-space: nowrap;
}

.sign-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mini-sign-btn {
  padding: 5px 18px;
  border: none;
  border-radius: 999px;
  background-color: rgba(var(--primary-color), 1);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, opacity 0.2s ease;
}

.mini-sign-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.mini-sign-btn:disabled {
  cursor: default;
}

.mini-sign-btn.signed {
  background-color: rgba(var(--text-color), 0.08);
  color: rgba(var(--text-color), 0.6);
}

.sign-stat {
  font-size: 12px;
  color: rgba(var(--text-color), 0.6);
}

.activity-row {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: rgba(var(--text-color), 0.6);
}

.rule-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  user-select: text;
  cursor: text;
}

.rule-title {
  margin: 0;
  font-size: 15px;
}

.rule-preface {
  opacity: 0.75;
  line-height: 1.5;
}

.rule-section {
  padding: 8px 10px;
  background: rgba(var(--text-color), 0.04);
  border-radius: 8px;
}

.rule-section-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.rule-item p {
  margin: 2px 0;
  line-height: 1.5;
}

.rule-item a {
  color: rgba(var(--primary-color), 1);
}

.bawu-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bawu-group {
  background: rgba(var(--text-color), 0.04);
  padding: 10px;
  border-radius: 8px;
}

.bawu-group-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.bawu-count {
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--text-color), 0.55);
  background: rgba(var(--text-color), 0.08);
  border-radius: 999px;
  padding: 1px 8px;
}

.bawu-members {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.bawu-capsule {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 5px;
  background: rgba(var(--text-color), 0.06);
  border: 1px solid rgba(var(--text-color), 0.08);
  border-radius: 999px;
  transition: background-color 0.2s ease;
  max-width: 100%;
  cursor: pointer;
}

.bawu-capsule:hover {
  background: rgba(var(--text-color), 0.12);
}

.bawu-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.bawu-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--text-color), 0.7);
  background: rgba(var(--text-color), 0.12);
}

.bawu-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bawu-level {
  font-size: 11px;
  color: rgba(var(--text-color), 0.55);
  white-space: nowrap;
}

.pinned-thread-list {
  padding: 10px;
  padding-bottom: 0;
  border-radius: 5px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
}

.banner-content .title {
  font-size: 20px;
  font-weight: bold;
}

.banner-content .description {
  opacity: 0.5;
}

.level-info {
  margin-top: 5px;
  width: min(360px, 44vw);
  display: flex;
  gap: 10px;
  font-size: 13px;
  align-items: center;
}

.level-text {
  display: flex;
  align-items: center;
  gap: 8px;

  line-height: 1.4;
  white-space: nowrap;
}

.level-label {
  font-weight: 700;
}

.level-score {
  opacity: 0.65;
}

.level-progress {
  width: 100%;
  height: 5px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgba(var(--text-color), 0.14);
}

.level-progress-bar {
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  transition: width 0.2s ease;
}

/* 横幅：背景图绝对定位铺底，内容走常规流，横幅随内容撑高（至少 200px），
   窄内容区标题换行变高时不会与下方筛选行重叠 */
.banner-content {
  position: relative;
  box-sizing: border-box;
  padding: 75px 45px 15px;
  display: flex;
  gap: 30px;
}

.banner-content>div {
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
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.bar-banner .avatar:hover {
  transform: scale(1.05);
}

.bar-banner {
  width: 100%;
  min-height: 200px;
  position: relative;
}

.sign-button {
  position: absolute;
  top: 125px;
  right: 45px;
  z-index: 2;

  align-items: center;
  gap: 2px;
  padding: 8px 30px;
  border-radius: 999px;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.sign-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.sign-button:active:not(:disabled) {
  opacity: 0.85;
}

.sign-button:disabled {
  cursor: default;
}

.sign-button.signed {
  background-color: rgba(var(--text-color), 0.08);
  color: rgba(var(--text-color), 0.6);
  box-shadow: none;
}

.sign-main {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}

/* 窄内容区：签到按钮不再绝对定位，作为信息列的最后一行排在等级信息下方
   （须位于基础规则之后，@container 不提升优先级） */
@container page (max-width: 720px) {
  .sign-button {
    position: static;
    display: inline-flex;
    margin-top: 10px;
  }
}
</style>
