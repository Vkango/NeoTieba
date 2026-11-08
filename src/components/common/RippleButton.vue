<template>
  <button class="ripple-button" @pointerdown="startRipple" @pointerup="releasePointerRipple"
    @pointercancel="releasePointerRipple" @pointerleave="releasePointerRipple" @keydown="startKeyboardRipple"
    @keyup="releaseKeyboardRipple" @blur="releaseAllRipples">
    <span class="ripple-content">
      <slot></slot>
    </span>
    <span v-for="ripple in ripples" :key="ripple.id" class="ripple" :class="{ 'is-released': ripple.released }" :style="{
      left: `${ripple.x}px`,
      top: `${ripple.y}px`,
      width: `${ripple.size}px`,
      height: `${ripple.size}px`
    }" aria-hidden="true"></span>
  </button>
</template>

<script>
import { onUnmounted, ref } from 'vue';

export default {
  setup() {
    const ripples = ref([]);
    const timers = new Map();
    let nextRippleId = 0;
    let keyboardRippleId = null;

    const releaseRipple = (id) => {
      const ripple = ripples.value.find((item) => item.id === id);
      if (!ripple || ripple.released) return;

      ripple.released = true;
      const timer = setTimeout(() => {
        ripples.value = ripples.value.filter((item) => item.id !== id);
        timers.delete(id);
      }, 320);
      timers.set(id, timer);
    };

    const startRipple = (event) => {
      if (event.button !== 0 || event.currentTarget.disabled) return;

      const button = event.currentTarget;
      const rect = button.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // The circle must reach the farthest corner, including for narrow or irregular buttons.
      const radius = Math.max(
        Math.hypot(x, y),
        Math.hypot(rect.width - x, y),
        Math.hypot(x, rect.height - y),
        Math.hypot(rect.width - x, rect.height - y)
      );
      const id = ++nextRippleId;

      ripples.value.push({
        id,
        x: x - radius,
        y: y - radius,
        size: radius * 2,
        released: false
      });
    };

    const releasePointerRipple = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const activeRipple = [...ripples.value].reverse().find((item) => !item.released);
      if (activeRipple) releaseRipple(activeRipple.id);
    };

    const startKeyboardRipple = (event) => {
      if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat || event.currentTarget.disabled) return;
      // Pointer events don't fire for keyboard activation, so start a centered state layer.
      const rect = event.currentTarget.getBoundingClientRect();
      const radius = Math.hypot(rect.width, rect.height) / 2;
      const id = ++nextRippleId;
      keyboardRippleId = id;
      ripples.value.push({
        id,
        x: rect.width / 2 - radius,
        y: rect.height / 2 - radius,
        size: radius * 2,
        released: false
      });
    };

    const releaseKeyboardRipple = (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (keyboardRippleId !== null) releaseRipple(keyboardRippleId);
      keyboardRippleId = null;
    };

    const releaseAllRipples = () => {
      ripples.value.forEach((ripple) => releaseRipple(ripple.id));
      keyboardRippleId = null;
    };

    onUnmounted(() => timers.forEach(clearTimeout));

    return {
      ripples,
      startRipple,
      releasePointerRipple,
      startKeyboardRipple,
      releaseKeyboardRipple,
      releaseAllRipples
    };
  }
};
</script>

<style scoped>
.ripple-button {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  color: rgba(var(--text-color));
  border: none;
  border-radius: 4px;
  outline: none;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}

.ripple-button:hover {
  background-color: rgba(var(--background-color), 0.5);
}

.ripple-button:active {
  background-color: rgba(var(--background-color), 0.3);
}

.ripple-button:focus-visible {
  outline: 2px solid rgba(var(--text-color), 0.55);
  outline-offset: 2px;
}

:root.dark .ripple-button:hover {
  background-color: rgba(var(--text-color), 0.1);
}

:root.dark .ripple-button:active {
  background-color: rgba(var(--text-color), 0.15);
}

.ripple-content {
  position: relative;
  z-index: 1;
}

.ripple {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  pointer-events: none;
  background-color: rgba(var(--text-color), 0.3);
  transform: scale(0);
  opacity: 0.18;
  animation: ripple-expand 450ms cubic-bezier(0.2, 0, 0, 1) forwards;
}

.ripple.is-released {
  opacity: 0;
  transition: opacity 300ms linear;
}

:root.dark .ripple {
  background-color: rgba(var(--text-color), 0.3);
}

@keyframes ripple-expand {
  from {
    transform: scale(0);
  }

  to {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ripple {
    animation-duration: 1ms;
  }
}
</style>
