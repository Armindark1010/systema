<script setup lang="ts">
// ============================================================
// PlayerControls — transport + secondary actions
// ============================================================

const { isPlaying, togglePlay, next, prev, shuffle, repeat, cycleRepeat, toggleShuffle } = usePlayer()

const repeatIcon = computed(() => (repeat.value === 'one' ? 'lucide:repeat-1' : 'lucide:repeat'))
const repeatLabel = computed(() => (repeat.value === 'off' ? 'Repeat off' : repeat.value === 'all' ? 'Repeat all' : 'Repeat one'))
</script>

<template>
  <div class="flex items-center justify-center gap-1 md:gap-2" role="group" aria-label="Player controls">
    <!-- shuffle -->
    <button
      class="pressable focus-ring w-9 h-9 grid place-items-center t-col hidden sm:grid"
      :class="shuffle ? 'text-primary' : 'text-fg-faint hover:text-fg'"
      :aria-label="shuffle ? 'Shuffle on' : 'Shuffle off'"
      :aria-pressed="shuffle"
      @click="toggleShuffle()"
    >
      <UIcon name="lucide:shuffle" class="w-4 h-4" />
    </button>

    <!-- previous -->
    <button
      class="pressable focus-ring w-9 h-9 grid place-items-center text-fg-muted hover:text-fg t-col"
      aria-label="Previous track"
      @click="prev()"
    >
      <UIcon name="lucide:skip-back" class="w-4.5 h-4.5" />
    </button>

    <!-- play / pause -->
    <button
      class="pressable focus-ring w-12 h-12 grid place-items-center bg-primary text-primary-fg hover:bg-primary-strong t-all"
      :aria-label="isPlaying ? 'Pause' : 'Play'"
      @click="togglePlay()"
    >
      <UIcon :name="isPlaying ? 'lucide:pause' : 'lucide:play'" class="w-5 h-5" />
    </button>

    <!-- next -->
    <button
      class="pressable focus-ring w-9 h-9 grid place-items-center text-fg-muted hover:text-fg t-col"
      aria-label="Next track"
      @click="next()"
    >
      <UIcon name="lucide:skip-forward" class="w-4.5 h-4.5" />
    </button>

    <!-- repeat -->
    <button
      class="pressable focus-ring w-9 h-9 grid place-items-center t-col hidden sm:grid"
      :class="repeat !== 'off' ? 'text-primary' : 'text-fg-faint hover:text-fg'"
      :aria-label="repeatLabel"
      :aria-pressed="repeat !== 'off'"
      @click="cycleRepeat()"
    >
      <UIcon :name="repeatIcon" class="w-4 h-4" />
    </button>
  </div>
</template>
