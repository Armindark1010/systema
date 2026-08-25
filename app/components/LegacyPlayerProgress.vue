<script setup lang="ts">
// ============================================================
// PlayerProgress — time ruler + slider + current/duration
// ============================================================

const { progressMs, durationMs, seek } = usePlayer()

const current = computed(() => {
  const s = Math.floor(progressMs.value / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
})
const total = computed(() => {
  const s = Math.floor(durationMs.value / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
})
</script>

<template>
  <div class="w-full">
    <div
      class="relative h-5 flex items-center"
      :style="{ backgroundImage: 'repeating-linear-gradient(to right, transparent 0 calc(10% - 1px), var(--sys-border-strong) calc(10% - 1px) 10%)' }"
      aria-hidden="true"
    />
    <USlider
      :model-value="progressMs"
      :max="durationMs"
      :step="1000"
      size="sm"
      class="mt-1"
      aria-label="Seek"
      @update:model-value="(v) => seek(Number(v))"
    />
    <div class="flex justify-between mt-1.5">
      <span class="tnum text-[11px] font-medium text-fg-muted">{{ current }}</span>
      <span class="tnum text-[11px] font-medium text-fg-faint">{{ total }}</span>
    </div>
  </div>
</template>
