<script setup lang="ts">
// ============================================================
// PlayerSleepTimer — bottom sheet for sleep timer
// ============================================================

import type { SleepTimerOption } from '~/composables/useSleepTimer'

const props = defineProps<{
  open: boolean
  options: SleepTimerOption[]
  selected: number
  remaining: string | null
  isActive: boolean
  customMinutes: number
  showCustomInput: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [minutes: number]
  'update:customMinutes': [value: number]
  setCustom: [minutes: number]
  clear: []
}>()

const localCustom = computed({
  get: () => props.customMinutes,
  set: (v) => emit('update:customMinutes', v),
})

const sheetDrag = useSwipeToDismiss(() => emit('close'))

function onSelect(opt: SleepTimerOption) {
  if (opt.custom) {
    // open custom input mode via parent
    emit('select', -1)
  } else {
    emit('select', opt.value)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sys-overlay">
      <div
        v-if="open"
        class="player-sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Sleep timer"
        @click.self="emit('close')"
      >
        <div class="player-sheet" :class="{ 'is-dragging': sheetDrag.isDragging.value }" :style="sheetDrag.dragStyle.value">
          <div
            class="player-sheet-handle"
            aria-label="Swipe down to close"
            @pointerdown="sheetDrag.onDragStart"
            @pointermove="sheetDrag.onDragMove"
            @pointerup="sheetDrag.onDragEnd"
            @pointercancel="sheetDrag.onDragEnd"
          ><span /></div>

          <div class="player-sheet-header">
            <h2 class="player-sheet-title">SLEEP TIMER</h2>
            <button class="player-sheet-close" aria-label="Close" @click="emit('close')">
              <UIcon name="lucide:x" class="w-4 h-4" />
            </button>
          </div>

          <div v-if="isActive && remaining" class="player-sheet-active">
            <p class="player-sheet-active-label">ACTIVE</p>
            <p class="player-sheet-active-time">{{ remaining }}</p>
            <p class="player-sheet-active-sub">Playback will stop when timer ends</p>
          </div>

          <div class="player-sheet-options">
            <button
              v-for="opt in options"
              :key="opt.label"
              class="player-sheet-option"
              :class="{ 'is-selected': selected === opt.value, 'is-custom': opt.custom }"
              @click="onSelect(opt)"
            >
              <span class="player-sheet-option-label">{{ opt.label }}</span>
              <UIcon v-if="selected === opt.value" name="lucide:check" class="w-4 h-4" />
            </button>
          </div>

          <!-- custom input -->
          <div v-if="showCustomInput || selected === -1" class="player-sheet-custom">
            <p class="player-sheet-custom-label">CUSTOM MINUTES</p>
            <div class="player-sheet-custom-row">
              <input
                v-model.number="localCustom"
                type="number"
                min="1"
                max="480"
                class="player-sheet-custom-input"
                aria-label="Custom minutes"
              >
              <button class="player-sheet-custom-btn" @click="emit('setCustom', localCustom)">
                SET
              </button>
            </div>
          </div>

          <div class="player-sheet-footer">
            <button class="player-sheet-btn player-sheet-btn--ghost" @click="emit('close')">CANCEL</button>
            <button v-if="isActive" class="player-sheet-btn player-sheet-btn--danger" @click="emit('clear')">CLEAR TIMER</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.player-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(10,11,14,0.56);
  backdrop-filter: blur(8px);
  padding: 0;
}

.player-sheet {
  width: 100%;
  max-width: 480px;
  max-height: calc(100dvh - var(--player-safe-top));
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--player-sheet-bg);
  border: 1px solid var(--player-sheet-line);
  border-bottom: 0;
  border-radius: var(--player-sheet-radius) var(--player-sheet-radius) 0 0;
  box-shadow: 0 -8px 32px rgba(0,0,0,0.4);
  animation: sheet-in 360ms var(--player-ease);
}

.player-sheet.is-dragging {
  animation: none;
  user-select: none;
}

.player-sheet-handle {
  display: grid;
  place-items: center;
  height: 28px;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
}
.player-sheet-handle:active { cursor: grabbing; }

.player-sheet-handle span {
  width: 32px;
  height: 3px;
  background: var(--player-fg-faint);
  border-radius: 999px;
  opacity: 0.6;
}

.player-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.25rem 1rem;
  border-bottom: 1px solid var(--player-line);
}

.player-sheet-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--player-fg);
}

.player-sheet-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--player-line);
  background: var(--player-control);
  color: var(--player-fg-muted);
  border-radius: 999px;
  cursor: pointer;
}

.player-sheet-active {
  padding: 1.25rem;
  background: color-mix(in srgb, var(--player-accent) 10%, transparent);
  border-bottom: 1px solid var(--player-line);
  text-align: center;
}

.player-sheet-active-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--player-fg-faint);
}

.player-sheet-active-time {
  margin-top: 0.35rem;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--player-fg);
}

.player-sheet-active-sub {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--player-fg-muted);
}

.player-sheet-options {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0;
}

.player-sheet-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 3rem;
  padding-inline: 1.25rem;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--player-line);
  color: var(--player-fg-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
  text-align: left;
}

.player-sheet-option:hover {
  background: var(--player-control);
  color: var(--player-fg);
}

.player-sheet-option.is-selected {
  color: var(--player-fg);
  background: var(--player-control-hover);
}

.player-sheet-custom {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--player-line);
  border-bottom: 1px solid var(--player-line);
}

.player-sheet-custom-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--player-fg-faint);
  margin-bottom: 0.5rem;
}

.player-sheet-custom-row {
  display: grid;
  grid-template-columns: 1fr 4rem;
  gap: 0.5rem;
}

.player-sheet-custom-input {
  height: 2.75rem;
  padding-inline: 0.875rem;
  background: var(--player-bg);
  border: 1px solid var(--player-line);
  color: var(--player-fg);
  font-size: 0.875rem;
  outline: none;
}

.player-sheet-custom-btn {
  height: 2.75rem;
  background: var(--player-fg);
  color: var(--player-bg);
  border: 1px solid var(--player-fg);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.player-sheet-footer {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.25rem calc(1rem + var(--player-safe-bottom));
}

.player-sheet-btn {
  flex: 1;
  height: 2.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  border: 1px solid var(--player-line);
  cursor: pointer;
  transition: all 160ms var(--player-ease-smooth);
}

.player-sheet-btn--ghost {
  background: transparent;
  color: var(--player-fg-muted);
}

.player-sheet-btn--ghost:hover {
  color: var(--player-fg);
  border-color: var(--player-line-strong);
}

.player-sheet-btn--danger {
  background: transparent;
  color: #ff6b5e;
  border-color: rgba(255,107,94,0.3);
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
