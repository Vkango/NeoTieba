/**
 * 公共数据类型定义
 */

// Media类型
export interface MediaItem {
    type: number;
    big_pic?: string;
    vpic?: string;
    src?: string;
    [key: string]: unknown;
}

// 内容元素类型
export interface ContentElement {
    type: number;
    text?: string;
    c?: string;
    link?: string;
    [key: string]: unknown;
}

// 吧规规则项
export interface RuleItem {
    type: string;
    text: string;
    link?: string;
}

// 吧规规则组
export interface RuleGroup {
    title: string;
    content: RuleItem[];
}

// 吧规信息
export interface BarRule {
    title: string;
    preface: string;
    rules: RuleGroup[];
}

// 吧务成员
export interface BawuMember {
    id: string;
    name: string;
    portrait: string;
    level: number;
    type: string;
}

// 吧务分组
export interface BawuGroup {
    type: string;
    members: BawuMember[];
}

// 吧信息
export interface BarInfo {
    id: string;
    name: string;
    avatar: string;
    slogan: string;
    description: string;
    category: string;
    member_num: number;
    post_num: number;
    thread_num: number;
    background: string;
}

// 用户在吧的信息
export interface UserBarInfo {
    is_like: boolean;
    level_id: number;
    level_name: string;
    cur_score: number;
    levelup_score: number;
    is_sign_in: boolean;
    sign_in_count: number;
    cont_sign_num: number;
    follow_days: number;
    thread_num: number;
    day_post_num: number;
}

// 通知项
export interface NotificationItem {
    id: string;
    source: string;
    title: string;
    component: any;
    props: Record<string, any>;
    duration: number;
    visible: boolean;
    hidden: boolean;
    timestamp: number;
    click?: () => void;
}

// 分屏组（像 VSCode 的编辑器组；数组顺序即左右布局顺序）
export interface SplitGroup {
    id: string;
    /** 该分屏当前显示的标签 key */
    activeKey: string | null;
    /** 分屏被隐藏（至少保留一个可见分屏；主分屏不可隐藏） */
    hidden?: boolean;
}

// 标签拖到内容区时的分屏落点：move = 移入目标分屏（beforeKey = 插到该组某标签前），create = 右缘新建分屏
export type SplitDropZone = { type: 'move'; groupId: string; beforeKey?: string } | { type: 'create' };

// Tab项
export interface TabItem {
    id: number;
    key: string;
    renderKey: string;
    selected: boolean;
    icon: string;
    title: string;
    component: any;
    props?: Record<string, any>;
    icon_invert: boolean;
    show: boolean;
    position: number;
    desc: string;
    content: string;
    isClosing?: boolean;
    closable?: boolean;
    origin?: TabItem;
    if?: boolean;
    /** 所属分屏组 id（groups 数组顺序决定分屏左右位置） */
    groupId: string;
    /** 帖子页加载完成后记录的楼主头像（用于集锦条目头像） */
    authorIcon?: string;
}

// User类型
export interface User {
    userId?: string;
    username: string;
    user_name: string;
    avatar: string;
    bduss: string;
    stoken: string;
    current?: boolean;
    name?: string;
}

// 吧数据
export interface ForumData {
    id: string;
    name: string;
    avatar: string;
    slogan?: string;
    member_num: number;
    post_num: number;
    thread_num: number;
    first_class?: string;
    second_class?: string;
    managers?: Array<{
        id?: string | number;
        name?: string;
        show_name?: string;
        portrait?: string;
        level?: number;
        level_id?: number;
        [key: string]: any;
    }>;
    [key: string]: any;
}

