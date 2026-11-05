export interface ContentElement {
    type: number;
    text?: string;
    link?: string;
    c?: string;
    bigCdnSrc?: string;
    bigSrc?: string;
    big_src?: string;
    originSrc?: string;
    big_cdn_src?: string;
    origin_src?: string;
    uid?: string;
    voiceUrl?: string;
    /** 贴吧语音（type 10）：link/src 为空，播放地址需由 md5 拼接 */
    voice_md5?: string;
    src?: string;
}

export interface UserInfo {
    id: string;
    name: string;
    portrait?: string;
    level_id?: number;
    sex?: number;
}

export interface ThreadInfo {
    id: string;
    title: string;
    author_id?: string;
    forum_id?: string;
    create_time?: number;
    reply_num?: number;
}

export interface PostInfo {
    id: string;
    content: ContentElement[];
    author?: UserInfo;
    time?: number;
    floor?: number;
}

export interface ForumInfo {
    id: string;
    name: string;
    avatar?: string;
    member_count?: number;
    thread_count?: number;
}
