<script setup lang="ts">
// AlbumGrid — clean archive grid
import type { Album } from '~/types'

const props = defineProps<{ albums: Album[]; cols?: string }>()
const emit = defineEmits<{ open: [album: Album] }>()

const gridClass = computed(() => props.cols ?? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5')
</script>

<template>
  <div v-if="albums.length" class="grid gap-x-5 gap-y-8" :class="gridClass">
    <AlbumCard v-for="a in albums" :key="a.id" :album="a" @open="(al: Album) => emit('open', al)" />
  </div>
  <p v-else class="py-12 text-center text-small text-fg-faint">NO ALBUMS</p>
</template>
