<template>
    <Teleport to="body">
    <Transition name="modal" appear>
        <div v-if="visible" class="modal-overlay" @click="handleOverlayClick">
                <div v-if="visible" class="user-card" @click.stop>
                    <RippleButton class="close-button" @click="$emit('close')">
                        <img src="/assets/close.svg" />
                    </RippleButton>

                    <div class="card-content">
                        <!-- 主视图 -->
                        <Transition name="slide-left" mode="out-in">
                            <div v-if="currentView === 'main'" class="main-view" key="main">
                                <!-- 左侧宣传图 -->
                                <div class="promo-section">
                                    <div class="promo-content">
                                        <img src="/assets/spa.svg" class="promo-icon" />
                                        <h2>欢迎回来</h2>
                                        <p>吾等在此，静候君归</p>
                                    </div>
                                </div>

                                <!-- 右侧用户列表和操作 -->
                                <div class="manage-section">
                                    <!-- 用户列表 -->
                                    <div class="user-list-container">
                                        <h3>账号列表</h3>
                                        <div class="user-list" v-if="user_list.length > 0">
                                            <div v-for="user in user_list" :key="user.username" class="user-item"
                                                :class="{ active: user.current }" @click="switchUser(user)">
                                                <RemoteImage kind="avatars" :src="user.avatar" class="user-avatar"
                                                    referrerpolicy="no-referrer" />
                                                <div class="user-info">
                                                    <div class="user-name">{{ user.user_name }}</div>
                                                    <div class="user-status">{{ user.current ? '当前账号' : '已登录' }}</div>
                                                </div>
                                                <RippleButton class="delete-btn" @click.stop="confirmDelete(user)">
                                                    <span class="material-symbols-outlined">delete</span>
                                                </RippleButton>
                                            </div>

                                            <!-- 隐私模式选项 -->
                                            <div class="user-item privacy-mode" :class="{ active: isPrivacyMode }"
                                                @click="enablePrivacyMode">
                                                <div class="privacy-icon">
                                                    <span class="material-symbols-outlined">shield</span>
                                                </div>
                                                <div class="user-info">
                                                    <div class="user-name">隐私模式</div>
                                                    <div class="user-status">匿名浏览，不登录任何账号</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div v-else class="no-users">
                                            <span class="material-symbols-outlined">person_off</span>
                                            <p>暂无登录账号</p>
                                            <p class="hint">请使用下方按钮登录</p>
                                        </div>
                                    </div>

                                    <!-- 操作按钮 -->
                                    <div class="action-buttons">
                                        <RippleButton class="filter-button" @click="qrLogin"
                                            style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: right;">
                                            <div style="display: flex; gap: 10px; align-items: center;">
                                                <span class="material-symbols-outlined">qr_code_scanner</span>
                                                <span>扫码登录</span>
                                            </div>
                                        </RippleButton>

                                        <RippleButton class="filter-button" @click="showCookieDialog = true"
                                            style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: right;">
                                            <div style="display: flex; gap: 10px; align-items: center;">
                                                <span class="material-symbols-outlined">cookie</span>
                                                <span>Cookie登录</span>
                                            </div>
                                        </RippleButton>

                                        <RippleButton class="filter-button" @click="browserLogin"
                                            style="background-color: transparent; box-shadow: none; padding: 5px 10px; justify-self: right;">
                                            <div style="display: flex; gap: 10px; align-items: center;">
                                                <span class="material-symbols-outlined">public</span>
                                                <span>浏览器登录</span>
                                            </div>
                                        </RippleButton>

                                    </div>
                                </div>
                            </div>

                            <!-- 二维码登录视图 -->
                            <div v-else-if="currentView === 'qr'" class="qr-view" key="qr">
                                <QRLoginPanel :active="currentView === 'qr'" @back="backToMain"
                                    @success="handleQRLoginSuccess" />
                            </div>
                        </Transition>
                    </div>
                </div>

            <!-- Cookie 登录弹窗 -->
            <Teleport to="body">
            <Transition name="modal">
                <div v-if="showCookieDialog" class="cookie-dialog-overlay" @click.self.stop="showCookieDialog = false">
                    <div class="cookie-dialog" @click.stop>
                        <h3>Cookie 登录</h3>
                        <p class="dialog-hint">请输入 BDUSS 与 STOKEN 以进行登录, 或者直接将 Cookies 粘贴到下面的 Cookies 一栏自动分割</p>

                        <div class="input-group">
                            <label>BDUSS</label>
                            <input v-model="cookieForm.bduss" type="text" placeholder="请输入 BDUSS"
                                class="cookie-input" />
                        </div>

                        <div class="input-group">
                            <label>STOKEN</label>
                            <input v-model="cookieForm.stoken" type="text" placeholder="请输入 STOKEN"
                                class="cookie-input" />
                        </div>

                        <div class="input-group">
                            <label>Cookies（粘贴后自动分割）</label>
                            <textarea v-model="cookieForm.cookies" class="cookie-input cookie-paste-input" rows="3"
                                placeholder="粘贴完整 Cookies，自动提取 BDUSS 和 STOKEN"
                                @input="parseCookieInput" />
                        </div>

                        <div class="dialog-actions">
                            <RippleButton class="dialog-btn cancel" @click="showCookieDialog = false">
                                取消
                            </RippleButton>
                            <RippleButton class="dialog-btn confirm" @click="cookieLogin">
                                登录
                            </RippleButton>
                        </div>
                    </div>
                </div>
            </Transition>
            </Teleport>

            <!-- 确认删除弹窗 -->
            <Teleport to="body">
            <Transition name="modal">
                <div v-if="deleteConfirmUser" class="cookie-dialog-overlay" @click.self.stop="deleteConfirmUser = null">
                    <div class="cookie-dialog" @click.stop>
                        <h3>确认删除</h3>
                        <p class="dialog-hint">确定要删除账号 "{{ deleteConfirmUser?.user_name }}" 吗？</p>

                        <div class="dialog-actions">
                            <RippleButton class="dialog-btn cancel" @click="deleteConfirmUser = null">
                                取消
                            </RippleButton>
                            <RippleButton class="dialog-btn confirm danger" @click="deleteUser">
                                删除
                            </RippleButton>
                        </div>
                    </div>
                </div>
            </Transition>
            </Teleport>
        </div>
    </Transition>

    <!-- 浏览器登录完成提示条 (登录窗口打开期间始终可见) -->
    <Transition name="modal">
        <div v-if="browserLoginActive" class="login-finish-bar">
            <span class="material-symbols-outlined">public</span>
            <span class="login-finish-text">请在登录窗口中登录百度账号</span>
            <RippleButton class="dialog-btn confirm" @click="finishBrowserLogin">
                完成登录
            </RippleButton>
            <RippleButton class="dialog-btn cancel" @click="cancelBrowserLogin">
                取消
            </RippleButton>
        </div>
    </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue';
import QRLoginPanel from './QRLoginPanel.vue';
import { getUserList, removeUser as removeUserService, switchUser as switchUserService, addUser, type User } from '@/services/user-manage';
import { useApiStore } from '@/stores';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import Tip from '@/components/notification/Tip.vue';

const sendNotification = inject<any>('sendNotification');
const sendToast = inject<(title: string, duration?: number) => void>('sendToast');

const props = withDefaults(defineProps<{
    visible?: boolean
}>(), {
    visible: false
});

const emit = defineEmits(['close', 'qrLogin', 'userChanged']);

const user_list = ref<User[]>([]);
const showCookieDialog = ref(false);
const deleteConfirmUser = ref<User | null>(null);
const browserLoginActive = ref(false);
const currentView = ref('main'); // 'main', 'qr', 'cookie'
const cookieForm = ref({
    bduss: '',
    stoken: '',
    cookies: ''
});

const parseCookieInput = (): void => {
    const source = cookieForm.value.cookies;
    const bduss = source.match(/(?:^|[;\s])BDUSS\s*=\s*([^;\s]+)/i)?.[1];
    const stoken = source.match(/(?:^|[;\s])STOKEN\s*=\s*([^;\s]+)/i)?.[1];
    if (bduss) cookieForm.value.bduss = bduss.replace(/^['"]|['"]$/g, '');
    if (stoken) cookieForm.value.stoken = stoken.replace(/^['"]|['"]$/g, '');
};

const isPrivacyMode = computed(() => {
    return user_list.value.every(u => !u.current);
});

const loadUsers = async () => {
    user_list.value = await getUserList();
};

watch(() => props.visible, async (newVal) => {
    if (newVal) {
        await loadUsers();
        currentView.value = 'main';
    }
});

const handleOverlayClick = () => {
    if (!showCookieDialog.value && !deleteConfirmUser.value) {
        emit('close');
    }
};

const qrLogin = () => {
    currentView.value = 'qr';
};

const backToMain = () => {
    currentView.value = 'main';
};

const handleQRLoginSuccess = async (userData: any) => {
    const completeUserData = {
        ...userData,
        username: userData.user_name,
        current: true,
        userId: userData.uid || ''
    };
    await processLoginSuccess(completeUserData);
    currentView.value = 'main';
};

const processLoginSuccess = async (userData: User, message: string = '登录成功') => {
    try {
        await addUser(userData);
        await loadUsers();
        emit('userChanged');
        if (sendNotification) {
            await sendNotification(
                message,
                '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                Tip,
                null,
                { Tip: `欢迎 ${userData.user_name}` },
                3000
            );
        }
    } catch (error: any) {
        console.error('登录处理失败:', error);
        if (sendNotification) {
            await sendNotification(
                `登录失败`,
                '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                Tip,
                null,
                { Tip: `${error.message}` },
                5000
            );
        }
    }
};

const switchUser = async (user: User) => {
    if (!user.current) {
        await switchUserService(user);
        await loadUsers();
        emit('userChanged');
    }
};

const enablePrivacyMode = async () => {
    // 将所有用户设为非当前
    for (const user of user_list.value) {
        if (user.current) {
            user.current = false;
            await addUser(user);
        }
    }
    await loadUsers();
    emit('userChanged');
};

const confirmDelete = (user: User) => {
    deleteConfirmUser.value = user;
};

const deleteUser = async () => {
    if (deleteConfirmUser.value) {
        await removeUserService(deleteConfirmUser.value);
        await loadUsers();
        deleteConfirmUser.value = null;
        emit('userChanged');
    }
};

const cookieLogin = async () => {
    if (!cookieForm.value.bduss || !cookieForm.value.stoken) {
        sendToast?.('请输入完整的 BDUSS 和 STOKEN', 3000);
        return;
    }

    try {
        const apiStore = useApiStore();
        const api = apiStore.getApi();
        const userInfo = await api.getUserInfo(cookieForm.value.bduss, cookieForm.value.stoken);

        if (userInfo && userInfo.data) {
            const user = {
                username: userInfo.data.user_name_url || userInfo.data.user_name_weak || userInfo.data.show_nickname || userInfo.data.user_name_show,
                user_name: userInfo.data.user_name_url || userInfo.data.user_name_weak || userInfo.data.show_nickname || userInfo.data.user_name_show,
                avatar: userInfo.data.user_portrait ? `http://tb.himg.baidu.com/sys/portrait/item/${userInfo.data.user_portrait}.jpg` : '/assets/person.svg',
                userId: userInfo.data.open_uid,
                bduss: cookieForm.value.bduss,
                stoken: cookieForm.value.stoken,
                current: true
            };

            await processLoginSuccess(user, 'Cookie 登录成功');
            showCookieDialog.value = false;
            cookieForm.value = { bduss: '', stoken: '', cookies: '' };
        } else {
            if (sendNotification) {
                await sendNotification(
                    `登录失败`,
                    '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                    Tip,
                    null,
                    { Tip: `请检查 Cookie 是否正确` },
                    5000
                );
            }
        }
    } catch (error: any) {
        console.error('Cookie login error:', error);
        if (sendNotification) {
            await sendNotification(
                `登录失败`,
                '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                Tip,
                null,
                { Tip: `${error.message}` },
                5000
            );
        }
    }
};

const browserLogin = async () => {
    try {
        await invoke('open_login');
        browserLoginActive.value = true;
    } catch (error: any) {
        console.error('打开浏览器登录失败:', error);
        alert('打开登录窗口失败：' + error);
    }
};

const finishBrowserLogin = async () => {
    try {
        await invoke('finish_browser_login');
        browserLoginActive.value = false;
    } catch (error: any) {
        console.error('完成浏览器登录失败:', error);
        if (sendNotification) {
            await sendNotification(
                `登录失败`,
                '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                Tip,
                null,
                { Tip: `${error}` },
                5000
            );
        }
    }
};

const cancelBrowserLogin = async () => {
    try {
        await invoke('cancel_browser_login');
    } catch (error: any) {
        console.error('取消浏览器登录失败:', error);
    }
    browserLoginActive.value = false;
};

const handleBrowserLoginSuccess = async (cookieData: any) => {
    try {
        let bduss, stoken;

        if (typeof cookieData === 'object' && cookieData.bduss && cookieData.stoken) {
            // 新格式：结构化数据
            bduss = cookieData.bduss;
            stoken = cookieData.stoken;
        } else {
            console.error('无效的 Cookie 数据格式');
            if (sendNotification) {
                await sendNotification(
                    `登录失败`,
                    '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                    Tip,
                    null,
                    { Tip: `无效的 Cookie 数据格式` },
                    5000
                );
            }
            return;
        }

        if (!bduss || !stoken) {
            console.error('Cookie 中未找到 BDUSS 或 STOKEN');
            if (sendNotification) {
                await sendNotification(
                    `登录失败`,
                    '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                    Tip,
                    null,
                    { Tip: `未能获取到完整的登录信息` },
                    5000
                );
            }
            return;
        }

        const apiStore = useApiStore();
        const api = apiStore.getApi();
        const userInfo = await api.getUserInfo(bduss, stoken);

        if (userInfo && userInfo.data) {
            const user = {
                username: userInfo.data.user_name_url || userInfo.data.user_name_weak || userInfo.data.show_nickname || userInfo.data.user_name_show,
                user_name: userInfo.data.user_name_url || userInfo.data.user_name_weak || userInfo.data.show_nickname || userInfo.data.user_name_show,
                avatar: userInfo.data.user_portrait ? `http://tb.himg.baidu.com/sys/portrait/item/${userInfo.data.user_portrait}.jpg` : '/assets/person.svg',
                userId: userInfo.data.open_uid,
                bduss: bduss,
                stoken: stoken,
                current: true
            };

            await processLoginSuccess(user, '浏览器登录成功');
        } else {
            if (sendNotification) {
                await sendNotification(
                    `登录失败`,
                    '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                    Tip,
                    null,
                    { Tip: `无法获取用户信息` },
                    5000
                );
            }
        }
    } catch (error: any) {
        console.error('处理浏览器登录失败:', error);
        if (sendNotification) {
            await sendNotification(
                `登录失败`,
                '<span class="material-symbols-outlined" style="font-size: 17px;">person</span>用户登录',
                Tip,
                null,
                { Tip: `${error.message}` },
                5000
            );
        }
    }
};

// 事件监听器引用
let unlistenBrowserLogin: (() => void) | null = null;
let unlistenBrowserError: (() => void) | null = null;
let unlistenBrowserClosed: (() => void) | null = null;

// 初始加载和事件监听
onMounted(async () => {
    await loadUsers();

    // 监听浏览器登录成功事件
    unlistenBrowserLogin = await listen('browser-login-cookies', (event) => {
        console.log('收到浏览器登录 cookies:', event.payload);
        handleBrowserLoginSuccess(event.payload);
    });

    unlistenBrowserError = await listen('browser-login-error', async (event) => {
        console.error('浏览器登录错误:', event.payload);
        if (sendNotification) {
            await sendNotification(
                `登录失败`,
                '<span class="material-symbols-outlined" style="font-size: 17px;">error</span>消息',
                Tip,
                null,
                { Tip: `${event.payload}` },
                5000
            );
        }
    });

    // 登录窗口被关闭(手动或登录完成)时隐藏"完成登录"提示条
    unlistenBrowserClosed = await listen('browser-login-window-closed', () => {
        browserLoginActive.value = false;
    });
});

// 清理事件监听
onBeforeUnmount(() => {
    if (unlistenBrowserLogin) {
        unlistenBrowserLogin();
    }
    if (unlistenBrowserError) {
        unlistenBrowserError();
    }
    if (unlistenBrowserClosed) {
        unlistenBrowserClosed();
    }
});
</script>

<style scoped>
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 40000;
}

.user-card {
    background-color: rgb(var(--background-color));
    border-radius: 10px;
    width: 90%;
    max-width: 900px;
    height: min(600px, 85vh);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    position: relative;
    overflow: hidden;
}

.close-button {
    position: absolute;
    top: 15px;
    right: 15px;
    width: 35px;
    height: 35px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: transparent;
    z-index: 10;
    padding: 0;
    box-shadow: none;
}

.close-button img {
    width: 18px;
    height: 18px;
    filter: invert(var(--invert));
}

.card-content {
    display: flex;
    height: 100%;
    position: relative;
    overflow: hidden;
}

.main-view,
.qr-view {
    width: 100%;
    height: 100%;
    display: flex;
}

.qr-view {
    justify-content: center;
    align-items: center;
    overflow-y: auto;
}

.promo-section {
    flex: 0 0 40%;
    background: linear-gradient(135deg, rgba(36, 200, 219, 0.1) 0%, rgba(49, 176, 255, 0.1) 100%);
    padding: 50px 40px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.promo-content {
    text-align: center;
}

.promo-icon {
    width: 80px;
    height: 80px;
    margin-bottom: 20px;
    filter: invert(var(--invert));
}

.promo-content h2 {
    font-size: 28px;
    font-weight: bold;
    margin-bottom: 10px;
    color: rgb(var(--text-color));
}

.promo-content>p {
    font-size: 16px;
    color: rgba(var(--text-color), 0.7);
    margin-bottom: 40px;
}

.promo-features {
    display: flex;
    flex-direction: column;
    gap: 15px;
    text-align: left;
}

.feature-item {
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgba(var(--text-color), 0.8);
}

.feature-item .material-symbols-outlined {
    color: rgb(36, 200, 219);
    font-size: 20px;
}

.manage-section {
    flex: 1;
    min-width: 0;
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.user-list-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin-bottom: 20px;
}

.user-list-container h3 {
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 15px;
    color: rgb(var(--text-color));
}

.user-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.user-item {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 15px;
    background-color: rgba(var(--text-color), 0.05);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid transparent;
}

.user-item:hover {
    background-color: rgba(var(--text-color), 0.08);
}

.user-item.active {
    border-color: rgb(36, 200, 219);
    background-color: rgba(36, 200, 219, 0.1);
}

.user-avatar {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    object-fit: cover;
}

.privacy-icon {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background-color: rgba(var(--text-color), 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
}

.privacy-icon .material-symbols-outlined {
    font-size: 28px;
    color: rgba(var(--text-color), 0.6);
}

.user-info {
    display: flex;
    align-items: baseline;
    gap: 0px;
    flex-direction: column;
}

.user-info:hover {
    background-color: transparent;
}

.user-name {
    font-weight: bold;
    font-size: 16px;
    color: rgb(var(--text-color));
    margin-bottom: 4px;
}

.user-status {
    font-size: 13px;
    color: rgba(var(--text-color), 0.6);
}

.delete-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 59, 48, 0.1);
    padding: 0;
    opacity: 0;
    transition: opacity 0.2s;
}

.user-item:hover .delete-btn {
    opacity: 1;
}

.delete-btn .material-symbols-outlined {
    font-size: 20px;
    color: rgb(255, 59, 48);
}

.no-users {
    text-align: center;
    padding: 60px 20px;
    color: rgba(var(--text-color), 0.5);
}

.no-users .material-symbols-outlined {
    font-size: 64px;
    margin-bottom: 15px;
}

.no-users p {
    margin: 5px 0;
}

.hint {
    font-size: 13px;
}

.action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: auto;
    flex-shrink: 0;
}

.action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px;
    border-radius: 10px;
    font-weight: 500;
    transition: all 0.2s;
}

.action-btn .material-symbols-outlined {
    font-size: 20px;
}

.action-btn.primary {
    background-color: rgb(36, 200, 219);
    color: white;
}

.action-btn.secondary {
    background-color: rgba(var(--text-color), 0.1);
    color: rgb(var(--text-color));
}

.action-btn.tertiary {
    background-color: rgba(var(--text-color), 0.05);
    color: rgba(var(--text-color), 0.4);
    cursor: not-allowed;
}

/* Cookie 登录弹窗 */
.cookie-dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 40001;
}

.cookie-dialog {
    background-color: rgb(var(--background-color));
    border-radius: 15px;
    padding: 20px;
    width: 90%;
    max-width: 450px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}

.cookie-dialog h3 {
    margin-top: 0px;
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 10px;
    color: rgb(var(--text-color));
}

.dialog-hint {
    font-size: 14px;
    color: rgba(var(--text-color), 0.6);
    margin-bottom: 25px;
}

.input-group {
    margin-bottom: 20px;
}

.input-group label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 8px;
    color: rgb(var(--text-color));
}

.cookie-input {
    width: 100%;
    padding: 12px;
    border-radius: 8px;
    border: 2px solid rgba(var(--text-color), 0.1);
    background-color: rgba(var(--text-color), 0.05);
    color: rgb(var(--text-color));
    font-size: 14px;
    transition: all 0.2s;
}

.cookie-input:focus {
    outline: none;
    border-color: rgb(36, 200, 219);
    background-color: rgba(36, 200, 219, 0.05);
}

.cookie-paste-input {
    box-sizing: border-box;
    min-height: 76px;
    resize: vertical;
    font: inherit;
}

.dialog-actions {
    display: flex;
    gap: 10px;
    margin-top: 25px;
}

.dialog-btn {
    flex: 1;
    padding: 12px;
    border-radius: 8px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
}

.dialog-btn.cancel {
    background-color: rgba(var(--text-color), 0.1);
    color: rgb(var(--text-color));
}

.dialog-btn.confirm {
    background-color: rgb(36, 200, 219);
    color: white;
}

.dialog-btn.danger {
    background-color: rgb(255, 59, 48);
    color: white;
}

/* 浏览器登录完成提示条 */
.login-finish-bar {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2100;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 12px;
    background-color: rgb(var(--background-color));
    color: rgb(var(--text-color));
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}

.login-finish-bar .material-symbols-outlined {
    font-size: 20px;
}

.login-finish-text {
    font-size: 14px;
    white-space: nowrap;
}

.login-finish-bar .dialog-btn {
    flex: none;
    padding: 8px 14px;
    font-size: 14px;
}

.modal-enter-active,
.modal-leave-active {
    transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}

.slide-left-enter-active,
.slide-left-leave-active {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-left-enter-from {
    opacity: 0;
    transform: translateY(30px);
}

.slide-left-leave-to {
    opacity: 0;
    transform: translateY(-30px);
}
</style>
