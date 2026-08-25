<script setup lang="ts">
import type { Album, Track } from '~/types'

interface ContinueItem {
  album: Album
  track: Track
  progress: number
}

const { genreCatalog, continueListening, getArtist } = useMusicLibrary()
const { playTrack, seek } = usePlayer()

const catalogTracks = computed(() => genreCatalog.value.flatMap(entry => entry.tracks))

const savedProgress: Record<string, number> = {
  'al-blueprint': 62,
  'al-outrun': 34,
  'al-hg': 74,
  'al-ram': 12,
  'al-trilogy': 47,
  'al-tbn': 88,
}

const priority = ['al-blueprint', 'al-outrun', 'al-hg', 'al-ram', 'al-trilogy', 'al-tbn']

const items = computed<ContinueItem[]>(() =>
  [...continueListening()]
    .sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id))
    .map((album) => {
      const track = catalogTracks.value
        .filter(item => item.albumId === album.id)
        .sort((a, b) => b.plays - a.plays)[0]

      return track
        ? { album, track, progress: savedProgress[album.id] ?? 30 }
        : undefined
    })
    .filter((item): item is ContinueItem => Boolean(item)),
)

function resume(item: ContinueItem) {
  playTrack(item.track, 'CONTINUE LISTENING')
  seek(item.track.duration * 1000 * (item.progress / 100))
}
</script>

<template>
  <section aria-labelledby="home-continue-title">
    <h2 id="home-continue-title" class="sr-only">Continue Listening</h2>
    <SectionHeader label="CONTINUE LISTENING" to="/library/albums" />

    <div
      class="mt-4 flex gap-4 overflow-x-auto no-scrollbar snap-x pb-2"
      role="list"
      aria-label="Partially played music"
    >
      <div
        v-for="(item, itemIndex) in items"
        :key="item.album.id"
        class="shrink-0 snap-start"
        :class="itemIndex === 0 ? 'w-10' : 'w-9'"
        role="listitem"
      >
        <button
          type="button"
          class="group block w-full text-left pressable focus-ring"
          :aria-label="`Resume ${item.track.title} by ${getArtist(item.track.artistId)?.name} from ${item.progress} percent`"
          @click="resume(item)"
        >
          <Artwork
            :src="item.album.cover"
            :alt="item.album.title"
            :seed="item.album.id"
            class="w-full"
            :class="itemIndex === 0 ? 'border-primary' : ''"
          />

          <span class="mt-3 block min-w-0">
            <span
              class="block font-semibold text-fg truncate group-hover:text-primary t-col"
              :class="itemIndex === 0 ? 'text-small' : 'text-micro'"
            >
              {{ item.track.title }}
            </span>
            <span class="mt-1 block text-micro text-fg-muted truncate">
              {{ getArtist(item.track.artistId)?.name }}
            </span>
          </span>

          <span class="mt-3 block h-1 bg-muted" aria-hidden="true">
            <span class="block h-full bg-primary" :style="{ width: `${item.progress}%` }" />
          </span>
          <span class="mt-1 block label-faint tnum">{{ item.progress }}%</span>
        </button>
      </div>
    </div>
  </section>
</template>
