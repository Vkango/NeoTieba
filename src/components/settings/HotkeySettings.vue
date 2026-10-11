<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  comboFromEvent,
  HOTKEY_ACTIONS,
  HOTKEY_ACTION_MAP,
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
  return Array.isArray(override) ? override : action.defaults;
}

function isModified(action: HotkeyAction): boolean {
  return Array.isArray(settingsStore.hotkeyOverrides[action.id]);
}

/** 'Ctrl+Shift+Tab' → [['Ctrl','Shift','Tab']]；'G G' → [['G'],['G']] */
function splitCombo(combo: Combo): string[][] {
  return combo.split(' ').map((part) => part.split('+'));
}

/* ------------------------------- 键位录制 ------------------------------- */

const recordingId = ref<string | null>(null);
const recordError = ref('');

function beginRecord(action: HotkeyAction): void {
  if (!settingsStore.keyboardEnabled) return;
  recordingId.value = action.id;
  recordError.value = '';
  // 捕获阶段拦截，避免录制中的按键触发引擎动作
  window.addEventListener('keydown', onRecordKeydown, true);
}

function endRecord(): void {
  recordingId.value = null;
  window.removeEventListener('keydown', onRecordKeydown, true);
}

function onRecordKeydown(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const id = recordingId.value;
  if (!id) {
    endRecord();
    return;
  }
  if (event.key === 'Escape') {
    endRecord();
    return;
  }
  const combo = comboFromEvent(event);
  if (!combo) return;
  for (const action of HOTKEY_ACTIONS) {
    if (action.id === id) continue;
    if (bindingsOf(action).includes(combo)) {
      recordError.value = `「${combo}」已被「${action.label}」占用，请先解除或换一个键`;
      return;
    }
  }
  const action = HOTKEY_ACTION_MAP.get(id);
  if (!action) {
    endRecord();
    return;
  }
  // 首次修改时以默认键位为基底，之后在此基础上增删
  const next = [...bindingsOf(action)];
  if (!next.includes(combo)) next.push(combo);
  settingsStore.hotkeyOverrides = { ...settingsStore.hotkeyOverrides, [id]: next };
  recordError.value = '';
  endRecord();
}

function removeCombo(action: HotkeyAction, combo: Combo): void {
  if (recordingId.value) return;
  const next = bindingsOf(action).filter((item) => item !== combo);
  settingsStore.hotkeyOverrides = { ...settingsStore.hotkeyOverrides, [action.id]: next };
}

function resetAction(action: HotkeyAction): void {
  if (!isModified(action)) return;
  const next = { ...settingsStore.hotkeyOverrides };
  delete next[action.id];
  settingsStore.hotkeyOverrides = next;
}

function resetAll(): void {
  if (recordingId.value) endRecord();
  recordError.value = '';
  settingsStore.hotkeyOverrides = {};
}

onBeforeUnmount(endRecord);
</script>

<template>
  <div class="hotkey-settings">
    <div class="hotkey-toolbar">
      <span class="hotkey-hint">点击「修改」后按下新的组合键，Esc 取消；删除全部键位可禁用对应动作。</span>
      <button class="hotkey-reset-all" :disabled="!Object.keys(settingsStore.hotkeyOverrides).length" @click="resetAll">
        全部恢复默认
      </button>
    </div>
    <p v-if="recordError" class="hotkey-error" role="alert">{{ recordError }}</p>

    <div v-for="group in groups" :key="group.group" class="hotkey-group">
      <h4>{{ group.name }}</h4>
      <div v-for="action in group.actions" :key="action.id" class="hotkey-row" :class="{ recording: recordingId === action.id }">
        <div class="hotkey-label">
          <span>{{ action.label }}</span>
          <small v-if="action.desc">{{ action.desc }}</small>
        </div>
        <div class="hotkey-controls">
          <div class="hotkey-keys">
            <template v-if="recordingId === action.id">
              <span class="hotkey-recording">按下组合键… <small>Esc 取消</small></span>
            </template>
            <template v-else-if="bindingsOf(action).length">
              <span v-for="combo in bindingsOf(action)" :key="combo" class="hotkey-combo">
                <template v-for="(sequence, seqIndex) in splitCombo(combo)" :key="seqIndex">
                  <span v-if="seqIndex > 0" class="hotkey-then">然后</span>
                  <span class="hotkey-kbd-wrap">
                    <kbd v-for="part in sequence" :key="part">{{ part }}</kbd>
                    <button class="hotkey-remove" :aria-label="`删除 ${combo}`" @click="removeCombo(action, combo)">×</button>
                  </span>
                </template>
              </span>
            </template>
            <span v-else class="hotkey-disabled">已禁用</span>
          </div>
          <button class="hotkey-action-button" :disabled="!settingsStore.keyboardEnabled" @click="beginRecord(action)">
            {{ recordingId === action.id ? '录制中…' : '修改' }}
          </button>
          <button v-if="isModified(action)" class="hotkey-action-button subtle" :disabled="!settingsStore.keyboardEnabled" @click="resetAction(action)">
            重置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hotkey-settings {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hotkey-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hotkey-hint {
  font-size: 12px;
  opacity: 0.5;
}

.hotkey-reset-all {
  padding: 5px 14px;
  font-size: 12px;
  color: rgba(var(--text-color), 1);
  background-color: rgba(var(--text-color), 0.08);
  border: none;
  border-radius: 6px;
  box-shadow: none;
  cursor: pointer;
}

.hotkey-reset-all:disabled {
  opacity: 0.4;
  cursor: default;
}

.hotkey-reset-all:not(:disabled):hover {
  background-color: rgba(var(--text-color), 0.15);
}

.hotkey-error {
  margin: 4px 0;
  padding: 8px 12px;
  font-size: 13px;
  color: rgb(220, 80, 80);
  background-color: rgba(220, 80, 80, 0.1);
  border-radius: 6px;
}

.hotkey-group h4 {
  margin: 12px 0 4px;
  font-size: 13px;
  font-weight: bold;
  opacity: 0.5;
}

.hotkey-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 7px 10px;
  font-size: 13px;
  border-radius: 6px;
  transition: background-color 0.2s ease;
}

.hotkey-row:hover {
  background-color: rgba(var(--text-color), 0.04);
}

.hotkey-row.recording {
  background-color: rgba(var(--primary-color), 0.08);
  outline: 1px dashed rgba(var(--primary-color), 0.5);
}

.hotkey-label {
  display: flex;
  flex-direction: column;
  flex: 1 1 40%;
  min-width: 40%;
}

.hotkey-label small {
  font-size: 11px;
  opacity: 0.5;
}

.hotkey-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 auto;
}

.hotkey-keys {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
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

.hotkey-kbd-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.hotkey-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  color: rgba(var(--text-color), 1);
  background: transparent;
  border: none;
  border-radius: 50%;
  box-shadow: none;
  opacity: 0.35;
  cursor: pointer;
}

.hotkey-remove:hover {
  opacity: 1;
  background-color: rgba(220, 80, 80, 0.15);
  border-color: transparent;
}

.hotkey-recording {
  font-size: 12px;
  color: rgba(var(--primary-color), 1);
  animation: hotkey-pulse 1.2s ease-in-out infinite;
}

.hotkey-recording small {
  opacity: 0.6;
}

@keyframes hotkey-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.hotkey-disabled {
  font-size: 12px;
  opacity: 0.4;
}

.hotkey-action-button {
  padding: 4px 12px;
  font-size: 12px;
  color: rgba(var(--text-color), 1);
  background-color: rgba(var(--text-color), 0.08);
  border: none;
  border-radius: 6px;
  box-shadow: none;
  cursor: pointer;
}

.hotkey-action-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.hotkey-action-button:not(:disabled):hover {
  background-color: rgba(var(--text-color), 0.15);
}

.hotkey-action-button.subtle {
  background: transparent;
  opacity: 0.6;
}

.hotkey-action-button.subtle:not(:disabled):hover {
  opacity: 1;
}
</style>
