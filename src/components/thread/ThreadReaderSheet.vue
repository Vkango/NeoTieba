<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue';
import { groupReadingPosts } from '@/utils/thread-reader';
import type { ReaderHeading, ReaderPage } from '@/utils/reader-source';
const props = defineProps<{ page: ReaderPage; layout: CSSProperties }>();
const emit = defineEmits<{ (event: 'openUser', id: string | number): void }>();
const root = ref<HTMLElement>();
const groups = computed(() => groupReadingPosts(props.page.parts));
const position = (heading: ReaderHeading): CSSProperties => ({
  left: `${heading.left}px`, top: `${heading.top}px`, width: `${heading.width}px`, height: `${heading.height}px`,
});
defineExpose({ getElement: () => root.value });
</script>

<template>
  <article ref="root" class="reader-paper" :style="layout" :data-columns="layout['--reader-columns']">
    <template v-for="(heading, index) in page.headings" :key="index">
      <h1 v-if="heading.kind === 'title'" class="reader-title" :style="position(heading)">{{ heading.text }}</h1>
      <h2 v-else class="reader-author-heading" :style="position(heading)">
        <button type="button" @click="emit('openUser', heading.authorId!)">{{ heading.text }}</button>
      </h2>
    </template>
    <section v-for="group in groups" :key="group.id" class="reader-author-block">
      <div v-for="part in group.posts" :key="part.id + ':' + part.from" class="reader-post"
        :data-post-id="part.id" :data-from="part.from" :data-to="part.to" v-html="part.html"></div>
    </section>
  </article>
</template>

<style scoped>
.reader-paper { position: relative; box-sizing: border-box; font-size: var(--reader-font-size); font-weight: var(--reader-font-weight); line-height: var(--reader-line-height); font-kerning: normal; font-variant-ligatures: normal; user-select: text; }
.reader-title, .reader-author-heading { position: absolute; box-sizing: border-box; margin: 0; padding: 0; text-align: start; white-space: pre; }
.reader-title { font-size: var(--reader-title-size); line-height: var(--reader-title-line-height); font-weight: 600; letter-spacing: -.015em; }
.reader-author-heading { font-size: 14px; line-height: 24px; font-weight: 500; color: rgba(var(--text-color), .56); }
.reader-author-heading button { padding: 0; margin: 0; border: 0; border-radius: 3px; box-shadow: none; font: inherit; line-height: inherit; color: inherit; background: transparent; cursor: pointer; }
.reader-author-block, .reader-post { display: contents; }
.reader-post :deep(.reader-line) { position: absolute; margin: 0; padding: 0; white-space: pre; line-height: var(--reader-line-height); text-align: start; overflow-wrap: normal; word-break: normal; }
.reader-post :deep(.reader-line.justified) { text-align: justify; text-align-last: justify; text-justify: auto; }
.reader-post :deep(.reader-line p), .reader-post :deep(.reader-line div), .reader-post :deep(.reader-line blockquote), .reader-post :deep(.reader-line li),
.reader-post :deep(.reader-media p), .reader-post :deep(.reader-media div) { display: contents; margin: 0; padding: 0; }
.reader-post :deep(.reader-source-break) { display: none; }
.reader-post :deep(.reader-line .emoticon) { width: 1.25em !important; height: 1.25em !important; vertical-align: -.2em; margin: 0; padding: 0; }
.reader-post :deep(.reader-line .at-button) { font: inherit; font-weight: 500; line-height: inherit; padding: 0; margin: 0; border: 0; box-shadow: none; background: transparent; }
.reader-post :deep(.reader-media) { position: absolute; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); place-items: center; margin: 0; padding: 0; }
/* Ordinary reply grids use square thumbnails. Reader media must fit the paginator's aspect-ratio box. */
.reader-post :deep(.reader-media img), .reader-post :deep(.reader-media video) { display: block; box-sizing: border-box; min-width: 0; min-height: 0; aspect-ratio: auto; width: 100% !important; height: 100% !important; max-width: 100% !important; max-height: 100% !important; object-fit: contain; border-radius: 5px; cursor: pointer; }
.reader-post :deep(.reader-media audio) { width: 100%; max-width: 100%; height: 54px; }
.reader-post :deep(.reader-reply-row) { position: absolute; display: flex; align-items: center; }
.reader-post :deep(.reader-replies) { display: inline-flex; align-items: center; height: 32px; max-width: 100%; margin: 0; padding: 4px 10px; border: 1px solid rgba(var(--text-color), .12); border-radius: 8px; box-shadow: none; background: rgba(var(--text-color), .04); color: rgba(var(--text-color), .65); font-size: 13px; font-weight: 500; line-height: 20px; font-family: inherit; cursor: pointer; }
.reader-post :deep(.reader-replies:hover) { color: rgb(var(--primary-color)); background: rgba(var(--primary-color), .1); }
.reader-post :deep(.reader-replies:focus-visible) { outline: 2px solid rgb(var(--primary-color)); outline-offset: 2px; }
.reader-author-heading button:focus-visible { outline: 2px solid rgb(var(--primary-color)); outline-offset: 2px; }
</style>
