<template>
  <transition name="fade">
    <div v-if="visible" class="toast" @mouseenter="pauseTimer" @mouseleave="startTimer">
      <div class="toast-content dynamic-island-pill">
        <div class="toast-title">{{ title }}</div>
      </div>

    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, onUnmounted, watch } from 'vue';
const duration = ref<number>(3000);
const title = ref<string>('');
const visible = ref<boolean>(false);
function showToast(set_title: string, set_duration: number) {
  title.value = set_title;
  duration.value = set_duration;
  visible.value = true;
  startTimer();
}

const emit = defineEmits(['closed']);
let timer: ReturnType<typeof setTimeout> | null = null;

const close = () => {
  visible.value = false;
  emit('closed');
};

const startTimer = () => {
  if (timer) clearTimeout(timer);
  if (duration.value > 0) {
    timer = setTimeout(close, duration.value);
  }
};

const pauseTimer = () => {
  if (timer) clearTimeout(timer);
};

watch(visible, (newVal) => {
  if (newVal) {
    startTimer();
  }
});


onUnmounted(() => {
  if (timer) clearTimeout(timer);
});

defineExpose({
  showToast,
})
</script>

<style scoped>
.toast {
  display: flex;
  align-items: center;
  justify-content: center;
  position: fixed;
  z-index: 31000;
  bottom: 15px;
  left: 0px;
  width: 100%;
  pointer-events: none;
}

/* 外观走全局 .dynamic-island-pill，这里只保留 Toast 特有的布局/字号 */
.toast-content {
  font-size: 14px;
  pointer-events: auto;
}

.toast-title {
  font-weight: bold;
}


.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, bottom 0.3s ease;

}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  bottom: 5px;
}
</style>
