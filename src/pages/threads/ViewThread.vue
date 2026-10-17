<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onBeforeUnmount, onActivated, watch, inject, provide, type Ref } from 'vue';
import { useTabStore } from '@/stores/tabs';
import { useApiStore, useSettingsStore, useUserStore } from '@/stores';
import Container from '@/components/common/Container.vue';
import { getCurrentUser } from '@/services/user-manage';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    archiveMediaUrl,
    archiveReadMeta,
    archiveReadPage,
    threadSaveStart,
    threadSaveStatus,
    type ArchiveSummary,
    type ThreadSaveProgress
} from '@/core/archive';
import { resolveProxyUrl } from '@/core/request';
import type { ThreadSaveDefaults } from '@/stores/settings';
import ThreadSaveDialog from '@/components/common/ThreadSaveDialog.vue';
import ImageViewer from '@/components/common/ImageViewer.vue';

import Reply from '@/components/thread/Reply.vue';
import ThreadFloorIndex from '@/components/thread/ThreadFloorIndex.vue';
import { findReadingFloor, floorPreview } from '@/utils/thread-index';
import ReplyView from '@/components/thread/SubPostView.vue';
import { useShareCard, threadUrl, shareAvatarUrl, formatCardDate } from '@/services/share-card/useShareCard';
import { formatNumber } from '@/utils/helper';
import type { ContentElement } from '@/types/common';

interface GalleryImage {
  id: string;
  postId: string;
  author_id: string;
  floor: number;
  src: string;
  alt: string;
}

// 类型定义
interface Props {
  tid: string | number;
  key_: string | number;
  local?: boolean;
  compact?: boolean;
}

interface Emits {
  (e: 'setTabInfo', info: { key: string | number; title: string; icon: string }): void;
  (e: 'openUser', uid: string | number): void;
  (e: 'openBar', barName: string): void;
}

interface User {
  id: string | number;
  user_name: string;
  display_name?: string;
  portrait?: string;
  [key: string]: any;
}

interface Post {
  id: string | number;
  author_id: string | number;
  author?: User;
  agree: {
    agree_num: number;
    disagree_num: number;
  };
  [key: string]: any;
}

interface ThreadData {
  error?: { errorno?: number; errmsg?: string };
  data?: {
    thread: {
      title: string;
      author?: User;
      reply_num?: number;
      collect_status?: number;
      collect_mark_pid?: string;
    };
    forum: {
      name: string;
      avatar: string;
    };
    user_list: User[];
    post_list: Post[];
    page: {
      has_more: boolean | number;
      total_page?: number;
      new_total_page?: number;
    };
  };
}

interface SubPostInfo {
  ip_address?: string;
  like: number;
  user_name: string;
  uid: string | number;
  avatar: string;
  thread_content: any[];
  create_time: number;
  reply_num: number;
  tid: string;
  pid: string | number;
  floor: number;
  is_lz: boolean;
  level?: number;
  local?: boolean;
}

// Props & Emits
const props = defineProps<Props>();
const tabStore = useTabStore();
const emit = defineEmits<Emits>();

// Injects
const sendToast = inject<(title: string, duration: number) => void>('sendToast');
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

// State
const returnData: Ref<ThreadData> = ref({});
const user_list: Ref<User[]> = ref([]);
const isLoading = ref<boolean>(true);
const isThreadsLoading = ref<boolean>(true);
const threadList: Ref<Post[]> = ref([]);
const currentPage = ref<number>(1);
const galleryOpen = ref(false);
const viewElement = ref<HTMLElement>();
const viewWidth = ref(1000);
const contextCollapsed = ref(false);
const preferredContextWidth = ref<number>();
const resizing = ref(false);
let viewObserver: ResizeObserver | undefined;
const minimumPanelWidth = computed(() => Math.min(240, viewWidth.value * .4));
const maximumPanelWidth = computed(() => Math.max(minimumPanelWidth.value, viewWidth.value - minimumPanelWidth.value - 10));
const contextWidth = computed(() => contextCollapsed.value ? 0 : Math.max(minimumPanelWidth.value,
  Math.min(maximumPanelWidth.value, preferredContextWidth.value ?? Math.min(420, viewWidth.value * .44))));

function captureLayoutAnchor() {
  updateReadingPosition();
  const container = containerRef.value?.getScrollElement();
  const element = postElements.get(activePostId.value);
  layoutAnchor = container && element ? {
    id: activePostId.value,
    offset: element.getBoundingClientRect().top - container.getBoundingClientRect().top
  } : undefined;
}
function settleLayout() {
  clearTimeout(layoutTimer);
  void nextTick(restoreLayoutAnchor);
  layoutTimer = setTimeout(() => { restoreLayoutAnchor(); layoutAnchor = undefined; scheduleReadingPosition(); }, 260);
}
function toggleContext() {
  captureLayoutAnchor();
  contextCollapsed.value = !contextCollapsed.value;
  settleLayout();
}
function startResize(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
  captureLayoutAnchor();
  resizing.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}
function moveResize(event: PointerEvent) {
  if (!resizing.value || !viewElement.value) return;
  contextCollapsed.value = false;
  preferredContextWidth.value = Math.max(minimumPanelWidth.value,
    Math.min(maximumPanelWidth.value, viewElement.value.getBoundingClientRect().right - event.clientX - 5));
  void nextTick(restoreLayoutAnchor);
}
function endResize() {
  if (!resizing.value) return;
  resizing.value = false;
  settleLayout();
}
function resizeWithKeyboard(event: KeyboardEvent) {
  if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  captureLayoutAnchor();
  const width = event.key === 'Home' ? minimumPanelWidth.value : event.key === 'End' ? maximumPanelWidth.value
    : contextWidth.value + (event.key === 'ArrowLeft' ? 24 : -24);
  contextCollapsed.value = false;
  preferredContextWidth.value = Math.max(minimumPanelWidth.value, Math.min(maximumPanelWidth.value, width));
  settleLayout();
}
const galleryOnlyAuthor = ref(false);
const galleryIncludeSubposts = ref(true);
const subpostGalleryImages = ref<GalleryImage[]>([]);
const adHocImage = ref<GalleryImage | null>(null);
const selectedImageId = ref('');
const galleryAutoFollow = ref(false);
let galleryFollowVersion = 0;
const visibleThreadList = computed(() => (galleryOpen.value ? galleryOnlyAuthor.value : props.local && onlyThreadAuthor.value)
  ? threadList.value.filter(post => String(post.author_id) === threadAuthorId.value) : threadList.value);
const galleryImages = computed<GalleryImage[]>(() => {
  if (settings.isMediaBlocked('images')) return [];
  const mainImages = visibleThreadList.value.flatMap(post =>
    (Array.isArray(post.content) ? post.content : []).flatMap((content: Record<string, unknown>, index: number) => {
      const src = content.bigCdnSrc || content.big_cdn_src || content.bigSrc || content.big_src || content.originSrc || content.origin_src;
      return Number(content.type) === 3 && typeof src === 'string' && src ? [{
        id: `${post.id}-${index}`, postId: String(post.id), author_id: String(post.author_id),
        floor: Number(post.floor), src, alt: `第 ${post.floor} 楼图片`
      }] : [];
    }));
  // Keep the gallery in reading order. Stable sorting preserves the main
  // floor image before any楼中楼 images discovered for the same floor.
  const list = galleryIncludeSubposts.value ? [...mainImages, ...subpostGalleryImages.value] : [...mainImages];
  list.sort((a, b) => a.floor - b.floor);
  const adHoc = adHocImage.value;
  if (adHoc && !list.some(image => image.id === adHoc.id)) {
    list.push(adHoc);
    list.sort((a, b) => a.floor - b.floor);
  }
  return list;
});
const selectedImageIndex = computed(() => galleryImages.value.findIndex(image => image.id === selectedImageId.value));
const selectedImage = computed(() => galleryImages.value[selectedImageIndex.value]);
const islandPost = computed(() => threadList.value.find(post => String(post.id) === selectedImage.value?.postId));
const islandFloorImages = computed(() => galleryImages.value.filter(image => image.postId === selectedImage.value?.postId));
const islandAuthorName = computed(() => islandPost.value?.author?.name_show || islandPost.value?.author?.name || '匿名用户');
const islandAvatar = computed(() => 'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + (islandPost.value?.author?.portrait || 'default'));
const islandTextSegments = computed(() => {
  const content = islandPost.value?.content;
  if (!Array.isArray(content)) return [];
  const segments: { type: 'text' | 'emoticon'; value: string; alt?: string }[] = [];
  for (const part of content as Record<string, unknown>[]) {
    if (Number(part.type) === 2 && typeof part.text === 'string' && part.text) {
      segments.push({ type: 'emoticon', value: `/assets/emoticons/${part.text}.png`, alt: String(part.c || part.text) });
    } else if (typeof part.text === 'string') {
      const text = part.text.replace(/\s+/g, ' ');
      if (text.trim()) segments.push({ type: 'text', value: text });
    }
  }
  return segments;
});
const islandPlainText = computed(() => islandTextSegments.value
  .map(segment => segment.type === 'emoticon' ? `[${segment.alt}]` : segment.value).join('').trim());
let layoutTimer: ReturnType<typeof setTimeout> | undefined;
let layoutAnchor: { id: string; offset: number } | undefined;

function restoreLayoutAnchor() {
  if (!layoutAnchor) return;
  const element = postElements.get(layoutAnchor.id);
  if (element) containerRef.value?.scrollToElement(element, layoutAnchor.offset);
}
async function toggleGallery() {
  captureLayoutAnchor();
  galleryOpen.value = !galleryOpen.value;
  if (galleryOpen.value) contextCollapsed.value = false;
  if (galleryOpen.value && !selectedImage.value) {
    selectedImageId.value = (galleryImages.value.find(image => image.postId === activePostId.value) ?? galleryImages.value[0])?.id ?? '';
  }
  await nextTick();
  restoreLayoutAnchor();
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { restoreLayoutAnchor(); layoutAnchor = undefined; scheduleReadingPosition(); }, 260);
}
function selectGalleryImage(id: string) {
  selectedImageId.value = id;
}
async function followGalleryFloor(version: number) {
  const id = selectedImage.value?.postId;
  if (!id) return;
  if (contextCollapsed.value) {
    toggleContext();
    layoutAnchor = undefined;
    await new Promise<void>(resolve => setTimeout(resolve, 260));
  }
  await nextTick();
  if (version !== galleryFollowVersion || !galleryAutoFollow.value || !galleryOpen.value) return;
  layoutAnchor = undefined;
  const element = postElements.get(id);
  if (element) {
    containerRef.value?.scrollToElement(element);
    activePostId.value = id;
    floorIndexRef.value?.reveal(id);
    scheduleReadingPosition();
  }
}
const galleryAtEnd = computed(() => selectedImageIndex.value >= galleryImages.value.length - 1);
const galleryHasMore = computed(() => Boolean(returnData.value.data?.page?.has_more) && !isThreadsLoading.value);
async function loadGalleryNextPage() {
  if (!galleryOpen.value || !galleryHasMore.value) return;
  if (await loadData(currentPage.value + 1)) {
    await nextTick();
    const image = galleryImages.value[selectedImageIndex.value + 1];
    if (image) selectedImageId.value = image.id;
  }
}
async function stepGallery(direction: number) {
  const index = selectedImageIndex.value + direction;
  const image = galleryImages.value[index];
  if (image) {
    selectedImageId.value = image.id;
    if (direction > 0 && index === galleryImages.value.length - 1 && galleryHasMore.value) void loadData(currentPage.value + 1);
    return;
  }
  if (direction > 0) void loadGalleryNextPage();
}
function selectReplyImage(url: string, postId: string) {
  if (!galleryOpen.value) {
    openImageViewer?.(url);
    return;
  }
  const image = galleryImages.value.find(image => image.postId === postId && new URL(image.src, window.location.href).href === new URL(url, window.location.href).href);
  if (image) {
    selectGalleryImage(image.id);
    return;
  }
  const id = `subpost-${btoa(url).replace(/[^a-z0-9]/gi, '')}`;
  const floor = Number(threadList.value.find(post => String(post.id) === postId)?.floor ?? 0);
  const entry: GalleryImage = { id, postId, author_id: '', floor, src: url, alt: '楼中楼图片' };
  if (galleryIncludeSubposts.value) {
    if (!subpostGalleryImages.value.some(item => item.id === id)) subpostGalleryImages.value.push(entry);
  } else {
    adHocImage.value = entry;
  }
  selectedImageId.value = id;
}
function registerReplyImages(urls: string[], postId: string) {
  const floor = Number(threadList.value.find(p => String(p.id) === postId)?.floor ?? 0);
  for (const url of urls) {
    const id = `subpost-${btoa(url).replace(/[^a-z0-9]/gi, '')}`;
    if (!subpostGalleryImages.value.some(item => item.id === id)) subpostGalleryImages.value.push({ id, postId, author_id: '', floor, src: url, alt: '楼中楼图片' });
  }
}
async function toggleGalleryAuthor() {
  galleryOnlyAuthor.value = !galleryOnlyAuthor.value;
  await nextTick();
  const image = selectedImage.value ?? galleryImages.value[0];
  if (image) await selectGalleryImage(image.id);
  else selectedImageId.value = '';
}


const userStore = useUserStore();
const settings = useSettingsStore();
const onlyThreadAuthor = ref(settings.onlyAuthor);
watch(() => settings.isMediaBlocked('images'), blocked => { if (blocked) galleryOpen.value = false; });
const threadAuthorId = ref<string>('');
const containerRef = ref<InstanceType<typeof Container> | null>(null);
const floorIndexRef = ref<InstanceType<typeof ThreadFloorIndex> | null>(null);
const activePostId = ref('');
const readingIndex = ref(0);
const firstLoadedPage = ref(1);
const isFloorNavigating = ref(false);
const postPages = new Map<string, number>();
const postElements = new Map<string, HTMLElement>();
let readingFrame = 0;
let contentObserver: ResizeObserver | undefined;
const activePost = computed(() => visibleThreadList.value.find(post => String(post.id) === activePostId.value) ?? visibleThreadList.value[0]);
const readingPage = computed(() => postPages.get(activePostId.value) ?? currentPage.value);
const floorEntries = computed(() => visibleThreadList.value.map(post => ({
  id: String(post.id),
  floor: Number(post.floor),
  avatar: 'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + (post.author?.portrait || 'default'),
  preview: floorPreview(post.content, threadTitle.value),
})));
const isJumpOpen = ref(false);
const jumpInput = ref('1');
const jumpError = ref('');
const pageInputRef = ref<HTMLInputElement | null>(null);
const isFavourite = ref(false);
const isFavouriteLoading = ref(false);
const favouritePostId = ref('');
const favouriteAccountId = ref('');
const totalPages = computed(() => {
  const page = returnData.value.data?.page;
  const total = Number(page?.total_page || page?.new_total_page || 0);
  return Number.isInteger(total) && total > 0 ? total : undefined;
});
const threadTitle = ref<string>("");
const loadError = ref('');
const isSubPostCardOpen = ref(false);
const currentSubPostInfo: Ref<SubPostInfo> = ref({
  like: 0,
  user_name: '',
  uid: '',
  avatar: '',
  thread_content: [],
  create_time: 0,
  reply_num: 0,
  tid: String(props.tid),
  pid: 0,
  floor: 0,
  is_lz: false
});

const openImageViewer = inject<(url: string) => void>('openImageViewer');
const captureRef = ref<HTMLElement | null>(null);
const shareCard = useShareCard();

const handleShare = async () => {
  const data = returnData.value.data;
  const forum = data?.forum;
  const firstPost = threadList.value[0];
  const authorName = firstPost?.author?.name_show || firstPost?.author?.name || '匿名用户';
  await shareCard({
    title: threadTitle.value || '贴吧帖子',
    avatar: shareAvatarUrl(firstPost?.author?.portrait),
    barName: forum?.name,
    barAvatar: forum?.avatar,
    meta: `${authorName} · ${formatCardDate(Number(firstPost.time || 0))}`,
    contentElements: (firstPost?.content || []) as ContentElement[],
    stats: [{ label: '回复', value: formatNumber(Number(data?.thread?.reply_num ?? threadList.value.length)) }],
    qrUrl: threadUrl(props.tid)
  });
};


// API实例
const apiStore = useApiStore();
const api = apiStore.getApi();

// ---------------------------------------------------------------------------
// 帖子归档：保存对话框、进度事件、离线媒体解析
// ---------------------------------------------------------------------------
const archiveMeta = ref<ArchiveSummary | null>(null);
const isSaveOpen = ref(false);
const isSaving = ref(false);
let unlistenSave: UnlistenFn | undefined;

// 本地模式下把远程媒体 URL 映射到 tar 归档内的副本（archive:// 协议）。
const offlineResolver = (url: string): string =>
  props.local && /^https?:|^\/\//.test(url) ? archiveMediaUrl(String(props.tid), url) : url;
provide('offlineMedia', props.local ? offlineResolver : undefined);

const refreshArchiveMeta = async (): Promise<void> => {
  archiveMeta.value = await archiveReadMeta(String(props.tid)).catch(() => null);
};

const openSaveDialog = (): void => {
  isSaveOpen.value = true;
  void refreshArchiveMeta();
};

const startSave = async (options: ThreadSaveDefaults): Promise<void> => {
  if (isSaving.value) return;
  const user = userStore.currentUser;
  try {
    await threadSaveStart(
      String(props.tid),
      { ...options, pageRange: options.pageRange.trim() || undefined },
      user?.bduss ?? '',
      user?.stoken ?? '',
      resolveProxyUrl()
    );
    // 本次使用的选项回写为默认项，设置页与对话框的下一次预填保持一致。
    settings.threadSaveDefaults = { ...options };
    isSaveOpen.value = false;
    isSaving.value = true;
    sendToast?.('已开始保存', 2500);
  } catch (error) {
    sendToast?.(error instanceof Error ? error.message : String(error), 3000);
  }
};

const handleSaveEvent = (payload: ThreadSaveProgress): void => {
  if (String(payload.tid) !== String(props.tid)) return;
  if (payload.phase === 'done') {
    sendToast?.(payload.message, 3000);
    isSaving.value = false;
    void refreshArchiveMeta();
    if (props.local) void loadData(currentPage.value, true, onlyThreadAuthor.value);
  } else if (payload.phase === 'error') {
    sendToast?.(`保存失败：${payload.message}`, 4000);
    isSaving.value = false;
  } else if (payload.phase === 'cancelled') {
    sendToast?.(payload.message, 2500);
    isSaving.value = false;
  }
};

// Commit page/filter changes only after success so failures preserve the current view.
const loadData = async (page = currentPage.value, replace = false, onlyAuthor = onlyThreadAuthor.value, prepend = false): Promise<boolean> => {
  if (isThreadsLoading.value && !isLoading.value) return false;
  isThreadsLoading.value = true;
  try {
    let response: ThreadData;
    const user = userStore.currentUser;
    if (!props.local) {
      response = await api.get_post(String(props.tid), page, 30, 0, onlyAuthor, false, user?.bduss ?? '', 10, user?.stoken ?? '');
    } else {
      try {
        response = JSON.parse(await archiveReadPage(String(props.tid), page, archiveMeta.value?.onlyAuthor ?? false));
      } catch (error) {
        // 该页未归档（如保存时未包含此页 / 页码范围外）：按设置联网补取。
        if (!settings.archiveOnlineFallback) throw error;
        console.info(`第 ${page} 页未归档，联网获取`, error);
        sendToast?.(`第 ${page} 页未归档，已联网加载`, 2000);
        response = await api.get_post(String(props.tid), page, 30, 0, onlyAuthor, false, user?.bduss ?? '', 10, user?.stoken ?? '');
      }
    }
    if (response.error?.errorno) throw new Error(response.error.errmsg || '帖子加载失败');
    const data = response.data;
    if (!data || !Array.isArray(data.post_list)) throw new Error('帖子数据不可用');
    if (page > 1 && data.post_list.length === 0) {
      sendToast?.('该页没有内容', 2000);
      return false;
    }
    const { thread, forum, user_list: newUsers = [], post_list } = data;
    const users = new Map((replace ? [] : user_list.value).map(user => [String(user.id), user]));
    for (const user of newUsers) users.set(String(user.id), user);
    const posts = post_list.map(post => ({ ...post, author: users.get(String(post.author_id)) }));
    if (thread.author?.id !== undefined && String(thread.author.id) !== '0') threadAuthorId.value = String(thread.author.id);
    else {
      const firstFloor = post_list.find(post => Number(post.floor) === 1);
      if (firstFloor) threadAuthorId.value = String(firstFloor.author_id);
    }
    if (!isFavouriteLoading.value) {
      isFavourite.value = Number(thread.collect_status) === 2;
      favouritePostId.value = thread.collect_mark_pid || '';
      favouriteAccountId.value = user?.userId ?? '';
    }
    if (!prepend || replace) returnData.value = response;
    loadError.value = '';
    if (!prepend || replace) currentPage.value = page;
    if (replace) {
      firstLoadedPage.value = page;
      postPages.clear();
      activePostId.value = String(posts[0]?.id ?? '');
    } else if (prepend) firstLoadedPage.value = page;
    for (const post of posts) postPages.set(String(post.id), page);
    onlyThreadAuthor.value = onlyAuthor;
    user_list.value = [...users.values()];
    if (replace) threadList.value = posts;
    else {
      const ids = new Set(threadList.value.map(post => String(post.id)));
      const added = posts.filter(post => !ids.has(String(post.id)));
      if (prepend) threadList.value = [...added, ...threadList.value];
      else threadList.value.push(...added);
    }
    threadTitle.value = thread.title;
    updateTabMeta?.({ key: props.key_, title: thread.title, icon: forum.avatar, icon_invert: false });
    if (replace) {
      await nextTick();
      containerRef.value?.scrollToTop();
    }
    return true;
  } catch (error) {
    console.error('加载数据失败:', error);
    loadError.value = '加载失败，请重试';
    sendToast?.('加载失败，请重试', 3000);
    return false;
  } finally {
    isThreadsLoading.value = false;
  }
};

const openJump = async () => {
  jumpInput.value = String(readingPage.value);
  jumpError.value = '';
  isJumpOpen.value = true;
  await nextTick();
  pageInputRef.value?.focus();
  pageInputRef.value?.select();
};

const jumpToPage = async () => {
  const input = String(jumpInput.value).trim();
  const page = Number(input);
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(page) || page < 1 || (totalPages.value && page > totalPages.value)) {
    jumpError.value = totalPages.value ? '请输入 1～' + totalPages.value + ' 的整数页码' : '请输入大于零的整数页码';
    return;
  }
  jumpError.value = '';
  if (await loadData(page, true)) isJumpOpen.value = false;
};

const toggleOnlyAuthor = async () => {
  if (galleryOpen.value) { await toggleGalleryAuthor(); return; }
  if (props.local) {
    onlyThreadAuthor.value = !onlyThreadAuthor.value;
    galleryOnlyAuthor.value = onlyThreadAuthor.value;
    return;
  }
  if (await loadData(1, true, !onlyThreadAuthor.value)) {
    sendToast?.(onlyThreadAuthor.value ? '已切换为只看楼主' : '已显示全部回复', 2000);
  }
};

const toggleFavourite = async (cancelOnly = false) => {
  if (isFavouriteLoading.value || isThreadsLoading.value || props.local) return;
  const positionPost = activePost.value;
  isFavouriteLoading.value = true;
  try {
    const user = await getCurrentUser();
    if (!user.bduss) throw new Error('请先登录再收藏');
    if (favouriteAccountId.value !== user.userId) {
      const response = await api.get_post(String(props.tid), 1, 30, 0, false, false, user.bduss, 10, user.stoken);
      isFavourite.value = Number(response.data?.thread?.collect_status) === 2;
      favouritePostId.value = response.data?.thread?.collect_mark_pid || '';
      favouriteAccountId.value = user.userId;
    }
    const post = positionPost;
    const cancel = isFavourite.value && (cancelOnly || favouritePostId.value === String(post?.id));
    const pid = cancel && favouritePostId.value ? favouritePostId.value : String(post?.id ?? '');
    if (!pid) throw new Error('没有可收藏的楼层');
    await api.setThreadFavourite(user.bduss, user.stoken, String(props.tid), pid, cancel);
    isFavourite.value = !cancel;
    favouritePostId.value = cancel ? '' : pid;
    sendToast?.(cancel ? '已取消收藏' : '已收藏到第 ' + post?.floor + ' 楼', 2500);
  } catch (error) {
    sendToast?.(error instanceof Error ? error.message : '收藏操作失败，请重试', 3000);
  } finally {
    isFavouriteLoading.value = false;
  }
};

function setPostElement(id: string | number, element: unknown) {
  if (element instanceof HTMLElement) postElements.set(String(id), element);
  else postElements.delete(String(id));
}

function updateReadingPosition() {
  const container = containerRef.value?.getScrollElement();
  if (!container || !visibleThreadList.value.length) return;
  const anchor = container.getBoundingClientRect().top + Math.min(100, container.clientHeight * 0.2);
  const index = findReadingFloor(visibleThreadList.value.length, index =>
    postElements.get(String(visibleThreadList.value[index].id))?.getBoundingClientRect().bottom ?? Infinity, anchor);
  if (index >= 0) {
    activePostId.value = String(visibleThreadList.value[index].id);
    const element = postElements.get(activePostId.value);
    const next = postElements.get(String(visibleThreadList.value[index + 1]?.id));
    if (element) {
      const top = element.getBoundingClientRect().top;
      const bottom = next?.getBoundingClientRect().top ?? element.getBoundingClientRect().bottom;
      readingIndex.value = index + Math.max(0, Math.min(1, (anchor - top) / Math.max(1, bottom - top)));
    }
  }
}

function scheduleReadingPosition() {
  if (readingFrame) return;
  readingFrame = requestAnimationFrame(() => {
    readingFrame = 0;
    updateReadingPosition();
  });
}

const navigateToFloor = async (id: string, edge?: 'start' | 'end') => {
  if (isThreadsLoading.value || isFavouriteLoading.value || isFloorNavigating.value) return;
  isFloorNavigating.value = true;
  try {
    const index = threadList.value.findIndex(post => String(post.id) === id);
    if (edge === 'start' && index === 0 && firstLoadedPage.value > 1) {
      await loadData(firstLoadedPage.value - 1, false, onlyThreadAuthor.value, true);
    } else if (edge === 'end' && index === threadList.value.length - 1 && returnData.value.data?.page?.has_more) {
      await loadData(currentPage.value + 1);
    }
    await nextTick();
    const element = postElements.get(id);
    if (element) {
      containerRef.value?.scrollToElement(element);
      activePostId.value = id;
      floorIndexRef.value?.reveal(id, edge);
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  } finally {
    isFloorNavigating.value = false;
    scheduleReadingPosition();
  }
};

defineExpose({ navigateToFloor });
watch(() => [galleryAutoFollow.value, galleryOpen.value, selectedImage.value?.id, galleryOnlyAuthor.value, isLoading.value, isThreadsLoading.value], () => {
  const version = ++galleryFollowVersion;
  if (galleryAutoFollow.value && galleryOpen.value && !isLoading.value && !isThreadsLoading.value) {
    void followGalleryFloor(version);
  }
}, { flush: 'post' });
watch(galleryImages, images => {
  if (images.some(image => image.id === selectedImageId.value)) return;
  selectedImageId.value = images[0]?.id ?? '';
});

// Layout changes (including late-loading images) can change which floor is being read.
watch(captureRef, element => {
  contentObserver?.disconnect();
  if (!element) return;
  contentObserver = new ResizeObserver(() => { restoreLayoutAnchor(); scheduleReadingPosition(); });
  contentObserver.observe(element);
  const container = containerRef.value?.getScrollElement();
  if (container) contentObserver.observe(container);
}, { flush: 'post' });
watch(() => [threadList.value.length, isLoading.value], async () => {
  await nextTick();
  scheduleReadingPosition();
});
onMounted(async () => {
  if (viewElement.value) {
    viewWidth.value = viewElement.value.clientWidth;
    viewObserver = new ResizeObserver(() => {
      viewWidth.value = viewElement.value?.clientWidth ?? viewWidth.value;
      restoreLayoutAnchor();
    });
    viewObserver.observe(viewElement.value);
  }
  unlistenSave = await listen<ThreadSaveProgress>('thread-save-progress', event => handleSaveEvent(event.payload));
  if (props.local) {
    await refreshArchiveMeta();
    isSaving.value = await threadSaveStatus(String(props.tid)).catch(() => false);
  }
  isLoading.value = true;
  await loadData();
  isLoading.value = false;
});
onActivated(scheduleReadingPosition);
onBeforeUnmount(() => {
  contentObserver?.disconnect();
  clearTimeout(layoutTimer);
  viewObserver?.disconnect();
  cancelAnimationFrame(readingFrame);
  unlistenSave?.();
  unlistenSave = undefined;
});

// 滚动处理
const onScroll = (target: HTMLElement): void => {
  const { scrollTop, clientHeight, scrollHeight } = target;
  if (scrollTop + clientHeight + 20 >= scrollHeight) {
    if (isLoading.value || isThreadsLoading.value || isFavouriteLoading.value || isFloorNavigating.value || isJumpOpen.value || !returnData.value.data?.page?.has_more) return;
    nextPage();
  }
};

// 用户名点击
const onUserNameClicked = (uid: string | number): void => {
  emit('openUser', uid);
};

// 吧名点击
const openBar = (barName: string): void => {
  emit('openBar', barName);
};

// 下一页
const nextPage = async (): Promise<void> => {
  await loadData(currentPage.value + 1);
};

// 查看所有回复
const ViewAllReplie = (data: SubPostInfo): void => {
  currentSubPostInfo.value = data;
  isSubPostCardOpen.value = true;
};
</script>

<template>
  <div ref="viewElement" class="thread-view"
    :class="{ compact: props.compact || galleryOpen, 'gallery-open': galleryOpen, 'context-collapsed': contextCollapsed, resizing }"
    :style="{ '--context-width': contextWidth + 'px' }" @keydown.esc="isJumpOpen = false">
    <section class="gallery-stage" aria-label="帖子图片" :aria-hidden="!galleryOpen" :inert="!galleryOpen || undefined">
      <ImageViewer v-if="galleryOpen && selectedImage" :image-src="offlineResolver(selectedImage.src)"
        :fallback-src="selectedImage.src"
        :content-width="Math.max(1, viewWidth - contextWidth - 10)" visible embedded>
        <template #gallery-island>
          <div v-if="islandPost" class="gallery-island">
            <RemoteImage kind="avatars" class="island-avatar" :src="islandAvatar" :alt="islandAuthorName" />
            <span class="island-name">{{ islandAuthorName }}</span>
            <span v-if="islandTextSegments.length" class="island-text" :title="islandPlainText">
              <template v-for="(segment, index) in islandTextSegments" :key="index"><img
                  v-if="segment.type === 'emoticon'" class="island-emoticon" :src="segment.value" :alt="segment.alt"
                  referrerpolicy="no-referrer" /><template v-else>{{ segment.value }}</template></template>
            </span>
            <div v-if="islandFloorImages.length" class="island-dots" role="group" aria-label="本楼图片">
              <button v-for="(image, index) in islandFloorImages" :key="image.id" type="button" class="island-dot"
                :class="{ active: image.id === selectedImageId }" @click="selectGalleryImage(image.id)"
                :title="`第 ${image.floor} 楼 · 第 ${index + 1} 张`"
                :aria-label="`第 ${image.floor} 楼第 ${index + 1} 张，共 ${islandFloorImages.length} 张`"
                :aria-current="image.id === selectedImageId ? 'true' : undefined"></button>
            </div>
          </div>
        </template>
        <template #gallery-controls>
          <button type="button" class="gallery-button" :disabled="selectedImageIndex <= 0" @click="stepGallery(-1)"
            title="上一张" aria-label="上一张">
            <span class="material-symbols-outlined">chevron_left</span>
          </button>
          <span class="image-position" aria-live="polite">{{ selectedImageIndex + 1 }} / {{ galleryImages.length
          }}<small>第 {{ selectedImage.floor }} 楼</small></span>
          <button type="button" class="gallery-button" :disabled="galleryAtEnd && !galleryHasMore"
            @click="stepGallery(1)" :title="galleryAtEnd && galleryHasMore ? '加载下一页' : '下一张'" aria-label="下一张">
            <span class="material-symbols-outlined" :class="{ spinning: galleryAtEnd && isThreadsLoading }">{{
              galleryAtEnd && isThreadsLoading ? 'progress_activity' : 'chevron_right' }}</span>
          </button>
          <button type="button" class="gallery-button follow-toggle" @click="galleryAutoFollow = !galleryAutoFollow"
            :aria-pressed="galleryAutoFollow" :title="galleryAutoFollow ? '停止自动跟随' : '开始自动跟随'"
            :aria-label="galleryAutoFollow ? '停止自动跟随' : '开始自动跟随'">
            <span class="material-symbols-outlined">my_location</span>
          </button>
          <button type="button" class="gallery-button author-filter" :aria-pressed="galleryOnlyAuthor"
            @click="toggleGalleryAuthor()">只看楼主</button>
          <button type="button" class="gallery-button author-filter" :aria-pressed="galleryIncludeSubposts"
            @click="galleryIncludeSubposts = !galleryIncludeSubposts">包括楼中楼图片</button>
          <button type="button" class="gallery-button" @click="toggleGallery" title="退出看图模式" aria-label="退出看图模式">
            <span class="material-symbols-outlined">close</span>
          </button>
          <span class="gallery-divider" aria-hidden="true"></span>
        </template>
      </ImageViewer>
      <div v-else-if="galleryOpen" class="empty-gallery" role="status">
        <p>{{ galleryOnlyAuthor ? '楼主还没有发布图片' : '暂无图片' }}</p>
        <button v-if="galleryOnlyAuthor" type="button" @click="toggleGalleryAuthor()">查看全部图片</button>
      </div>
    </section>
    <div class="gallery-spacer" aria-hidden="true"></div>
    <div v-if="galleryOpen" class="gallery-splitter" role="separator" aria-label="调整图片与回复区域宽度"
      aria-orientation="vertical" tabindex="0" :aria-valuenow="Math.round(contextWidth)" :aria-valuemin="0"
      :aria-valuemax="Math.round(maximumPanelWidth)" @pointerdown="startResize" @pointermove="moveResize"
      @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize" @keydown="resizeWithKeyboard">
      <button type="button" class="context-toggle" :aria-label="contextCollapsed ? '展开回复区域' : '收起回复区域'"
        :title="contextCollapsed ? '展开回复区域' : '收起回复区域'" :aria-expanded="!contextCollapsed" @click.stop="toggleContext">
        <span class="material-symbols-outlined">{{ contextCollapsed ? 'chevron_left' : 'chevron_right' }}</span>
      </button>
    </div>
    <section class="thread-context" :aria-hidden="galleryOpen && contextCollapsed"
      :inert="galleryOpen && contextCollapsed || undefined">
      <Container ref="containerRef" :tab-key="props.key_" :scroll-key="`thread-${props.key_}`" @yscroll="onScroll"
        @positionchange="scheduleReadingPosition">
        <transition name="fade1">
          <div v-if="!isLoading">
            <div class="thread-list" v-if="threadList.length" ref="captureRef">
              <h3 class="thread-title">
                <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
                  <RippleButton v-if="returnData.data"
                    style="background-color: transparent; box-shadow: none; padding: 0; border-radius: 100px;"
                    @click="openBar(returnData.data.forum.name)">
                    <div
                      style="display: flex; align-items: center; gap: 10px; background-color: rgba(var(--text-color), 0.1); padding: 5px 8px;">
                      <RemoteImage :src="returnData.data.forum.avatar" class="avatar" />
                      <span style="font-size: 14px; margin-right: 5px;">{{ returnData.data.forum.name }}吧</span>
                    </div>
                  </RippleButton>
                  {{ threadTitle }}
                  <RippleButton style="padding: 4px; border-radius: 50%; background: transparent; box-shadow: none;"
                    @click="handleShare" title="生成分享卡片">
                    <span class="material-symbols-outlined" style="font-size: 20px;">share</span>
                  </RippleButton>
                  <RippleButton style="padding: 4px; border-radius: 50%; background: transparent; box-shadow: none;"
                    @click="openSaveDialog" :title="props.local ? '继续保存本帖归档' : '保存帖子'" :disabled="isSaving">
                    <span class="material-symbols-outlined" style="font-size: 20px;">{{ props.local ?
                      'content_paste_search' : 'save' }}</span>
                  </RippleButton>
                </div>
              </h3>
              <div v-for="item in visibleThreadList" :key="item.id" :ref="element => setPostElement(item.id, element)"
                class="post-anchor"
                :class="{ 'gallery-selected': galleryOpen && String(item.id) === selectedImage?.postId }">
                <Reply :embedded-images="galleryOpen" @select-image="selectReplyImage($event, String(item.id))"
                  @register-images="registerReplyImages($event, String(item.id))"
                  :forum-name="returnData.data?.forum?.name" :forum-avatar="returnData.data?.forum?.avatar"
                  :thread-title="threadTitle"
                  :thread-author="returnData.data?.thread?.author?.name_show || returnData.data?.thread?.author?.user_name || ''"
                  :thread-author-avatar="shareAvatarUrl(returnData.data?.thread?.author?.portrait)"
                  :like="Number(item.agree?.agree_num || 0) - Number(item.agree?.disagree_num || 0)"
                  :user_name="item.author?.name_show || item.author?.name || '匿名用户'" :uid="item.author_id"
                  @openUser="onUserNameClicked($event)" :avatar="item.author?.portrait || 'default'"
                  :thread_content="item.content?.length === 0 || !Array.isArray(item.content) ? [{ type: 0, text: threadTitle }] : item.content"
                  :create_time="item.time" :reply_num="Number(item.sub_post_number || 0)" :tid="String(tid)"
                  :pid="String(item.id)" :floor="item.floor" :is_lz="String(item.author_id) === threadAuthorId"
                  :level="item.author?.level_id || 0" :ip_address="item.author?.ip_address || ''" :local="props.local"
                  @viewAllReplies="ViewAllReplie">
                </Reply>
              </div>
            </div>

          </div>
        </transition>
        <Teleport to="body">
          <Transition name="subpost-modal">
            <div v-if="isSubPostCardOpen && tabStore.activeKey === String(props.key_)" class="subpost-overlay"
              @click.self="isSubPostCardOpen = false">
              <Transition name="subpost-card" appear>
                <section v-if="isSubPostCardOpen" class="subpost-card" role="dialog" aria-modal="true"
                  aria-label="查看楼中楼" @click.stop>
                  <div class="subpost-card-header">
                    <span>查看楼中楼</span>
                    <RippleButton class="subpost-card-close" @click="isSubPostCardOpen = false" aria-label="关闭楼中楼">
                      <img src="/assets/close.svg" alt="" />
                    </RippleButton>
                  </div>
                  <div class="subpost-card-content">
                    <ReplyView :key="`${currentSubPostInfo.tid}-${currentSubPostInfo.pid}`" v-bind="currentSubPostInfo"
                      :forum-name="returnData.data?.forum?.name" :forum-avatar="returnData.data?.forum?.avatar"
                      :thread-title="threadTitle"
                      :thread-author="returnData.data?.thread?.author?.name_show || returnData.data?.thread?.author?.user_name || ''"
                      :thread-author-avatar="shareAvatarUrl(returnData.data?.thread?.author?.portrait)"
                      @openUser="onUserNameClicked($event)"></ReplyView>
                  </div>
                </section>
              </Transition>
            </div>
          </Transition>
        </Teleport>
        <transition name="fade1">
          <div v-if="loadError && !threadList.length" style="width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; border-radius: 5px;
          justify-content: center; text-align: center; display: flex; flex-direction: column; align-items: center;
          opacity: 0.5; gap: 10px;">
            <div style="font-size: 150%; font-weight: bold;">{{ loadError }}</div>
            <RippleButton :disabled="isThreadsLoading" @click="loadData(currentPage, true)">重试</RippleButton>
          </div>
        </transition>
        <transition name="fade1">
          <Loading class="loading-box" v-if="isThreadsLoading"></Loading>
        </transition>
      </Container>
      <ThreadFloorIndex v-if="threadList.length && !isLoading" ref="floorIndexRef" :entries="floorEntries"
        :current-id="activePostId" :reading-index="readingIndex" :reading-page="readingPage" :total-pages="totalPages"
        :busy="isThreadsLoading || isFavouriteLoading || isFloorNavigating" :local="props.local"
        :gallery-active="galleryOpen" :only-author="galleryOpen ? galleryOnlyAuthor : onlyThreadAuthor"
        :favourite="isFavourite" :favourite-here="isFavourite && favouritePostId === activePostId"
        @gallery="toggleGallery" @navigate="navigateToFloor" @jump="openJump" @only-author="toggleOnlyAuthor"
        @bookmark="toggleFavourite()" @remove-bookmark="toggleFavourite(true)" />
      <Transition name="fade">
        <div v-if="isJumpOpen" class="jump-overlay" @click.self="!isThreadsLoading && (isJumpOpen = false)">
          <section class="jump-card" role="dialog" aria-modal="true" :aria-labelledby="'jump-title-' + props.key_">
            <form @submit.prevent="jumpToPage">
              <h3 :id="'jump-title-' + props.key_">跳转到指定页</h3>
              <p>当前第 {{ readingPage }} 页<span v-if="totalPages">，共 {{ totalPages }} 页</span></p>
              <label :for="'thread-page-input-' + props.key_">页码</label>
              <input :id="'thread-page-input-' + props.key_" ref="pageInputRef" v-model="jumpInput" type="text"
                inputmode="numeric" :disabled="isThreadsLoading" autocomplete="off" :aria-invalid="Boolean(jumpError)"
                :aria-describedby="'jump-error-' + props.key_" />
              <p :id="'jump-error-' + props.key_" class="jump-error" aria-live="polite">{{ jumpError }}</p>
              <div class="jump-buttons">
                <RippleButton type="button" :disabled="isThreadsLoading" @click="isJumpOpen = false">取消</RippleButton>
                <RippleButton type="submit" :disabled="isThreadsLoading">{{ isThreadsLoading ? '加载中…' : '跳转' }}
                </RippleButton>
              </div>
            </form>
          </section>
        </div>
      </Transition>
      <ThreadSaveDialog v-model:open="isSaveOpen" :title="props.local ? '继续保存本帖归档' : '保存帖子'"
        :archive-meta="archiveMeta" :busy="isSaving" @start="startSave" />
    </section>
  </div>
</template>

<style scoped>
.thread-view {
  display: flex;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.thread-context {
  flex: 1;
  position: relative;
  min-width: 0;
  min-height: 0;
}

.gallery-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: 0;
  border-radius: 5px 0 0 0;
  transform: translateX(-24px);
  transition: opacity .24s ease, transform .24s ease;
  z-index: 0;
}

.gallery-open .gallery-stage {
  opacity: 1;
  transform: translateX(0);
}

.gallery-spacer {
  flex: 0 0 0;
  min-width: 0;
  pointer-events: none;
  transition: flex-basis .24s ease;
}

.gallery-open .gallery-spacer {
  flex-basis: calc(100% - var(--context-width) - 10px);
}

.resizing .gallery-spacer {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .gallery-spacer {
    transition: none;
  }
}

.gallery-open .thread-context {
  z-index: 1;
  overflow: hidden;
  margin: 10px 0;
  margin-right: 10px;
  border-radius: 5px;
  box-shadow: 0 16px 22px rgba(0, 0, 0, 0.25);
  /* 不定义backdrop-filter反而能在chrome上正常显示，因此只对safari做单独兼容 */
  /* -webkit-backdrop-filter: blur(32px) saturate(1.15); */
}

/* Keep glass on a sibling layer so the index can sample the replies above it. */
.gallery-open .thread-context::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  background: rgba(var(--background-color), .38);
  backdrop-filter: blur(32px) saturate(1.15);
  -webkit-backdrop-filter: blur(32px) saturate(1.15);
}

.gallery-open .thread-context :deep(.component-container) {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  padding-right: 48px;
}

.context-collapsed.gallery-open .thread-context {
  visibility: hidden;
}

.resizing {
  user-select: none;
  cursor: col-resize;
}

.resizing .gallery-stage {
  transition: none;
}

.gallery-splitter {
  flex: 0 0 10px;
  position: relative;
  cursor: col-resize;
  touch-action: none;
  z-index: 25;
}

.gallery-splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 2px;
}

.gallery-splitter:hover::before,
.gallery-splitter:focus-visible::before {
  background: rgb(var(--primary-color));
}

.context-toggle {
  position: absolute;
  top: 16px;
  left: -10px;
  width: 30px;
  height: 36px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(var(--text-color), .15);
  border-radius: 8px;
  background: rgb(var(--background-color));
  color: rgb(var(--text-color));
  box-shadow: none;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s ease;
}

.gallery-splitter:hover .context-toggle,
.gallery-splitter:focus-within .context-toggle {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .context-toggle {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .context-toggle {
    transition: none;
  }
}

.context-collapsed .context-toggle {
  left: -20px;
}

.context-toggle:focus-visible {
  outline: 2px solid rgb(var(--primary-color));
}

@media (prefers-reduced-motion: reduce) {
  .gallery-stage {
    transition: none;
  }
}

.gallery-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  min-height: 28px;
  box-sizing: border-box;
  padding: 4px 6px;
  font-size: 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--text-color));
  cursor: pointer;
  box-shadow: none;
  white-space: nowrap;
}

.gallery-button:hover {
  background: rgba(var(--text-color), .12);
}

.gallery-button:disabled {
  opacity: .35;
  cursor: default;
}

.gallery-button:focus-visible {
  outline: 2px solid rgb(var(--primary-color));
  outline-offset: 2px;
}

.follow-toggle[aria-pressed="true"],
.author-filter[aria-pressed="true"] {
  background: rgba(var(--primary-color), .3);
}

.image-position {
  text-align: center;
  min-width: 60px;
  font-size: 11px;
}

.image-position small {
  display: block;
  margin-top: 0;
  line-height: 12px;
  font-size: 9px;
  opacity: .6;
}

.gallery-island {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: min(560px, calc(100vw - 48px));
}

.island-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.island-avatar + .island-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.island-name {
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  white-space: nowrap;
  flex-shrink: 0;
}

.island-text {
  font-size: 12px;
  line-height: 22px;
  opacity: .65;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.island-emoticon {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  object-fit: contain;
}

.island-dots {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  margin-left: 2px;
  padding-left: 9px;
  border-left: 1px solid rgba(var(--text-color), .15);
}

.island-dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(var(--text-color), .28);
  cursor: pointer;
  flex-shrink: 0;
  transition: width .25s cubic-bezier(.4, 0, .2, 1), background-color .25s ease, transform .15s ease;
}

.island-dot:hover {
  transform: scale(1.4);
}

.island-dot.active {
  width: 16px;
  background: rgb(var(--primary-color));
}

.island-dot:focus-visible {
  outline: 2px solid rgb(var(--primary-color));
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .island-dot {
    transition: none;
  }
}

.gallery-divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: rgba(var(--text-color), .2);
}

.gallery-button .material-symbols-outlined {
  font-size: 18px;
}

.gallery-button .material-symbols-outlined.spinning {
  animation: gallery-spin .9s linear infinite;
}

@keyframes gallery-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gallery-button .material-symbols-outlined.spinning {
    animation: none;
  }
}

.empty-gallery {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: .65;
}

.compact .thread-title {
  width: 100%;
  font-size: 16px;
}

.compact .thread-title>div {
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}

.compact .thread-list {
  padding: 6px 12px;
}

.compact :deep(.thread) {
  width: 100%;
  min-width: 0;
}

.compact :deep(.thread-content) {
  overflow-wrap: anywhere;
}

.compact :deep(.thread-reply-img) {
  max-width: 100% !important;
  height: auto;
}

.compact :deep(.thread-info) {
  flex-wrap: wrap;
}

.gallery-selected {
  border-radius: 8px;
  background: rgba(var(--primary-color), 0.05);
}

.post-anchor {
  width: 100%;
  display: flex;
  justify-content: center;
}

.jump-card button:disabled {
  opacity: 0.45;
  cursor: default;
}

.jump-card button:focus-visible {
  outline: 2px solid rgb(var(--primary-color));
  outline-offset: 3px;
}

.jump-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  /* background: rgba(0, 0, 0, 0.4); */
}

.jump-card {
  width: min(360px, 100%);
  padding: 24px;
  border-radius: 16px;
  background: rgb(var(--background-color));
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
}

.jump-card h3 {
  margin: 0 0 12px;
}

.jump-card p {
  font-size: 13px;
  opacity: 0.7;
}

.jump-card label {
  display: block;
  margin-bottom: 8px;
}

.jump-card input {
  box-sizing: border-box;
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--text-color), 0.25);
  background: rgba(var(--text-color), 0.05);
  color: rgb(var(--text-color));
  font: inherit;
}

.jump-error {
  min-height: 18px;
}

.jump-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.jump-buttons button {
  padding: 10px 18px;
}

.jump-buttons button[type="submit"] {
  background: rgba(var(--primary-color), 0.3);
}

.subpost-overlay {
  position: fixed;
  inset: 0;
  /* Keep the comment dialog above the app tabs and custom titlebar. */
  z-index: 3200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.4);
}

.subpost-card {
  width: 600px;
  max-width: 100%;
  height: 88vh;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(var(--background-color), 1);
  border: 1px solid rgba(var(--text-color), 0.1);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.15);
}

.subpost-card-header {
  flex-shrink: 0;
  height: 50px;
  padding-left: 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: rgba(var(--text-color), 1);
}

.subpost-card-close {
  width: 46px;
  height: 46px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}

.subpost-card-close img {
  width: 20px;
  height: 20px;
  opacity: 0.7;
  filter: invert(var(--invert));
}

.subpost-card-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.subpost-modal-enter-active,
.subpost-modal-leave-active {
  transition: opacity 0.3s ease;
}

.subpost-modal-enter-from,
.subpost-modal-leave-to {
  opacity: 0;
}

.subpost-card-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.subpost-card-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(20px);
}

.thread-title {
  width: 80%;
  height: fit-content;
  margin-top: 0;
  margin-bottom: 10px;
}

.avatar {
  width: 24px;
  border-radius: 32px;
}

.thread-filter {
  width: 80%;
}

.thread-list {
  padding: 10px;
  padding-bottom: 24px;
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
  border-radius: 10px;
}

.bar-banner {
  width: 100%;
  height: 200px;
  position: relative;
}
</style>
