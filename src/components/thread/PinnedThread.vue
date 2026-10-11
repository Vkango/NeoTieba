<template>
    <div class="pinned-thread" data-kb-item>
        <span class="material-symbols-outlined" :style="{ color: color }">vertical_align_top</span>

        <span style="font-weight: bold; " :style="{ color: color }">置顶</span>
        <span class="thread-title">{{ title }}</span>
    </div>

</template>
<script setup lang="ts">
defineProps({
    title: {
        type: String,
        required: false,
        default: ''
    },
    color: {
        default: 'var(--text-color)',
    }
})
</script>
<style scoped>
.pinned-thread {
    width: 80%;
    box-sizing: border-box;
    background-color: rgba(var(--text-color), 0.02);
    padding: 8px 10px;
    display: flex;
    border-radius: 8px;
    font-size: 13px;
    gap: 5px;
    transition: all 0.3s ease;
}

.pinned-thread:hover {
    background-color: rgba(var(--text-color), 0.1);
}
</style>