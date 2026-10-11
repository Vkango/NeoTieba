<template>
  <div class="thread" data-kb-item @click="onThreadClicked">
    <div class="user-info">
      <div class="avatar"><RemoteImage kind="avatars" class="avatar"
          :src="'https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/' + avatar" /></div>
      <div class="user-name">{{ user_name }}<small v-if="settings.showUserId && props.uid && String(props.uid) !== '0'"> · UID {{ props.uid }}</small></div>
    </div>
    <div class="thread-preview">
      <div class="thread-title" v-html="thread_title"></div>
      <div class="thread-media">
        <UserReplyContentDisplay v-for="item in media" :content="item.postContent" :createTime="item.createTime" />
      </div>
      <div class="thread-info" v-if="create_time != 0">
        <span class="material-symbols-outlined" style="font-size: 16px;">schedule</span>{{ create_time1 }}
      </div>
      <div class="thread-info">{{ msg }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
const settings = useSettingsStore();
import { onMounted, ref, type PropType } from 'vue';
import UserReplyContentDisplay from './UserReplyContentDisplay.vue';
const create_time1 = ref<string>('')
function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${minute}:${ss}`;
}
const emit = defineEmits<{ openThread: [threadId: string | number] }>();
function onThreadClicked() {
  emit('openThread', props.threadId);
}
const props = defineProps({
  uid: { type: [String, Number], default: '' },
  msg: {
    type: String,
    required: false,
    default: '来自我的收藏'
  },
  avatar: {
    type: String,
    required: true,
    default: ''
  },
  user_name: {
    type: String,
    required: true,
    default: ''
  },
  thread_title: {
    type: String,
    required: true,
    default: ''
  },
  media: {
    type: Array as PropType<any[]>,
    required: true,
    default: () => []
  },
  create_time: {
    type: Number,
    required: true,
    default: 0
  },
  threadId: {
    type: String,
    required: true,
    default: 0
  }
})
onMounted(() => {
  create_time1.value = formatDate(props.create_time);
})
</script>
<style scoped>
.thread-info {
  display: flex;
  gap: 5px;
  opacity: 0.5;
  align-items: center;
}



.thread-media {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}


.thread {
  width: calc(100% - 10px);
}

.thread-img {
  max-width: 100px;
  max-height: 100px;
  border-radius: 5px;
}

.thread-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thread-preview .thread-title {
  font-weight: bold;
  font-size: 16px;
}

.user-info {
  display: flex;
  gap: 10px;
  align-items: center;
}

.user-info:hover {
  background-color: transparent;
}
</style>
