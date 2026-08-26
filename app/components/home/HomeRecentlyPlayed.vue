<script setup lang="ts">
import type { Track } from '~/types'

// Recents come from usePlaybackHistory, which records real playback
// starts reported by the native engine and resolves device tracks
// registered by the library store. Nothing here reads the mock
// catalog: on a phone these are the user's actual tracks.
const { recentlyPlayed } = usePlaybackHistory()
const { formatDuration } = useMusicLibrary()

// Canonical resolvers, shared with every player surface. These fall
// back through the library store, so device tracks — whose artist and
// album ids only exist natively — display correctly instead of
// resolving to nothing via the mock catalog.
const { coverFor, artistFor, albumFor } = useTrackFields()
const { isCurrent } = useIsCurrentTrack()
const player = usePlayer()

const tracks = computed(() => recentlyPlayed(8))

function playFromHistory(track: Track) {
  const startIndex = tracks.value.findIndex(item => item.id === track.id)
  // The recents list itself becomes the playback context, so Next and
  // Previous walk it. Previously this passed an array of
  // { track, context } wrappers, which is not the Track[] shape
  // playQueue expects — the queue ended up holding malformed entries.
  player.playQueue(tracks.value, Math.max(0, startIndex))
}
</script>

<template>
  <section aria-labelledby="home-recent-title">
    <h2 id="home-recent-title" class="sr-only">Recently Played</h2>
    <SectionHeader label="RECENTLY PLAYED" to="/library/tracks" />

    <!-- Nothing played yet: say so rather than rendering an empty list. -->
    <p v-if="!tracks.length" class="mt-4 text-small text-fg-muted">
      Nothing played yet. Start a track and it will appear here.
    </p>

    <ol v-else class="mt-4 hairline-t">
      <li
        v-for="(track, trackIndex) in tracks"
        :key="track.id"
        class="hairline-b"
      >
        <button
          type="button"
          class="w-full grid grid-cols-12 gap-1 items-center py-2 text-left pressable focus-ring hover:bg-hover active:bg-muted"
          :class="isCurrent(track.id) ? 'bg-primary-muted' : ''"
          :aria-label="`Play ${track.title} by ${artistFor(track)}`"
          :aria-current="isCurrent(track.id) ? 'true' : undefined"
          @click="playFromHistory(track)"
        >
          <span class="col-span-1 label-faint tnum text-center" aria-hidden="true">
            {{ String(trackIndex + 1).padStart(2, '0') }}
          </span>

          <span class="col-span-2 md:col-span-1">
            <Artwork
              :src="coverFor(track)"
              :alt="track.title"
              :seed="track.id"
              class="w-6 h-6"
            />
          </span>

          <span class="col-span-7 md:col-span-5 min-w-0">
            <span
              class="block text-small font-semibold truncate"
              :class="isCurrent(track.id) ? 'text-primary' : 'text-fg'"
            >
              {{ track.title }}
            </span>
            <span class="block text-micro text-fg-muted truncate">
              {{ artistFor(track) }}
            </span>
          </span>

          <span class="hidden md:block md:col-span-4 min-w-0 text-micro text-fg-muted truncate">
            {{ albumFor(track) }}
          </span>

          <span class="col-span-2 md:col-span-1 text-right text-micro text-fg-faint tnum">
            {{ formatDuration(track.duration) }}
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>
