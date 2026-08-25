<script setup lang="ts">
// AlbumCard — grid tile with play-on-hover affordance
import type { Album } from '~/types'

const props = defineProps<{ album: Album }>()
const emit = defineEmits<{ open: [album: Album] }>()

const { getArtist } = useMusicLibrary()
const { playAlbum } = usePlayer()

async function onPlay() {
  const { tracks } = useMusicLibrary()
  const albumTracks = tracks.value.filter((t) => t.albumId === props.album.id)
  if (albumTracks.length) {
    playAlbum(props.album, albumTracks)
  }
}
</script>

<template>
  <article class="group relative t-col pressable focus-ring" :aria-label="`Album ${album.title}`">
    <button class="block w-full text-left" @click="emit('open', album)">
      <div class="relative">
        <Artwork :src="album.cover" :alt="album.title" :seed="album.id" rounded />
        <!-- play affordance -->
        <span
          class="absolute right-2 bottom-2 w-9 h-9 grid place-items-center bg-primary text-primary-fg opacity-0 translate-y-1 group-hover:(opacity-100 translate-y-0) t-all focus-within:opacity-100"
          role="button"
          :aria-label="`Play album ${album.title}`"
          tabindex="0"
          @click.stop="onPlay()"
          @keydown.enter.prevent="onPlay()"
          @keydown.space.prevent="onPlay()"
        >
          <UIcon name="lucide:play" class="w-4 h-4" />
        </span>
      </div>
      <div class="mt-2.5">
        <p class="text-[13px] font-semibold text-fg truncate">{{ album.title }}</p>
        <p class="text-[11.5px] text-fg-muted truncate">{{ getArtist(album.artistId)?.name }} · {{ album.year }}</p>
      </div>
    </button>
  </article>
</template>
