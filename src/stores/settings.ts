import { normalizeMediaBlocks, mediaBlocked, type MediaKind } from '@/utils/settings-policy';
import { computed } from 'vue';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { applyTheme as applyThemeMode, onSystemThemeChange, persistTheme, setAccentSource, setGlobalAccentPair, accentPairFromSeed, type AccentMode } from '@/styles/theme';
import { extractAccentPair } from '@/utils/color-extract';
import { HOTKEY_ACTION_MAP, type Combo } from '@/core/hotkeys';

function guessMime(path: string): string {
    const lower = path.toLowerCase();
    const dot = lower.lastIndexOf('.');
    if (dot === -1) return 'image/jpeg';
    const ext = lower.slice(dot);
    const map: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif', '.avif': 'image/avif',
    };
    return map[ext] || 'image/jpeg';
}

export type WallpaperEffect = 'image' | 'acrylic' | 'mica' | 'solid';
export const WALLPAPER_EFFECT_OPTIONS: Array<{ label: string; value: WallpaperEffect }> = [
  { label: '图片', value: 'image' },
  { label: 'Acrylic（亚克力）', value: 'acrylic' },
  { label: 'Mica（云母）', value: 'mica' },
  { label: '纯色', value: 'solid' },
];

export const GLOBAL_FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '默认', value: '' },
  { label: '系统 UI 字体', value: 'system-ui' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '苹方', value: 'PingFang SC' },
  { label: '宋体', value: 'SimSun' },
  { label: '黑体', value: 'SimHei' },
  { label: '楷体', value: 'KaiTi' },
  { label: '仿宋', value: 'FangSong' },
  { label: '等线', value: 'DengXian' },
];

const DEFAULT_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

function cssFontName(name: string): string {
    return /^[-a-zA-Z0-9]+$/.test(name) ? name : `'${name.replace(/['\\]/g, '').trim()}'`;
}

export function applyGlobalFont(font: string): void {
    const root = document.documentElement;
    const trimmed = (font || '').trim();
    if (!trimmed) {
        root.style.removeProperty('font-family');
        return;
    }
    root.style.fontFamily = `${cssFontName(trimmed)}, ${DEFAULT_FONT_STACK}`;
}

/** 预先编辑的帖子保存默认选项（保存对话框每次打开时以此为初值）。 */
export interface ThreadSaveDefaults {
    onlyAuthor: boolean;
    saveImages: boolean;
    saveVideoAudio: boolean;
    saveSubposts: boolean;
    saveAvatars: boolean;
    pageRange: string;
    /** 页面拉取并发数（1 = 串行）。 */
    pageConcurrency: number;
    /** 楼中楼拉取并发数（1 = 串行）。 */
    floorConcurrency: number;
    /** 媒体下载并发数（1 = 串行）。 */
    mediaConcurrency: number;
    /** 网络请求失败重试次数。 */
    retryCount: number;
}

export function defaultThreadSaveDefaults(): ThreadSaveDefaults {
    return {
        onlyAuthor: false,
        saveImages: true,
        saveVideoAudio: false,
        saveSubposts: false,
        saveAvatars: false,
        pageRange: '',
        pageConcurrency: 2,
        floorConcurrency: 3,
        mediaConcurrency: 4,
        retryCount: 2,
    };
}

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

/** 规范化快捷键覆盖表：仅保留已注册动作的键位数组，过滤非法条目。 */
export function normalizeHotkeyOverrides(value: unknown): Record<string, Combo[]> {
    const result: Record<string, Combo[]> = {};
    if (!value || typeof value !== 'object') return result;
    for (const [id, combos] of Object.entries(value as Record<string, unknown>)) {
        if (!HOTKEY_ACTION_MAP.has(id) || !Array.isArray(combos)) continue;
        result[id] = combos.filter((combo): combo is Combo => typeof combo === 'string' && combo.length > 0);
    }
    return result;
}

export function normalizeThreadSaveDefaults(value: Partial<ThreadSaveDefaults> | null | undefined): ThreadSaveDefaults {
    const base = defaultThreadSaveDefaults();
    if (!value || typeof value !== 'object') return base;
    return {
        onlyAuthor: Boolean(value.onlyAuthor),
        saveImages: value.saveImages === undefined ? base.saveImages : Boolean(value.saveImages),
        saveVideoAudio: Boolean(value.saveVideoAudio),
        saveSubposts: Boolean(value.saveSubposts),
        saveAvatars: Boolean(value.saveAvatars),
        pageRange: typeof value.pageRange === 'string' ? value.pageRange : '',
        pageConcurrency: clampInt(value.pageConcurrency, base.pageConcurrency, 1, 8),
        floorConcurrency: clampInt(value.floorConcurrency, base.floorConcurrency, 1, 8),
        mediaConcurrency: clampInt(value.mediaConcurrency, base.mediaConcurrency, 1, 16),
        retryCount: clampInt(value.retryCount, base.retryCount, 0, 5),
    };
}

const isMacOS = typeof navigator !== 'undefined'
    && (/Macintosh|Mac OS X/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform));

export const useSettingsStore = defineStore('settings', () => {
    const showUserId = ref(false);
    const onlyAuthor = ref(false);
    const noImage = ref(false);
    const mediaBlocks = ref(normalizeMediaBlocks());
    const settingsError = ref('');
    const wallpaperBusy = ref(false);
    const mediaPolicy = computed(() => normalizeMediaBlocks(mediaBlocks.value));
    function isMediaBlocked(kind: MediaKind): boolean { return mediaBlocked(noImage.value, mediaPolicy.value, kind); }
    const theme = ref<'auto' | 'light' | 'dark'>('auto');
    const globalFont = ref('');
    const accentMode = ref<AccentMode>('forum');
    const customAccentColor = ref('#3b82f6');
    const wallpaperPath = ref<string>('');
    const wallpaperUrl = ref<string>('');
    const wallpaperAccent = ref(0);
    const wallpaperBlur = ref(0);
    const wallpaperEffect = ref<WallpaperEffect>('image');
    const wallpaperSolidColor = ref('#1e1f20');
    const useProxy = ref(false);
    const proxyUrl = ref('');
    const enableAutoSign = ref(false);
    const blockList = ref<string[]>([]);
    const threadSaveDefaults = ref<ThreadSaveDefaults>(defaultThreadSaveDefaults());
    const archiveOnlineFallback = ref(true);
    /** 全局键盘控制总开关 */
    const keyboardEnabled = ref(true);
    /** 键位覆盖表：动作 id → 生效键位（整体替换默认值；空数组 = 禁用该动作） */
    const hotkeyOverrides = ref<Record<string, Combo[]>>({});
    function updateDisplaySetting(key: string, value: any) {
        switch (key) {
            case 'show_user_id':
                showUserId.value = value;
                break;
            case 'only_author':
                onlyAuthor.value = value;
                break;
            case 'no_image':
                noImage.value = value;
                break;
            case 'theme':
                theme.value = value;
                break;
            case 'global_font':
                globalFont.value = String(value ?? '').trim();
                break;
            case 'accent_mode':
                accentMode.value = value as AccentMode;
                if (accentMode.value === 'custom') {
                    setGlobalAccentPair(accentPairFromSeed(customAccentColor.value));
                } else if (accentMode.value === 'wallpaper') {
                    void syncWallpaperAccent();
                } else {
                    setGlobalAccentPair(null);
                }
                setAccentSource(accentMode.value);
                break;
            case 'custom_accent_color':
                customAccentColor.value = String(value);
                if (accentMode.value === 'custom') setGlobalAccentPair(accentPairFromSeed(customAccentColor.value));
                break;
            case 'wallpaper_path':
                wallpaperPath.value = value;
                break;
            case 'wallpaper_accent':
                wallpaperAccent.value = Math.max(0, Math.min(100, Number(value) || 0));
                break;
            case 'wallpaper_blur':
                wallpaperBlur.value = Math.max(0, Math.min(200, Number(value) || 0));
                break;
            case 'wallpaper_effect':
                setWallpaperEffect(value as WallpaperEffect);
                break;
            case 'wallpaper_solid_color':
                wallpaperSolidColor.value = String(value);
                break;
            case 'keyboard_enabled':
                keyboardEnabled.value = Boolean(value);
                break;
        }
    }

    async function applyWallpaperEffect(effect: WallpaperEffect): Promise<void> {
        await invoke('set_wallpaper_effect', { effect, dark: document.documentElement.classList.contains('dark') });
    }
    async function setWallpaperEffect(effect: WallpaperEffect): Promise<void> {
        if (wallpaperBusy.value) return;
        if (isMacOS && effect === 'mica') effect = 'image';
        wallpaperBusy.value = true;
        settingsError.value = '';
        try { await applyWallpaperEffect(effect); wallpaperEffect.value = effect; }
        catch (error) {
            try { await applyWallpaperEffect(wallpaperEffect.value); } catch { /* Preserve original failure. */ }
            settingsError.value = `应用背景失败: ${String(error)}`;
        }
        finally { wallpaperBusy.value = false; }
    }

    let wallpaperGeneration = 0;
    async function loadWallpaperUrl(): Promise<void> {
        const generation = ++wallpaperGeneration;
        const path = wallpaperPath.value;
        if (!wallpaperPath.value) {
            wallpaperUrl.value = '';
            return;
        }

        if (wallpaperUrl.value.startsWith('blob:')) {
            URL.revokeObjectURL(wallpaperUrl.value);
        }
        try {
            const bytes: number[] = await invoke('read_file_bytes', { path });
            if (generation !== wallpaperGeneration || path !== wallpaperPath.value) return;
            const blob = new Blob([new Uint8Array(bytes)], { type: guessMime(wallpaperPath.value) });
            wallpaperUrl.value = URL.createObjectURL(blob);
        } catch (error) {
            if (generation !== wallpaperGeneration) return;
            settingsError.value = '壁纸文件无法读取，请重新选择图片';
            console.error('读取壁纸文件失败:', error);
            wallpaperUrl.value = '';
        }
    }

    function initWallpaper(): void {
        void loadWallpaperUrl();
    }

    async function syncWallpaperAccent(): Promise<void> {
        if (accentMode.value !== 'wallpaper') return;
        try {
            if (wallpaperEffect.value === 'image' && wallpaperUrl.value) {
                const pair = await extractAccentPair(wallpaperUrl.value);
                if (accentMode.value === 'wallpaper') setGlobalAccentPair(pair);
            } else if (wallpaperEffect.value === 'solid') {
                setGlobalAccentPair(accentPairFromSeed(wallpaperSolidColor.value));
            } else {
                setGlobalAccentPair(null);
            }
        } catch {
            /* 保持当前主题色不变 */
        }
    }

    async function pickWallpaper(): Promise<string> {
        let selected: string | string[] | null = null;
        try {
            selected = await open({
                multiple: false,
                directory: false,
                title: '选择壁纸图片',
                filters: [
                    { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'] },
                ],
            });
        } catch (error) {
            throw new Error(`打开壁纸选择对话框失败: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (!selected || (Array.isArray(selected) && selected.length === 0)) {
            return '';
        }

        const filePath = Array.isArray(selected) ? selected[0] : selected;
        const fileName = filePath.split(/[\\/]/).pop() || 'wallpaper.jpg';
        const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.jpg';
        const destination = `wallpaper_${Date.now()}${ext}`;

        try {
            const realPath: string = await invoke('copy_file_to_install_dir', { src: filePath, fileName: destination });
            wallpaperPath.value = realPath;
            await setWallpaperEffect('image');
        } catch (error) {
            throw new Error(`复制壁纸文件失败: ${error instanceof Error ? error.message : String(error)}`);
        }

        await loadWallpaperUrl();
        return wallpaperPath.value;
    }

    function removeWallpaper(): void {
        wallpaperGeneration++;
        wallpaperPath.value = '';
        if (wallpaperUrl.value.startsWith('blob:')) {
            URL.revokeObjectURL(wallpaperUrl.value);
        }
        wallpaperUrl.value = '';
        wallpaperAccent.value = 0;
    }

    function updateNetworkSetting(key: string, value: any) {
        switch (key) {
            case 'use_proxy':
                useProxy.value = value;
                break;
            case 'proxy_url':
                proxyUrl.value = value;
                break;
        }
    }

    let systemThemeUnsubscribe: (() => void) | null = null;

    function applyTheme(themeValue: string) {
        applyThemeMode(themeValue as 'auto' | 'light' | 'dark');
        if (wallpaperEffect.value === 'acrylic' || wallpaperEffect.value === 'mica') {
            void applyWallpaperEffect(wallpaperEffect.value).catch(error => { settingsError.value = `应用背景失败: ${String(error)}`; });
        }
        persistTheme(themeValue as 'auto' | 'light' | 'dark');
        if (systemThemeUnsubscribe) {
            systemThemeUnsubscribe();
            systemThemeUnsubscribe = null;
        }
        if (themeValue === 'auto') {
            systemThemeUnsubscribe = onSystemThemeChange(() => {
                if (theme.value === 'auto') {
                    applyTheme('auto');
                }
            });
        }
    }

    watch(theme, (value) => {
        applyTheme(value);
    }, { flush: 'sync' });

    watch(globalFont, (value) => {
        applyGlobalFont(value);
    }, { flush: 'sync' });

    watch(wallpaperEffect, (value) => {
        if (isMacOS && value === 'mica') {
            wallpaperEffect.value = 'image';
        }
    }, { flush: 'sync' });

    watch([wallpaperUrl, wallpaperEffect, wallpaperSolidColor], () => {
        void syncWallpaperAccent();
    });

    function addToBlockList(item: string) {
        if (!blockList.value.includes(item)) {
            blockList.value.push(item);
        }
    }

    function removeFromBlockList(item: string) {
        const index = blockList.value.indexOf(item);
        if (index > -1) {
            blockList.value.splice(index, 1);
        }
    }

    return {
        // 显示设置
        showUserId,
        onlyAuthor,
        noImage, mediaBlocks, mediaPolicy, isMediaBlocked, settingsError, wallpaperBusy,
        theme,
        globalFont,
        accentMode, customAccentColor,
        // 壁纸设置
        wallpaperPath,
        wallpaperUrl,
        wallpaperAccent,
        wallpaperBlur,
        wallpaperEffect,
        wallpaperSolidColor,
        // 网络设置
        useProxy,
        proxyUrl,
        // 插件设置
        enableAutoSign,
        blockList,
        // 帖子保存
        threadSaveDefaults,
        archiveOnlineFallback,
        // 键盘控制
        keyboardEnabled,
        hotkeyOverrides,
        // Actions
        updateDisplaySetting,
        updateNetworkSetting,
        addToBlockList,
        removeFromBlockList,
        applyTheme,
        applyWallpaperEffect,
        setWallpaperEffect,
        pickWallpaper,
        removeWallpaper,
        initWallpaper,
        loadWallpaperUrl,
        syncWallpaperAccent,
    };
}, {
    persist: {
        storage: localStorage,
        afterHydrate: ({ store }) => {
            store.mediaBlocks = normalizeMediaBlocks(store.mediaBlocks);
            store.threadSaveDefaults = normalizeThreadSaveDefaults(store.threadSaveDefaults);
            store.hotkeyOverrides = normalizeHotkeyOverrides(store.hotkeyOverrides);
            store.applyTheme(store.theme);
            applyGlobalFont(store.globalFont);
            if (store.accentMode === 'custom') setGlobalAccentPair(accentPairFromSeed(store.customAccentColor));
            setAccentSource(store.accentMode);
            void store.syncWallpaperAccent();
        },

        pick: [
            'showUserId', 'onlyAuthor', 'noImage', 'mediaBlocks', 'theme', 'globalFont', 'accentMode', 'customAccentColor',
            'wallpaperPath', 'wallpaperAccent', 'wallpaperBlur', 'wallpaperEffect', 'wallpaperSolidColor',
            'useProxy', 'proxyUrl', 'enableAutoSign', 'blockList',
            'threadSaveDefaults', 'archiveOnlineFallback',
            'keyboardEnabled', 'hotkeyOverrides',
        ],
    },
});
