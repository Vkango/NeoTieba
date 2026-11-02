import { createApp, reactive } from "vue";
import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import App from "@/App.vue";
import { errorService, formatReport } from "@/core/error-service";
import { error as logError } from '@tauri-apps/plugin-log';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import pluginManager from '@/plugin/plugin-manager';
import { clipboardService } from "@/services/clipboard-service";
// 图标字体随应用打包（原因见 global.css 的 .material-symbols-outlined）。
// 需在 global.css 之前导入：那里声明的 font-family 依赖此处的 @font-face。
import '@fontsource/material-symbols-outlined/400.css';
import "@/styles/global.css";
import { applyTheme, getStoredTheme } from "@/styles/theme";

applyTheme(getStoredTheme());

// Native macOS traffic lights occupy the upper-left titlebar area.
// Mark the document so the app chrome can reserve that space without
// changing the layout on other platforms.
const isMacOS = /Macintosh|Mac OS X/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform);
document.documentElement.classList.toggle('macos', isMacOS);

const appWindow = getCurrentWindow();
appWindow.onFocusChanged(async ({ payload: focused }) => {
    if (focused) {
        try {
const text = await readText();
        if (text) {
            clipboardService.handle(text);
        }
        } catch (error) {
            // console.error("Failed to read clipboard:", error);
        }
    }
});

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

// Persist every captured error into the shared log file (same file as Rust logs).
errorService.addHandler(async (report) => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    try {
        await logError(formatReport(report));
    } catch (e) {
        console.error('Failed to write error log:', e);
    }
});

// Catch errors outside Vue rendering: async callbacks and rejected promises.
// ResizeObserver 的“loop completed with undelivered notifications”是浏览器在同一帧内
// 观察目标尺寸被回调再次改动时的提示，下一帧会补发通知，不是真实错误，不进错误报告。
const isResizeObserverLoopNotice = (message: unknown): boolean =>
    typeof message === 'string' && message.startsWith('ResizeObserver loop');
window.addEventListener('error', (event) => {
    if (isResizeObserverLoopNotice(event.message)) return;
    errorService.handleError(event.error ?? event.message, undefined, 'window');
});
window.addEventListener('unhandledrejection', (event) => {
    errorService.handleError(event.reason, undefined, 'unhandledrejection');
});

const app = createApp(App);

// 使用Pinia
app.use(pinia);

app.config.errorHandler = (err, _instance, info) => {
    errorService.handleError(err, info, 'vue');
    console.error(err);
};

const IsDrawerOpen = reactive({ state: false });
app.config.globalProperties.$IsDrawerOpen = IsDrawerOpen;
app.config.globalProperties.$pluginManager = pluginManager;
// Decorum 1.1.1 starts observing childList changes in DOMContentLoaded,
// but does not create controls until it sees a mutation. Mount Vue in the
// next task after all DOMContentLoaded listeners have run, so the initial
// render (including the titlebar Teleport) reliably triggers that observer.
function scheduleMount(): void {
    setTimeout(() => app.mount("#app"), 0);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleMount, { once: true });
} else {
    scheduleMount();
}
