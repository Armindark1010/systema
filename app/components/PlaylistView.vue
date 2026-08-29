<script setup lang="ts">
// ============================================================
// PlaylistView — playlist detail: editorial header + reorderable list
// ============================================================

import type { Playlist, Track } from '~/types'
import { isSystemPlaylistId } from '~/types/playlists'
import { useLibraryStore } from '~/stores/library'
import { tracks as fallbackCatalog } from '~/data/music'

const props = defineProps<{ playlist: Playlist }>()
const emit = defineEmits<{
  edit: []
  'import': []
  'export': []
  remove: [id: string]
}>()

const player = usePlayer()
const libraryStore = useLibraryStore()
const tracks = computed(() => libraryStore.tracks)
const formatDuration = libraryStore.formatDuration
const { reorder, removeTrack } = usePlaylists()

const isFavorites = computed(() => props.playlist.id === 'favorites' || props.playlist.id === 'liked' || props.playlist.id === 'sys-liked')
const isRecents = computed(() => props.playlist.id === 'recents' || props.playlist.id === 'recent' || props.playlist.id === 'sys-recent')
const isSystem = computed(() => props.playlist.kind === 'system' || isSystemPlaylistId(props.playlist.id) || isFavorites.value || isRecents.value)

onMounted(() => {
  if (libraryStore.isNativeLibrary && !libraryStore.allTracksLoaded) {
    void libraryStore.loadAllTracks()
  }
})

const playlistTracks = computed(() => {
  const libraryMap = new Map(tracks.value.map((t) => [t.id, t]))
  return props.playlist.trackIds
    .map((id) => libraryMap.get(id) || fallbackCatalog.find((t) => t.id === id))
    .filter((t): t is Track => Boolean(t))
})
const totalDuration = computed(() => playlistTracks.value.reduce((acc, t) => acc + t.duration, 0))
const kindLabel = computed(() => (props.playlist.kind === 'ai' ? 'AI GENERATED' : isSystem.value ? 'SYSTEM' : 'USER'))

function play() {
  if (playlistTracks.value.length) player.playQueue(playlistTracks.value, 0)
}

function shufflePlay() {
  if (!playlistTracks.value.length) return
  const start = Math.floor(Math.random() * playlistTracks.value.length)
  player.playQueue(playlistTracks.value, start)
  if (!player.isShuffle.value) player.toggleShuffle()
}

function onReorder(from: number, to: number) {
  if (isSystem.value) return
  reorder(props.playlist.id, from, to)
}

function onRemove(trackId: string) {
  removeTrack(props.playlist.id, trackId)
}
</script>

<template>
  <div class="sys-container mt-6 md:mt-8">
    <!-- editorial header -->
    <header class="grid md:grid-cols-[280px_1fr] gap-6 md:gap-10 hairline-b pb-6">
      <div class="max-w-[280px]">
        <!-- Custom system artwork for Favorites -->
        <div v-if="!playlist.cover && isFavorites" class="relative overflow-hidden bg-surface/60 border border-red-500/30 aspect-square flex flex-col items-center justify-center gap-3">
          <div class="w-14 h-14 rounded-sm bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
            <UIcon name="lucide:heart" class="w-7 h-7 fill-current" />
          </div>
          <span class="label text-red-400/90 font-semibold tracking-widest text-[11px]">FAVORITES</span>
        </div>

        <!-- Custom system artwork for Recents -->
        <div v-else-if="!playlist.cover && isRecents" class="relative overflow-hidden bg-surface/60 border border-line aspect-square flex flex-col items-center justify-center gap-3">
          <div class="w-14 h-14 rounded-sm bg-white/5 border border-white/10 flex items-center justify-center text-fg-muted">
            <UIcon name="lucide:history" class="w-7 h-7" />
          </div>
          <span class="label text-fg-muted font-semibold tracking-widest text-[11px]">RECENTLY PLAYED</span>
        </div>

        <Artwork v-else :src="playlist.cover" :alt="playlist.title" :seed="playlist.id" />
      </div>
      <div class="flex flex-col justify-between gap-6 min-w-0">
        <div>
          <div class="flex items-center gap-3">
            <span class="label tnum text-fg-faint">PL / {{ playlist.id.slice(0, 8).toUpperCase() }}</span>
            <span class="chip" :class="playlist.kind === 'ai' ? 'chip-active' : isFavorites ? 'border-red-500/40 text-red-400' : ''">{{ kindLabel }}</span>
            <span v-if="playlist.aiMeta" class="chip">MOOD {{ playlist.aiMeta.mood }}</span>
          </div>
          <h1 class="mt-3 text-display font-bold tracking-tight text-fg break-words">{{ playlist.title }}</h1>
          <p v-if="playlist.description" class="mt-2 text-lead text-fg-muted max-w-[52ch]">{{ playlist.description }}</p>
          <p class="mt-3 text-small text-fg-faint tnum">
            {{ playlistTracks.length }} TRACKS · {{ formatDuration(totalDuration) }} · UPDATED {{ new Date(playlist.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button class="sys-btn-primary" :disabled="!playlistTracks.length" @click="play()">
            <UIcon name="lucide:play" class="w-4 h-4" /> PLAY
          </button>
          <button class="sys-btn-outline" :disabled="!playlistTracks.length" @click="shufflePlay()">
            <UIcon name="lucide:shuffle" class="w-4 h-4" /> SHUFFLE
          </button>
          <template v-if="!isSystem">
            <span class="w-px h-6 bg-line mx-1" aria-hidden="true" />
            <button class="sys-btn-ghost" @click="emit('edit')">
              <UIcon name="lucide:pencil" class="w-3.5 h-3.5" /> EDIT
            </button>
            <button class="sys-btn-ghost" @click="emit('import')">
              <UIcon name="lucide:file-input" class="w-3.5 h-3.5" /> IMPORT
            </button>
            <button class="sys-btn-ghost" @click="emit('export')">
              <UIcon name="lucide:file-output" class="w-3.5 h-3.5" /> EXPORT
            </button>
            <button
              class="sys-btn-ghost !text-danger hover:!text-danger"
              :aria-label="`Delete playlist ${playlist.title}`"
              @click="emit('remove', playlist.id)"
            >
              <UIcon name="lucide:trash-2" class="w-3.5 h-3.5" /> DELETE
            </button>
          </template>
          <template v-else>
            <span class="w-px h-6 bg-line mx-1" aria-hidden="true" />
            <button class="sys-btn-ghost" @click="emit('export')">
              <UIcon name="lucide:file-output" class="w-3.5 h-3.5" /> EXPORT
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- tracklist -->
    <div class="mt-6">
      <div v-if="playlistTracks.length">
        <p class="label-muted mb-3">TRACKLIST — DRAG TO REORDER</p>
        <TrackList
          :tracks="playlistTracks"
          :context="playlist.title"
          draggable
          hide-album
          @reorder="onReorder"
        />
      </div>
      <EmptyState
        v-else
        label="PLAYLIST EMPTY"
        action-label="FIND TRACKS"
        to="/library/tracks"
      >
        This playlist has no tracks yet. Search the archive, or generate one with AI.
      </EmptyState>
    </div>

    <!-- AI metadata -->
    <div v-if="playlist.aiMeta" class="mt-8 border border-ai-line-strong bg-ai-base/60 p-5 flex flex-wrap items-center gap-x-8 gap-y-3">
      <span class="label text-ai-fg-muted">GENERATED WITH AI</span>
      <span class="text-[11px] font-bold tracking-[0.14em] text-ai-fg">MOOD — {{ playlist.aiMeta.mood }}</span>
      <span class="text-[11px] font-bold tracking-[0.14em] text-ai-fg">ENERGY — {{ playlist.aiMeta.energy }}</span>
      <span class="text-[11px] font-bold tracking-[0.14em] text-ai-fg-muted">CONCEPT — “{{ playlist.aiMeta.concept }}”</span>
    </div>
  </div>
</template>
