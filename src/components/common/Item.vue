<template>
  <RippleButton id="RippleButton" @click="emit('click')" style="background-color: rgba(var(--text-color), 0.05);">
    <div class="item-content">
      <div class="item-icon">
        <span class="material-symbols-outlined">{{ icon }}</span>
      </div>
      <div class="item-text">
        <div class="ripple-button-title">{{ title }}</div>
        <div class="ripple-button-title item-desc">{{ desc }}</div>
      </div>
      <div v-if="type && type !== 'default'" class="item-control" @click.stop>
        <label v-if="type === 'toggle'" class="switch">
          <input type="checkbox" :checked="Boolean(value)" @change="handleToggle">
          <span class="switch-track"></span>
        </label>

        <select v-else-if="type === 'select'" class="select" :value="String(value ?? '')" @change="handleSelect">
          <option v-for="option in normalizedOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <input v-else-if="type === 'input'" class="input" :value="String(value ?? '')" :placeholder="placeholder"
          @input="handleInput">

        <input v-else-if="type === 'color'" type="color" class="color" :value="String(value ?? '#000000')"
          @input="handleColor">

        <RangeSlider v-else-if="type === 'slider'" class="slider" :model-value="Number(value ?? 0)"
          :min="min ?? 0" :max="max ?? 100" :step="step ?? 1" :aria-label="title"
          @update:model-value="handleSlider" />
        <!--
        <button v-else-if="type === 'button'" class="action-button" type="button" @click="emit('click')">
          运行
        </button> -->
      </div>
    </div>
  </RippleButton>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import RippleButton from '#components/common/RippleButton.vue';
import RangeSlider from '#components/common/RangeSlider.vue';

type ItemType = 'default' | 'toggle' | 'select' | 'input' | 'color' | 'slider' | 'button';
type SelectOption = string | { label: string; value: string };

const props = withDefaults(defineProps<{
  icon: string;
  title: string;
  desc: string;
  type?: ItemType;
  value?: string | boolean | number;
  options?: SelectOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}>(), {
  type: 'default',
  value: '',
  options: () => [],
  placeholder: '',
  min: 0,
  max: 100,
  step: 1,
});

const emit = defineEmits<{
  (event: 'click'): void;
  (event: 'update:value', value: string | boolean | number): void;
}>();

const normalizedOptions = computed(() =>
  props.options.map(option => typeof option === 'string'
    ? { label: option, value: option }
    : option
  )
);

function handleToggle(event: Event) {
  emit('update:value', (event.target as HTMLInputElement).checked);
}

function handleSelect(event: Event) {
  emit('update:value', (event.target as HTMLSelectElement).value);
}

function handleInput(event: Event) {
    emit('update:value', (event.target as HTMLInputElement).value);
}

function handleColor(event: Event) {
    emit('update:value', (event.target as HTMLInputElement).value);
}

function handleSlider(value: number) {
    emit('update:value', value);
}
</script>

<style scoped>
.item-content {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 0 10px;
}

.item-icon {
  font-variation-settings: 'FILL' 0, 'wght' 100;
}

.item-text {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.item-control {
  display: flex;
  align-items: center;
  margin-left: auto;
}

.ripple-button-title {
  font-size: 13px;
  margin-top: 5px;
}

.item-desc {
  color: rgba(var(--text-color), 0.5);
  font-size: 12px;
}

#RippleButton {
  background-color: transparent;
  box-shadow: none;
  padding: 10px 5px;
}

.material-symbols-outlined {
  font-variation-settings:
    'FILL' 0,
    'wght' 100,
    'GRAD' 0,
    'opsz' 24
}

.switch {
  position: relative;
  display: inline-flex;
  width: 42px;
  height: 24px;
}

.switch input {
  display: none;
}

.switch-track {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: rgba(var(--text-color), 0.16);
  transition: background 0.2s ease;
}

.switch-track::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  top: 3px;
  left: 3px;
  border-radius: 50%;
  background: rgb(var(--text-color));
  transition: transform 0.2s ease;
}

.switch input:checked+.switch-track {
  background: rgba(var(--primary-color), 0.55);
}

.switch input:checked+.switch-track::after {
  transform: translateX(18px);
}

.select,
.input {
  min-width: 150px;
  border: 1px solid rgba(var(--text-color), 0.12);
  border-radius: 6px;
  padding: 6px 8px;
  color: rgb(var(--text-color));
  background: rgba(var(--background-color), 0.55);
  outline: none;
  width: 220px;
}

.color {
  width: 48px;
  height: 32px;
  border: 1px solid rgba(var(--text-color), 0.12);
  border-radius: 6px;
  padding: 2px;
  background: rgba(var(--background-color), 0.55);
  cursor: pointer;
}

.slider {
  width: 220px;
  margin: 4px 0;
}

.action-button {
  border: 0;
  border-radius: 6px;
  padding: 6px 12px;
  color: rgb(var(--text-color));
  background: rgba(var(--primary-color), 0.16);
  cursor: pointer;
}

/* 紧凑内容区：控件换到第二行，与文字左缘对齐（图标 24px + 间距 15px） */
@container page (max-width: 480px) {
  .item-content {
    flex-wrap: wrap;
  }

  .item-control {
    flex-basis: 100%;
    margin-left: 0;
    padding-left: 39px;
    box-sizing: border-box;
  }

  .select,
  .input,
  .slider {
    width: 100%;
    min-width: 0;
  }
}
</style>
