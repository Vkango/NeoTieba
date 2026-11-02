<template>
  <div style="width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 5px;
  justify-content: center;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0.5;
  gap: 10px;">
    <img src="/assets/spa.svg" style="width: min(120px, 30%); margin-bottom: 20px;filter: invert(var(--invert));">
    <div style="font-size: 220%; font-weight: bold;">欢迎回来</div>
    <div style="font-size: 150%; margin-top: 15px; opacity: 0.5; margin-bottom: 84px;">吾等在此，静候君归</div>

  </div>
</template>
<script setup lang="ts">
import { onMounted, inject } from 'vue';

interface Props {
  key_: string | number;
}

const props = defineProps<Props>();
const updateTabMeta = inject<(info: { key: string | number; title: string; icon: string; icon_invert?: boolean }) => void>('updateTabMeta');

onMounted(() => {
  updateTabMeta?.({ key: props.key_, title: "欢迎", icon: "/assets/apps.svg", icon_invert: true });
});
</script>