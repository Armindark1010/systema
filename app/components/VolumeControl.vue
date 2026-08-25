<script setup lang="ts">
// VolumeControl — desktop-only volume slider
const { volume, muted, setVolume, toggleMute } = usePlayer()

const icon = computed(() => {
  if (muted.value || volume.value === 0) return 'lucide:volume-x'
  if (volume.value < 0.5) return 'lucide:volume-1'
  return 'lucide:volume-2'
})
</script>

<template>
  <div class="hidden md:flex items-center gap-2 w-36" role="group" aria-label="Volume">
    <button
      class="pressable focus-ring w-8 h-8 grid place-items-center text-fg-muted hover:text-fg t-col"
      :aria-label="muted ? 'Unmute' : 'Mute'"
      @click="toggleMute()"
    >
      <UIcon :name="icon" class="w-4 h-4" />
    </button>
    <USlider
      :model-value="muted ? 0 : volume"
      :max="1"
      :step="0.01"
      size="sm"
      class="flex-1"
      aria-label="Volume"
      @update:model-value="(v) => setVolume(Number(v))"
    />
  </div>
</template>
