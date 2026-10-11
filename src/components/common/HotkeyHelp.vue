<script setup lang="ts">
import { computed } from 'vue';
import {
  compactCombos,
  hotkeyState,
  HOTKEY_ACTIONS,
  HOTKEY_GROUP_NAMES,
  type Combo,
  type HotkeyAction,
  type HotkeyGroupId,
} from '@/core/hotkeys';
import { useSettingsStore } from '@/stores/settings';

const settingsStore = useSettingsStore();

const groupOrder: HotkeyGroupId[] = ['tabs', 'nav', 'browse', 'general'];

const groups = computed(() => groupOrder
  .map((group) => ({
    group,
    name: HOTKEY_GROUP_NAMES[group],
    actions: HOTKEY_ACTIONS.filter((action) => action.group === group),
  }))
  .filter((group) => group.actions.length > 0));

function bindingsOf(action: HotkeyAction): Combo[] {
  const override = settingsStore.hotkeyOverrides[action.id];
  return compactCombos(Array.isArray(override) ? override : action.defaults);
}

/** 'Ctrl+Shift+Tab' → [['Ctrl','Shift','Tab']]；'G G' → [['G'],['G']] */
function splitCombo(combo: Combo): string[][] {
  return combo.split(' ').map((part) => part.split('+'));
}

function close(): void {
  hotkeyState.helpVisible = false;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="hotkey-help">
      <div v-if="hotkeyState.helpVisible" class="hotkey-overlay" @click.self="close">
        <section class="hotkey-dialog" role="dialog" aria-modal="true" aria-label="键盘快捷键">
          <header class="hotkey-header">
            <h3>键盘快捷键</h3>
            <button class="hotkey-close" aria-label="关闭" @click="close">
              <span class="material-symbols-outlined">close</span>
            </button>
          </header>
          <div class="hotkey-body">
            <div v-for="group in groups" :key="group.group" class="hotkey-group">
              <h4>{{ group.name }}</h4>
              <div v-for="action in group.actions" :key="action.id" class="hotkey-row">
                <div class="hotkey-label">
                  <span>{{ action.label }}</span>
                  <small v-if="action.desc">{{ action.desc }}</small>
                </div>
                <div class="hotkey-keys">
                  <template v-if="bindingsOf(action).length">
                    <span v-for="combo in bindingsOf(action)" :key="combo" class="hotkey-combo">
                      <template v-for="(sequence, seqIndex) in splitCombo(combo)" :key="seqIndex">
                        <span v-if="seqIndex > 0" class="hotkey-then">然后</span>
                        <kbd v-for="part in sequence" :key="part">{{ part }}</kbd>
                      </template>
                    </span>
                  </template>
                  <span v-else class="hotkey-disabled">已禁用</span>
                </div>
              </div>
            </div>
          </div>
          <footer class="hotkey-footer">
            按 <kbd>?</kbd> 随时打开此面板 · 单键在输入框内自动失效 · 自定义键位见 设置 → 快捷键
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.hotkey-overlay {
  position: fixed;
  inset: 0;
  z-index: 25000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.4);
}

.hotkey-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 640px;
  max-width: 100%;
  max-height: min(560px, calc(100% - 40px));
  color: rgba(var(--text-color), 1);
  background: rgba(var(--background-color), 1);
  border: 1px solid rgba(var(--text-color), 0.1);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3);
}

.hotkey-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 12px;
}

.hotkey-header h3 {
  margin: 0;
  font-size: 17px;
}

.hotkey-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--text-color), 1);
  box-shadow: none;
  opacity: 0.6;
  cursor: pointer;
}

.hotkey-close:hover {
  opacity: 1;
  border-color: transparent;
  background-color: rgba(var(--text-color), 0.08);
}

.hotkey-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px 28px;
  align-items: start;
  padding: 4px 24px;
  overflow-y: auto;
}

.hotkey-group h4 {
  margin: 10px 0 6px;
  font-size: 13px;
  opacity: 0.5;
}

.hotkey-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 5px 0;
  font-size: 13px;
  border-bottom: 1px dashed rgba(var(--text-color), 0.06);
}

.hotkey-row:last-child {
  border-bottom: none;
}

.hotkey-label {
  display: flex;
  flex-direction: column;
  flex: 1 1 52%;
  min-width: 52%;
}

.hotkey-label small {
  font-size: 11px;
  opacity: 0.5;
}

.hotkey-keys {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}

.hotkey-combo {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.hotkey-then {
  font-size: 11px;
  opacity: 0.5;
  margin: 0 2px;
}

.hotkey-disabled {
  font-size: 12px;
  opacity: 0.4;
}

.hotkey-footer {
  padding: 12px 24px 16px;
  font-size: 12px;
  opacity: 0.5;
}

.hotkey-help-enter-active,
.hotkey-help-leave-active {
  transition: opacity 0.2s ease;
}

.hotkey-help-enter-from,
.hotkey-help-leave-to {
  opacity: 0;
}
</style>
