<script setup lang="ts">
import { onMounted, ref, computed, inject, watch, type ComputedRef, type Ref } from 'vue';
import Container from '@/components/common/Container.vue';
import { useNarrowLayout } from '@/composables/useNarrowLayout';
import { getUserList, type User } from '@/services/user-manage';
import type { SettingItem, MenuSettingItem, InfoItem } from '@/types/settings';
import { useSettingsStore, type ThreadSaveDefaults } from '@/stores/settings';
import { checkForUpdates } from '@/services/update-check';
import { validateProxy } from '@/utils/settings-policy';
import type { MediaKind } from '@/utils/settings-policy';
import { probeConnection } from '@/core/request';
import { connectionMessage } from '@/utils/settings-policy';
import { invoke } from '@tauri-apps/api/core';
import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { appLogDir } from '@tauri-apps/api/path';
import { WALLPAPER_EFFECT_OPTIONS, GLOBAL_FONT_OPTIONS } from '@/stores/settings';

// Props 定义
interface Props {
  key_: string | number;
}

const props = defineProps<Props>();

// Emits 定义
interface Emits {
  (e: 'setTabInfo', info: { key: string | number; title: string; icon: string }): void;
  (e: 'userChanged'): void;
}

const emit = defineEmits<Emits>();

// Inject
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');
const settingsStore = useSettingsStore();
const actionError = ref('');
const proxyError = computed(() => { try { validateProxy(settingsStore.useProxy, settingsStore.proxyUrl); return ''; } catch (error) { return String(error); } });
const selectingWallpaper = ref(false);
const testing = ref(false);
const checkingUpdates = ref(false);
const updateDesc = ref('按构建日期检查正式版及预发布版本');
const latestReleaseUrl = ref('');
const connectionTestDesc = ref('测试当前网络配置是否可用');
const wallpaperDesc = ref(settingsStore.wallpaperPath ? `当前壁纸：${settingsStore.wallpaperPath.split(/[\\/]/).pop()}` : '选择本地图片作为背景壁纸');
const isMacOS = document.documentElement.classList.contains('macos');
const wallpaperEffectOptions = isMacOS
  ? WALLPAPER_EFFECT_OPTIONS
    .filter(({ value }) => value !== 'mica')
    .map((option) => option.value === 'acrylic' ? { ...option, label: '透明' } : option)
  : /Windows/i.test(navigator.userAgent) ? WALLPAPER_EFFECT_OPTIONS : WALLPAPER_EFFECT_OPTIONS.filter(({ value }) => value === 'image' || value === 'solid');

const systemFonts = ref<Array<{ label: string; value: string }>>(GLOBAL_FONT_OPTIONS);
const systemFontsLoaded = ref(false);
const loadSystemFonts = async (): Promise<void> => {
  if (systemFontsLoaded.value) return;
  systemFontsLoaded.value = true;
  try {
    const families: string[] = await invoke('list_system_fonts');
    const options = [{ label: '默认', value: '' }, ...families.filter(Boolean).map(name => ({ label: name, value: name }))];
    const current = settingsStore.globalFont;
    if (current && !options.some(option => option.value === current)) {
      options.push({ label: `${current}（未安装）`, value: current });
    }
    systemFonts.value = options;
  } catch (error) {
    console.error('枚举系统字体失败:', error);
  }
};

// State 定义
const user: Ref<User[]> = ref([]);
const showUserManage = ref<boolean>(false);
const currentPage = ref<number>(0);
const generalSettingItems = ref<MenuSettingItem[]>([{
  title: '显示',
  icon: '/assets/personalize.svg',
  id: 0,
},
{
  title: '网络',
  icon: '/assets/network_check.svg',
  id: 1,
}, {
  title: '保存',
  icon: '/assets/inbox.svg',
  id: 8,
}, {
  title: '快捷键',
  icon: '/assets/list.svg',
  id: 9,
}, {
  title: '关于',
  icon: '/assets/info.svg',
  id: 2,
}]);

const pluginSettings: Ref<MenuSettingItem[]> = ref([{
  title: '插件管理',
  icon: '/assets/plugin.svg',
  id: 3,
}, {
  title: '自动签到',
  icon: '/assets/plugin.svg',
  id: 4,
}, {
  title: '屏蔽列表',
  icon: '/assets/plugin.svg',
  id: 5,
}, {
  title: '喝水小助手',
  icon: '/assets/plugin.svg',
  id: 6,
}]);

pluginSettings.value = [];

// 窄内容区：左侧分类栏变为入口列表，点选后在页内进入该分类（二级页），返回回到入口列表；
// 宽内容区保持左右双栏
const containerRef = ref<InstanceType<typeof Container> | null>(null);
const { isNarrow } = useNarrowLayout(() => containerRef.value?.getScrollElement() ?? null);
const narrowOpen = ref(false);
const subOpen = computed(() => isNarrow.value && narrowOpen.value);
const currentTitle = computed(() =>
  [...generalSettingItems.value, ...pluginSettings.value].find(item => item.id === currentPage.value)?.title ?? '设置');
const selectCategory = (id: number): void => {
  currentPage.value = id;
  narrowOpen.value = true;
};
watch(isNarrow, narrow => { if (!narrow) narrowOpen.value = false; });

const currentSettingItems = computed<InfoItem[]>(() => [
  { title: 'NeoTieba', icon: 'rocket', desc: `${__APP_VERSION__} · 构建 ${new Date(__BUILD_TIME__).toLocaleString('zh-CN')} · ${__BUILD_COMMIT__.slice(0, 8)}`, id: 7 },
  { title: '更新历史', icon: 'history', desc: '查看 GitHub Releases' },
  { title: '联系', icon: 'hub', desc: '查看项目地址 (GitHub)' },
  { title: '作者', icon: 'person', desc: 'Vkango' },
  { title: '警告', icon: 'warning', desc: '仅供学习交流使用，出现的任何后果作者概不负责。' },
  { title: '检查更新', icon: 'update', desc: updateDesc.value },
  ...(latestReleaseUrl.value ? [{ title: '查看发布 / 下载', icon: 'download', desc: '打开最新发布页面，选择适用的安装包' }] : []),
]);
async function openAboutItem(title: string) {
  actionError.value = '';
  try {
    if (title === '检查更新') {
      if (checkingUpdates.value) return;
      checkingUpdates.value = true; updateDesc.value = '检查中...'; latestReleaseUrl.value = '';
      try { const result = await checkForUpdates(); updateDesc.value = result.message; latestReleaseUrl.value = result.url; }
      catch (error) { updateDesc.value = `检查失败：${String(error)}`; }
      finally { checkingUpdates.value = false; }
      return;
    }
    const urls: Record<string, string> = { '更新历史': 'https://github.com/Vkango/NeoTieba/releases', '联系': 'https://github.com/Vkango/NeoTieba', '作者': 'https://github.com/Vkango', '查看发布 / 下载': latestReleaseUrl.value };
    if (urls[title]) await openUrl(urls[title]);
  } catch (error) { actionError.value = String(error); }
}

const mediaSettings = computed<SettingItem[]>(() => (['avatars', 'videos', 'images', 'audio'] as MediaKind[]).map(kind => ({ id: `media_${kind}`, icon: 'block', title: `禁用${({ avatars: '头像', videos: '视频', images: '帖子配图', audio: '语音' })[kind]}`, type: 'toggle' as const, desc: '启用无图模式时生效', value: settingsStore.mediaPolicy[kind] })));

// 设置项配置
const displaySettings: ComputedRef<SettingItem[]> = computed(() => [
  { id: 'show_user_id', icon: 'person', title: '同时显示用户名与 ID', type: 'toggle', desc: '在帖子中同时显示用户名和用户 ID', value: settingsStore.showUserId },
  { id: 'only_author', icon: 'person', title: '默认只看楼主', type: 'toggle', desc: '打开帖子时优先只显示楼主内容', value: settingsStore.onlyAuthor },
  { id: 'no_image', icon: 'image_not_supported', title: '无图模式', type: 'toggle', desc: '按下方勾选项禁用媒体，保留表情与壁纸', value: settingsStore.noImage },
  { id: 'show_collection_rail', icon: 'collections_bookmark', title: '在导航中展示集锦预览', type: 'toggle', desc: '关闭后隐藏左侧头像栏，但仍可将标签拖入左侧区域加入集锦', value: settingsStore.showCollectionRail },
  { id: 'hover_image_preview', icon: 'zoom_in', title: '悬停快速预览图片', type: 'toggle', desc: '鼠标在帖子图片上短暂停留时，于右侧空白处浮动展示大图；空间不足时自动关闭，点击仍进入完整查看器', value: settingsStore.hoverImagePreview },
  { id: 'highlight_reply_chain', icon: 'forum', title: '悬停高亮楼中楼叙事线', type: 'toggle', desc: '鼠标移入楼中楼回复时，保留它与它逐级回复的上文，其余回复压暗；上文已滚出视野时，在旁边浮窗直接展示这段对话', value: settingsStore.highlightReplyChain },
  {
    id: 'theme',
    icon: 'palette',
    title: '主题',
    type: 'select',
    desc: '选择应用的显示风格',
    value: settingsStore.theme,
    options: [
      { label: '跟随系统', value: 'auto' },
      { label: '浅色', value: 'light' },
      { label: '深色', value: 'dark' },
    ],
  },
  {
    id: 'global_font',
    icon: 'text_fields',
    title: '全局字体',
    type: 'select',
    desc: '选择应用界面使用的字体',
    value: settingsStore.globalFont,
    options: systemFonts.value,
  },
  { id: 'accent_mode', icon: 'color_lens', title: '主题色来源', type: 'select', desc: '使用当前吧主题色、壁纸取色或固定自定义颜色', value: settingsStore.accentMode, options: [{ label: '吧主题色', value: 'forum' }, { label: '壁纸取色', value: 'wallpaper' }, { label: '自定义主题色', value: 'custom' }] },
  ...(settingsStore.accentMode === 'custom' ? [{ id: 'custom_accent_color', icon: 'colorize', title: '自定义主题色', type: 'color' as const, desc: '全局使用此颜色', value: settingsStore.customAccentColor }] : []),
  { id: 'wallpaper_accent', icon: 'contrast', title: '背景亮度', type: 'slider', desc: '亮度越高底色越淡 (0-100)', value: settingsStore.wallpaperAccent ?? 0, min: 0, max: 100 },
  {
    id: 'wallpaper_effect',
    icon: 'blur_on',
    title: '背景选项',
    type: 'select',
    desc: '选择背景模式，切换即时生效',
    value: isMacOS && settingsStore.wallpaperEffect === 'mica' ? 'image' : settingsStore.wallpaperEffect,
    options: wallpaperEffectOptions,
  },
]);

const backgroundSettings = computed<SettingItem[]>(() => [
  ...(settingsStore.wallpaperEffect === 'image'
    ? [
      { id: 'wallpaper', icon: 'wallpaper', title: '壁纸图片', type: 'button' as const, desc: wallpaperDesc.value, action: 'wallpaper' },
      { id: 'wallpaper_blur', icon: 'blur_on', title: '壁纸模糊', type: 'slider' as const, desc: '数字越大越模糊，0 为不模糊 (0-200)', value: settingsStore.wallpaperBlur ?? 0, min: 0, max: 200 },
      { id: 'wallpaper_remove', icon: 'wallpaper', title: '移除壁纸', type: 'button' as const, desc: '恢复默认背景', action: 'remove_wallpaper' },
    ]
    : []),
  ...(settingsStore.wallpaperEffect === 'solid'
    ? [{
      id: 'wallpaper_solid_color',
      icon: 'colorize',
      title: '纯色背景颜色',
      type: 'color' as const,
      desc: '选择纯色模式的背景颜色',
      value: settingsStore.wallpaperSolidColor,
    }]
    : []),
]);

const networkSettings: ComputedRef<SettingItem[]> = computed(() => [
  { id: 'use_proxy', icon: 'settings', title: '使用代理', type: 'toggle', desc: '让 API 请求走下面填写的代理地址', value: settingsStore.useProxy },
  { id: 'proxy_url', icon: 'link', title: '代理地址', type: 'input', desc: '例如 http://127.0.0.1:7890', value: settingsStore.proxyUrl, placeholder: 'http://127.0.0.1:7890' },
  { id: 'connection_test', icon: 'network_check', title: '连接测试', type: 'button', desc: connectionTestDesc.value, action: 'test' },
  { id: 'devtools', icon: 'bug_report', title: '打开开发者工具', type: 'button', desc: '打开 DevTools 调试窗口', action: 'devtools' },
  { id: 'open_log_dir', icon: 'folder_open', title: '打开日志目录', type: 'button', desc: '查看应用运行日志，反馈问题时可附上日志文件', action: 'open_log_dir' },
]);

// 帖子保存设置：预先编辑默认保存选项 + 离线查看回退策略
// 注意：ts_ 后的 id 部分必须与 ThreadSaveDefaults 的属性名（camelCase）一致，
// updateSetting 直接按 id.slice(3) 写入 store。
const threadSaveSettings: ComputedRef<SettingItem[]> = computed(() => [
  { id: 'ts_onlyAuthor', icon: 'person', title: '只保存楼主', type: 'toggle', desc: '保存时只抓取楼主楼层（服务器侧过滤，页码按只看楼主计）', value: settingsStore.threadSaveDefaults.onlyAuthor },
  { id: 'ts_saveImages', icon: 'image', title: '保存图片', type: 'toggle', desc: '将帖子配图离线存入归档', value: settingsStore.threadSaveDefaults.saveImages },
  { id: 'ts_saveVideoAudio', icon: 'movie', title: '保存视频和音频', type: 'toggle', desc: '体积较大，单文件超过 100MB 自动跳过', value: settingsStore.threadSaveDefaults.saveVideoAudio },
  { id: 'ts_saveSubposts', icon: 'forum', title: '保存楼中楼', type: 'toggle', desc: '抓取全部楼中楼回复，其图片遵循以上媒体选项', value: settingsStore.threadSaveDefaults.saveSubposts },
  { id: 'ts_saveAvatars', icon: 'account_circle', title: '保存用户头像和吧头像', type: 'toggle', desc: '不保存可显著减小归档体积，配合下方联网回退在线时仍可显示。除非要完全离线，否则不建议打开。', value: settingsStore.threadSaveDefaults.saveAvatars },
  { id: 'ts_pageRange', icon: 'filter_alt', title: '默认页码范围', type: 'input', desc: '例如 1,2,1-5；留空保存全部', value: settingsStore.threadSaveDefaults.pageRange, placeholder: '留空保存全部' },
  { id: 'ts_pageConcurrency', icon: 'view_agenda', title: '页面并发数', type: 'slider', desc: '同时拉取的帖子页数，1 为串行（1-8），推荐设置为 1，过多可能会触发风控。', value: settingsStore.threadSaveDefaults.pageConcurrency, min: 1, max: 8, step: 1 },
  { id: 'ts_floorConcurrency', icon: 'layers', title: '楼中楼并发数', type: 'slider', desc: '同时抓取的楼中楼数量，1 为串行（1-8）。', value: settingsStore.threadSaveDefaults.floorConcurrency, min: 1, max: 8, step: 1 },
  { id: 'ts_mediaConcurrency', icon: 'burst_mode', title: '媒体并发数', type: 'slider', desc: '同时下载的图片/视频数量，1 为串行（1-16）。', value: settingsStore.threadSaveDefaults.mediaConcurrency, min: 1, max: 16, step: 1 },
  { id: 'ts_retryCount', icon: 'refresh', title: '失败重试次数', type: 'slider', desc: '网络请求失败后自动重试的次数（0-5）', value: settingsStore.threadSaveDefaults.retryCount, min: 0, max: 5, step: 1 },
  { id: 'archive_online_fallback', icon: 'cloud_download', title: '未保存的内容联网获取', type: 'toggle', desc: '查看已保存帖子时，未归档的页面、楼中楼或媒体（如未保存头像）将自动尝试联网加载', value: settingsStore.archiveOnlineFallback },
]);

// Computed
const currentUser: ComputedRef<User | undefined> = computed(() => {
  return user.value.find((u: User) => u.current);
});

// 加载用户列表
const loadUsers = async (): Promise<void> => {
  try {
    user.value = await getUserList();
  } catch (error) {
    console.error('加载用户列表失败:', error);
    user.value = [];
  }
};

// 生命周期钩子
onMounted(async (): Promise<void> => {
  await loadUsers();
  void loadSystemFonts();
  updateTabMeta?.({ key: props.key_, title: "设置", icon: "/assets/settings.svg", icon_invert: true });
});

// 打开用户管理
const openUserManage = (): void => {
  showUserManage.value = true;
};

// QR登录处理
const handleQRLogin = (): void => {
  showUserManage.value = false;
};

// 用户变更处理
const handleUserChanged = async (): Promise<void> => {
  await loadUsers();
  actionError.value = '';
  emit('userChanged');
};

const updateSetting = (id: string, value: string | boolean | number): void => {
  if (id.startsWith('media_')) { settingsStore.mediaBlocks = { ...settingsStore.mediaPolicy, [id.slice(5)]: Boolean(value) }; return; }
  if (id.startsWith('ts_')) {
    if (id === 'ts_pageRange') { settingsStore.threadSaveDefaults.pageRange = String(value); return; }
    const numericKeys: ReadonlyArray<keyof ThreadSaveDefaults> = ['pageConcurrency', 'floorConcurrency', 'mediaConcurrency', 'retryCount'];
    const key = id.slice(3) as keyof ThreadSaveDefaults;
    if (numericKeys.includes(key)) {
      settingsStore.threadSaveDefaults[key] = Number(value) as never;
      return;
    }
    settingsStore.threadSaveDefaults[key as Exclude<keyof ThreadSaveDefaults, 'pageRange' | 'pageConcurrency' | 'floorConcurrency' | 'mediaConcurrency' | 'retryCount'>] = Boolean(value);
    return;
  }
  if (id === 'archive_online_fallback') { settingsStore.archiveOnlineFallback = Boolean(value); return; }
  if (id === 'keyboard_enabled') { settingsStore.updateDisplaySetting(id, value); return; }
  if (['show_user_id', 'show_collection_rail', 'hover_image_preview', 'highlight_reply_chain', 'only_author', 'no_image', 'theme', 'global_font', 'accent_mode', 'custom_accent_color', 'wallpaper_path', 'wallpaper_accent', 'wallpaper_blur', 'wallpaper_effect', 'wallpaper_solid_color'].includes(id)) {
    settingsStore.updateDisplaySetting(id, value);
    return;
  }

  if (['use_proxy', 'proxy_url'].includes(id)) {
    settingsStore.updateNetworkSetting(id, value);
  }
};

const pickWallpaper = async (): Promise<void> => {
  if (settingsStore.wallpaperBusy || selectingWallpaper.value) return;
  selectingWallpaper.value = true;
  const previous = wallpaperDesc.value;
  wallpaperDesc.value = '正在选择...';
  try {
    const path = await settingsStore.pickWallpaper();
    wallpaperDesc.value = path
      ? `当前壁纸: ${path.split(/[\\/]/).pop() || path}`
      : previous;
  } catch (error) {
    wallpaperDesc.value = '选择壁纸失败';
    actionError.value = String(error);
  } finally { selectingWallpaper.value = false; }
};

const removeWallpaper = (): void => {
  settingsStore.removeWallpaper();
  wallpaperDesc.value = '已恢复默认背景';
};

// 连接测试
const testConnection = async (): Promise<void> => {
  if (testing.value) return;
  testing.value = true;
  connectionTestDesc.value = '测试中...';
  const startedAt = performance.now();

  try {
    const status = await probeConnection();
    connectionTestDesc.value = connectionMessage(status, Math.round(performance.now() - startedAt));
  } catch (error) {
    connectionTestDesc.value = error instanceof Error ? error.message : '连接失败';
  } finally { testing.value = false; }
};

const handleSettingAction = (setting: SettingItem): void => {
  if ('action' in setting && setting.action === 'test') {
    testConnection();
  } else if ('action' in setting && setting.action === 'devtools') {
    openDevTools();
  } else if ('action' in setting && setting.action === 'open_log_dir') {
    openLogDir();
  } else if ('action' in setting && setting.action === 'wallpaper') {
    pickWallpaper();
  } else if ('action' in setting && setting.action === 'remove_wallpaper') {
    removeWallpaper();
  }
};

const openDevTools = (): void => {
  invoke('toggle_devtools').catch((error) => {
    actionError.value = `打开开发者工具失败：${String(error)}`;
  });
};

const openLogDir = async (): Promise<void> => {
  try {
    await openPath(await appLogDir());
  } catch (error) {
    actionError.value = `打开日志目录失败：${String(error)}`;
  }
};

// 滚动处理
const onScroll = (_target: HTMLElement): void => {

};


</script>

<template>
  <Container ref="containerRef" class="page" :tab-key="props.key_" :scroll-key="`setting-${props.key_}`" @yscroll="onScroll">
    <div class="setting-page" :class="{ narrow: isNarrow }">

      <!-- 窄内容区二级页顶栏 -->
      <div v-if="subOpen" class="sub-head">
        <RippleButton class="sub-back" title="返回" @click="narrowOpen = false">
          <span class="material-symbols-outlined">arrow_back</span>
        </RippleButton>
        <span class="sub-title">{{ currentTitle }}</span>
      </div>

      <div class="setting-layout">

        <div v-if="!subOpen" class="setting-nav">
          <!-- 用户信息区域 -->
          <div class="setting-user">
            <RippleButton
              style="background-color: transparent; box-shadow: none; padding: 0; width: 100%; min-width: 200px;"
              @click="openUserManage">

              <div v-if="currentUser" style="display: flex; gap: 10px; text-align: left; width: 100%;">
                <RemoteImage kind="avatars" class="avatar" :src="currentUser.avatar || ''"
                  referrerpolicy="no-referrer" />
                <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; margin-top: 5px;">
                  <div
                    style="font-weight: bold; color: rgb(var(--text-color)); font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    {{ currentUser.user_name || currentUser.username }}
                  </div>
                  <div style="text-align: left; font-size: 13px; color: rgba(var(--text-color), 0.5); ">
                    轻按进入账号管理
                  </div>
                </div>
              </div>

              <div v-else style="display: flex; gap: 10px; text-align: left; width: 100%; align-items: center;">
                <div class="avatar-placeholder">
                  <span class="material-symbols-outlined">person_off</span>
                </div>
                <div style="display: flex; flex-direction: column; flex: 1;">
                  <div style="font-weight: bold; color: rgb(var(--text-color)); font-size: 16px;">
                    未登录
                  </div>
                  <div style="text-align: left; font-size: 13px; color: rgba(var(--text-color), 0.5)">
                    轻按登录账号
                  </div>
                </div>
              </div>
            </RippleButton>
          </div>

          <div class="filter-button" style="padding: 0 8px">通用</div>
          <RippleButton v-for="item in generalSettingItems" :key="item.id" class="filter-button nav-item"
            :class="{ selected: item.id === currentPage && !isNarrow }" @click="selectCategory(item.id)">
            <div class="nav-item-inner">
              <img :src="item.icon" width="16px" class="icon_">
              <span class="nav-item-title">{{ item.title }}</span>
              <span v-if="isNarrow" class="material-symbols-outlined nav-item-chevron">chevron_right</span>
            </div>
          </RippleButton>
          <div v-if="pluginSettings.length" class="filter-button" style="padding: 0 8px">插件</div>
          <RippleButton v-for="item in pluginSettings" :key="item.id" class="filter-button nav-item"
            :class="{ selected: item.id === currentPage && !isNarrow }" @click="selectCategory(item.id)">
            <div class="nav-item-inner">
              <img :src="item.icon" width="16px" class="icon_">
              <span class="nav-item-title">{{ item.title }}</span>
              <span v-if="isNarrow" class="material-symbols-outlined nav-item-chevron">chevron_right</span>
            </div>
          </RippleButton>
        </div>

        <!-- 设置内容区域：窄内容区仅在进入某分类后显示 -->
        <div v-if="!isNarrow || subOpen" class="setting-body">
          <p v-if="actionError || settingsStore.settingsError || proxyError" role="alert">{{ actionError ||
            settingsStore.settingsError || proxyError }}</p>
          <!-- 显示设置 -->
          <div v-if="currentPage === 0" class="settings-content">
            <div style="display: flex; text-align: left; gap: 10px; align-items: center; margin-bottom: 20px;">
              <div style="font-size: 25px; font-weight: bold;">显示</div>
            </div>
            <div class="setting-section">
              <template v-for="setting in displaySettings" :key="setting.id">
                <Item :title="setting.title" :desc="setting.desc" :icon="setting.icon" :type="setting.type"
                  :value="'value' in setting ? setting.value : undefined"
                  @update:value="updateSetting(setting.id, $event)"
                  :options="'options' in setting ? setting.options : []"
                  :placeholder="'placeholder' in setting ? setting.placeholder : undefined"
                  :min="'min' in setting ? setting.min : undefined" :max="'max' in setting ? setting.max : undefined"
                  :step="'step' in setting ? setting.step : undefined" @click="handleSettingAction(setting)" />
                <div v-if="setting.id === 'no_image' && settingsStore.noImage" class="media-setting-group"
                  aria-label="无图模式禁用选项">
                  <Item v-for="mediaSetting in mediaSettings" :key="mediaSetting.id" :title="mediaSetting.title"
                    :desc="mediaSetting.desc" :icon="mediaSetting.icon" :type="mediaSetting.type"
                    :value="'value' in mediaSetting ? mediaSetting.value : undefined"
                    @update:value="updateSetting(mediaSetting.id, $event)" />
                </div>
                <div v-if="setting.id === 'wallpaper_effect' && backgroundSettings.length" class="media-setting-group"
                  aria-label="背景模式设置">
                  <Item v-for="backgroundSetting in backgroundSettings" :key="backgroundSetting.id"
                    :title="backgroundSetting.title" :desc="backgroundSetting.desc" :icon="backgroundSetting.icon"
                    :type="backgroundSetting.type"
                    :value="'value' in backgroundSetting ? backgroundSetting.value : undefined"
                    @update:value="updateSetting(backgroundSetting.id, $event)"
                    :min="'min' in backgroundSetting ? backgroundSetting.min : undefined"
                    :max="'max' in backgroundSetting ? backgroundSetting.max : undefined"
                    :step="'step' in backgroundSetting ? backgroundSetting.step : undefined"
                    @click="handleSettingAction(backgroundSetting)" />
                </div>
              </template>

            </div>
          </div>

          <!-- 网络设置 -->
          <div v-if="currentPage === 1" class="settings-content">
            <div style="display: flex; text-align: left; gap: 10px; align-items: center; margin-bottom: 20px;">
              <div style="font-size: 25px; font-weight: bold;">网络</div>
            </div>
            <div class="setting-section">
              <Item v-for="setting in networkSettings" :key="setting.id" :title="setting.title" :desc="setting.desc"
                :icon="setting.icon" :type="setting.type" :value="'value' in setting ? setting.value : undefined"
                @update:value="updateSetting(setting.id, $event)" :options="'options' in setting ? setting.options : []"
                :placeholder="'placeholder' in setting ? setting.placeholder : undefined"
                @click="handleSettingAction(setting)" />
            </div>
          </div>

          <!-- 保存设置 -->
          <div v-if="currentPage === 8" class="settings-content">
            <div style="display: flex; text-align: left; gap: 10px; align-items: center; margin-bottom: 20px;">
              <div style="font-size: 25px; font-weight: bold;">保存</div>
            </div>
            <div class="setting-section">
              <Item v-for="setting in threadSaveSettings" :key="setting.id" :title="setting.title" :desc="setting.desc"
                :icon="setting.icon" :type="setting.type" :value="'value' in setting ? setting.value : undefined"
                @update:value="updateSetting(setting.id, $event)"
                :placeholder="'placeholder' in setting ? setting.placeholder : undefined"
                :min="'min' in setting ? setting.min : undefined" :max="'max' in setting ? setting.max : undefined"
                :step="'step' in setting ? setting.step : undefined" />
            </div>
          </div>

          <!-- 快捷键设置 -->
          <div v-if="currentPage === 9" class="settings-content">
            <div style="display: flex; text-align: left; gap: 10px; align-items: center; margin-bottom: 20px;">
              <div style="font-size: 25px; font-weight: bold;">快捷键</div>
            </div>
            <div class="setting-section">
              <Item icon="keyboard" title="启用键盘控制" type="toggle"
                desc="关闭后所有快捷键失效；按 ? 可随时查看当前键位" :value="settingsStore.keyboardEnabled"
                @update:value="updateSetting('keyboard_enabled', $event)" />
              <HotkeySettings />
            </div>
          </div>

          <!-- 关于 -->
          <div v-if="currentPage === 2" class="settings-content">
            <div style="display: flex; text-align: left; gap: 10px; align-items: center; margin-bottom: 15px;">
              <div style="font-size: 25px; font-weight: bold;">关于</div>
              <div
                style=" display: flex; align-items: center; gap: 10px; background-color: rgba(255,193, 49, 0.15); padding-right: 10px; border-radius: 5px; margin-left: auto;">
                <span
                  style="font-size: 14px; font-weight: bold; padding: 5px 10px; background-color: rgba( 36,200,219, 0.15); border-radius: 5px 0px 0px 5px;">Built
                  with</span>
                <img class="tauri-logo-light" src="/assets/tauri-logo-light.svg" height="20px" alt="Tauri">
                <img class="tauri-logo-dark" src="/assets/tauri-logo.svg" height="20px" alt="Tauri">
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px">
              <Item v-for="item in currentSettingItems" :key="item.id" :icon="item.icon" :title="item.title"
                :desc="item.desc" style="width: 100%;" @click="openAboutItem(item.title)"></Item>
            </div>
          </div>
        </div>
      </div>
    </div>

    <UserManageCard :visible="showUserManage" @close="showUserManage = false" @qrLogin="handleQRLogin"
      @userChanged="handleUserChanged" />
  </Container>
</template>

<style scoped>
.setting-page {
  width: 80%;
  margin: 0 auto;
  padding-top: 20px;
}

.setting-layout {
  display: flex;
  gap: 15px;
  margin-top: 10px;
}

.setting-nav {
  display: flex;
  flex-direction: column;
  width: 25%;
  min-width: 200px;
  gap: 10px;
}

.setting-user {
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.setting-body {
  width: 100%;
  min-width: 0;
}

.nav-item {
  box-shadow: none;
  padding: 6px 8px;
  font-size: 14px;
  opacity: 1;
}

.nav-item-inner {
  display: flex;
  gap: 10px;
  align-items: center;
}

.nav-item-title {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.nav-item-chevron {
  font-size: 18px;
  opacity: 0.4;
}

.sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
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

/* 窄内容区：分类栏变为纵向入口列表（二级页模式），内容区进入分类后才显示 */
@container page (max-width: 720px) {
  .setting-layout {
    flex-direction: column;
  }

  .setting-nav {
    width: 100%;
    min-width: 0;
    gap: 6px;
  }

  .setting-user {
    margin-bottom: 4px;
  }

  .nav-item {
    width: 100%;
    padding: 12px 14px;
    background-color: rgba(var(--text-color), 0.04);
  }
}

.media-setting-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-left: 24px;
  padding-left: 12px;
  border-left: 2px solid rgba(var(--text-color), 0.12);
}

.tauri-logo-dark {
  display: none;
}

:global(:root.dark .tauri-logo-light) {
  display: none;
}

:global(:root.dark .tauri-logo-dark) {
  display: block;
}

.filter-button.selected {
  background-color: rgba(var(--text-color), 0.05);
  font-weight: bold;
}

.filter-button:hover {
  opacity: 0.5;
}

.filter-button {
  background-color: transparent;
  font-weight: normal;
}

.navi-bar {
  text-align: left;
}

.current-user {
  width: 100%;
  padding: 6px 8px;
  border-radius: 5px;
  background-color: rgba(var(--text-color), 0.1);
  gap: 10px;
}

.avatar {
  width: 50px;
  height: 50px;
  border-radius: 50px;
  object-fit: cover;
}

.avatar-placeholder {
  width: 50px;
  height: 50px;
  border-radius: 50px;
  background-color: rgba(var(--text-color), 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-placeholder .material-symbols-outlined {
  font-size: 28px;
  color: rgba(var(--text-color), 0.4);
}

.settings-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.setting-section {
  display: flex;
  flex-direction: column;
  gap: 10px
}
</style>
