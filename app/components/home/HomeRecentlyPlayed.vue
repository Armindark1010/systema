<script setup lang="ts">
import type { Track } from '~/types'

const { recentlyPlayed, getAlbum, getArtist, formatDuration } = useMusicLibrary()
const player = usePlayer()

const tracks = computed(() => recentlyPlayed(8))

function playFromHistory(track: Track) {
  const startIndex = tracks.value.findIndex(item => item.id === track.id)
  player.playQueue(
    tracks.value.map(item => ({ track: item, context: 'RECENTLY PLAYED' })),
    startIndex,
  )
}
</script>

<template>
  <section aria-labelledby="home-recent-title">
    <h2 id="home-recent-title" class="sr-only">Recently Played</h2>
    <SectionHeader label="RECENTLY PLAYED" to="/library/tracks" />

    <ol class="mt-4 hairline-t">
      <li
        v-for="(track, trackIndex) in tracks"
        :key="track.id"
        class="hairline-b"
      >
        <button
          type="button"
          class="w-full grid grid-cols-12 gap-1 items-center py-2 text-left pressable focus-ring hover:bg-hover active:bg-muted"
          :class="player.currentTrack.value?.id === track.id ? 'bg-primary-muted' : ''"
          :aria-label="`Play ${track.title} by ${getArtist(track.artistId)?.name}`"
          :aria-current="player.currentTrack.value?.id === track.id ? 'true' : undefined"
          @click="playFromHistory(track)"
        >
          <span class="sys-col-1 label-faint tnum text-center" aria-hidden="true">
            {{ String(trackIndex + 1).padStart(2, '0') }}
          </span>

          <span class="sys-col-2 md:sys-col-1">
            <Artwork
              :src="getAlbum(track.albumId)?.cover"
              :alt="track.title"
              :seed="track.id"
              class="w-6 h-6"
            />
          </span>

          <span class="sys-col-7 md:sys-col-5 min-w-0">
            <span
              class="block text-small font-semibold truncate"
              :class="player.currentTrack.value?.id === track.id ? 'text-primary' : 'text-fg'"
            >
              {{ track.title }}
            </span>
            <span class="block text-micro text-fg-muted truncate">
              {{ getArtist(track.artistId)?.name }}
            </span>
          </span>

          <span class="hidden md:block md:sys-col-4 min-w-0 text-micro text-fg-muted truncate">
            {{ getAlbum(track.albumId)?.title }}
          </span>

          <span class="sys-col-2 md:sys-col-1 text-right text-micro text-fg-faint tnum">
            {{ formatDuration(track.duration) }}
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>
