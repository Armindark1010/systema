<script setup lang="ts">
// ArtistList — structured archive list with typographic monograms
import type { Artist } from '~/types'

const props = defineProps<{ artists: Artist[] }>()
const emit = defineEmits<{ open: [artist: Artist] }>()

const { tracks, albums } = useMusicLibrary()

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function trackCount(id: string) {
  return tracks.value.filter((t) => t.artistId === id).length
}
function albumCount(id: string) {
  return albums.value.filter((a) => a.artistId === id).length
}
</script>

<template>
  <div class="border border-line bg-surface">
    <div class="hidden sm:grid grid grid-cols-[1fr_auto_auto] items-center gap-3 h-8 px-3 bg-muted border-b border-line text-[10px] font-bold tracking-[0.14em] text-fg-faint uppercase" aria-hidden="true">
      <span>ARTIST</span>
      <span class="w-16 text-right">TRACKS</span>
      <span class="w-16 text-right">ALBUMS</span>
    </div>
    <ul v-if="artists.length">
      <li v-for="a in artists" :key="a.id" class="border-b border-line last:border-b-0">
        <button
          class="w-full grid grid-cols-[1fr_auto_auto] items-center gap-3 h-14 px-3 text-left t-col pressable focus-ring hover:bg-hover"
          :aria-label="`Open artist ${a.name}`"
          @click="emit('open', a)"
        >
          <!-- monogram -->
          <span class="flex items-center gap-3 min-w-0">
            <span class="w-9 h-9 shrink-0 grid place-items-center border border-line bg-muted text-[12px] font-bold text-fg-muted tnum">
              {{ initials(a.name) }}
            </span>
            <span class="min-w-0">
              <span class="block text-[13.5px] font-semibold text-fg truncate">{{ a.name }}</span>
              <span class="block text-[11px] text-fg-muted tracking-[0.08em]">{{ a.origin }}</span>
            </span>
          </span>
          <span class="tnum text-[12px] text-fg-muted w-16 text-right">{{ trackCount(a.id) }}</span>
          <span class="tnum text-[12px] text-fg-faint w-16 text-right hidden sm:block">{{ albumCount(a.id) }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="py-12 text-center text-small text-fg-faint">NO ARTISTS</p>
  </div>
</template>
