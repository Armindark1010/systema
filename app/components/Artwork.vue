<script setup lang="ts">
// Procedural artwork square — album covers or seeded geometric fallback.
const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  seed?: string
  rounded?: boolean
}>(), { src: undefined, alt: '', seed: 'sys', rounded: false })

// quiet material tones — graphite, steel, champagne (no loud hues)
const palette = ['#1c2734', '#3d4a5c', '#8f9aa8', '#b6a26a', '#24446e', '#55606e']

const fallback = computed(() => {
  const s = props.seed ?? 'sys'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  const c1 = palette[h % palette.length]
  const c2 = palette[(h * 7 + 3) % palette.length]
  const c3 = palette[(h * 13 + 5) % palette.length]
  const w = 24 + (h % 40)
  return { c1, c2, c3, w }
})
</script>

<template>
  <div
    class="relative overflow-hidden bg-hover border border-line aspect-square w-full h-full"
    :class="rounded ? 'rounded-1' : ''"
  >
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      class="block w-full h-full object-cover"
      loading="lazy"
      decoding="async"
    >
    <svg v-else class="w-full h-full block" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" :aria-label="alt || 'artwork'">
      <rect width="100" height="100" :fill="fallback.c1" />
      <rect :x="fallback.w" :width="100 - fallback.w" y="0" height="100" :fill="fallback.c2" opacity="0.85" />
      <rect x="0" y="0" width="100" height="18" :fill="fallback.c3" />
    </svg>
  </div>
</template>
