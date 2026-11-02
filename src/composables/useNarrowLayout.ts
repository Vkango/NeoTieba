import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/** 与 global.css 登记的 narrow 断点一致；模板级（v-if）切换无法用 @container，这里按同一元素的内容宽度判定 */
export const NARROW_LAYOUT_WIDTH = 720;

/**
 * 观察目标元素内容宽度，宽度 ≤ 断点时 isNarrow 为 true。
 * 目标应是 Container 的滚动元素（取 getScrollElement()），这样与同页 CSS 的 @container page 查询取同一宽度，不会在边界上错位。
 */
export function useNarrowLayout(target: Ref<HTMLElement | null | undefined> | (() => HTMLElement | null | undefined), breakpoint = NARROW_LAYOUT_WIDTH) {
  const isNarrow = ref(false);
  let observer: ResizeObserver | undefined;
  let observed: HTMLElement | null = null;

  const resolve = () => (typeof target === 'function' ? target() : target.value) ?? null;

  const measure = (element: HTMLElement) => {
    isNarrow.value = element.clientWidth <= breakpoint;
  };

  const attach = () => {
    const element = resolve();
    if (element === observed) return;
    if (observed && observer) observer.unobserve(observed);
    observed = element;
    if (!element) return;
    measure(element);
    observer?.observe(element);
  };

  onMounted(() => {
    observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry?.target instanceof HTMLElement) measure(entry.target);
    });
    attach();
  });

  watch(resolve, attach, { flush: 'post' });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = undefined;
    observed = null;
  });

  return { isNarrow };
}
