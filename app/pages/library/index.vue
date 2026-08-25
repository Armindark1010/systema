<script setup lang="ts">
// ============================================================
// LIBRARY — SYSTEMA's local, music-first archive
// ============================================================

import type { Album, Artist, Playlist, Track } from '~/types'
import type { EmoExpression } from '~/types/emo'
import type { LibraryAction } from '~/components/library/LibraryActionsSheet.vue'
import { librarySections, librarySortOptions, type LibrarySection, type LibrarySortKey } from '~/composables/useLibrary'

useHead({ title: 'Library' })
definePageMeta({ hideMobileHeader: true })

const library = useLibrary()
const player = usePlayer()
const playlistsStore = usePlaylists()
const toast = useToast()

const {
  activeSection,
  sortKey,
  selectedSortLabel,
  isLoading,
  totalTracks,
  sortedTracks,
  albums,
  artists,
  playlists,
  getAlbum,
  getArtist,
  formatDuration,
  trackCountForArtist,
  tracksForAlbum,
  tracksForArtist,
  tracksForPlaylist,
  playTrack,
  playTracks,
  shuffleLibrary,
  setSection,
} = library

const emoExpression = ref<EmoExpression>('idle')
const emoMessage = ref('LIBRARY READY')
const showSortSheet = ref(false)
const selectedAction = ref<
  | { kind: 'track'; item: Track }
  | { kind: 'album'; item: Album }
  | { kind: 'artist'; item: Artist }
  | { kind: 'playlist'; item: Playlist }
  | null
>(null)

const sectionDirection = ref<'forward' | 'back'>('forward')
const activeIndex = computed(() => librarySections.findIndex(section => section.id === activeSection.value))
const pageTransition = computed(() => sectionDirection.value === 'forward' ? 'library-section-forward' : 'library-section-back')

let emoTimer: ReturnType<typeof setTimeout> | undefined
function react(expression: EmoExpression, message: string, resetAfter = 700) {
  if (emoTimer) clearTimeout(emoTimer)
  emoExpression.value = expression
  emoMessage.value = message
  emoTimer = setTimeout(() => {
    emoExpression.value = 'idle'
    emoMessage.value = 'LIBRARY READY'
  }, resetAfter)
}
onBeforeUnmount(() => { if (emoTimer) clearTimeout(emoTimer) })

function activateSection(section: LibrarySection) {
  const nextIndex = librarySections.findIndex(item => item.id === section)
  if (nextIndex === activeIndex.value) return
  sectionDirection.value = nextIndex > activeIndex.value ? 'forward' : 'back'
  setSection(section)
  react('curious', section.toUpperCase())
}

function openSort() {
  showSortSheet.value = true
  react('curious', 'CHOOSING SORT')
}

function selectSort(key: LibrarySortKey) {
  sortKey.value = key
  react('thinking', 'SORTING LIBRARY')
}

function shuffle() {
  react('excited', 'SHUFFLING')
  shuffleLibrary()
}

function selectTrack(track: Track) {
  react('listening', 'NOW PLAYING')
  playTrack(track)
}

function openActions(kind: 'track' | 'album' | 'artist' | 'playlist', item: Track | Album | Artist | Playlist) {
  selectedAction.value = { kind, item } as NonNullable<typeof selectedAction.value>
  react(kind === 'playlist' ? 'happy' : 'curious', 'ACTIONS')
}

const actionTitle = computed(() => {
  if (!selectedAction.value) return 'ACTIONS'
  return selectedAction.value.kind === 'track' ? 'TRACK ACTIONS'
    : selectedAction.value.kind === 'album' ? 'ALBUM ACTIONS'
      : selectedAction.value.kind === 'artist' ? 'ARTIST ACTIONS'
        : 'PLAYLIST ACTIONS'
})

const actionItemLabel = computed(() => {
  const selected = selectedAction.value
  if (!selected) return ''
  if (selected.kind === 'track') return `${selected.item.title} · ${getArtist(selected.item.artistId)?.name ?? 'UNKNOWN ARTIST'}`
  if (selected.kind === 'artist') return selected.item.name
  return selected.item.title
})

const actions = computed<LibraryAction[]>(() => {
  switch (selectedAction.value?.kind) {
    case 'track':
      return [
        { id: 'play', label: 'PLAY', icon: 'lucide:play' },
        { id: 'play-next', label: 'PLAY NEXT', icon: 'lucide:skip-forward' },
        { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
        { id: 'playlist', label: 'ADD TO PLAYLIST', icon: 'lucide:list-plus' },
        { id: 'like', label: 'LIKE', icon: 'lucide:heart' },
        { id: 'album', label: 'VIEW ALBUM', icon: 'lucide:disc-3' },
        { id: 'artist', label: 'VIEW ARTIST', icon: 'lucide:mic-vocal' },
        { id: 'info', label: 'TRACK INFO', icon: 'lucide:info' },
      ]
    case 'album':
      return [
        { id: 'play', label: 'PLAY', icon: 'lucide:play' },
        { id: 'shuffle', label: 'SHUFFLE', icon: 'lucide:shuffle' },
        { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
        { id: 'playlist', label: 'ADD TO PLAYLIST', icon: 'lucide:list-plus' },
        { id: 'artist', label: 'VIEW ARTIST', icon: 'lucide:mic-vocal' },
        { id: 'info', label: 'ALBUM INFO', icon: 'lucide:info' },
      ]
    case 'artist':
      return [
        { id: 'play', label: 'PLAY', icon: 'lucide:play' },
        { id: 'shuffle', label: 'SHUFFLE', icon: 'lucide:shuffle' },
        { id: 'queue', label: 'ADD TO QUEUE', icon: 'lucide:list-music' },
        { id: 'view', label: 'VIEW ARTIST', icon: 'lucide:mic-vocal' },
      ]
    case 'playlist':
      return [
        { id: 'play', label: 'PLAY', icon: 'lucide:play' },
        { id: 'shuffle', label: 'SHUFFLE', icon: 'lucide:shuffle' },
        { id: 'tracks', label: 'ADD TRACKS', icon: 'lucide:list-plus' },
        { id: 'rename', label: 'RENAME', icon: 'lucide:pencil' },
        { id: 'export', label: 'EXPORT', icon: 'lucide:upload' },
        { id: 'delete', label: 'DELETE', icon: 'lucide:trash-2', danger: true },
      ]
    default: return []
  }
})

function addTracksToDefaultPlaylist(tracks: Track[]) {
  let target = playlistsStore.playlists.value[0]
  if (!target) target = playlistsStore.createPlaylist('LIBRARY PICKS', 'Created from Library')
  playlistsStore.addTracks(target.id, tracks.map(track => track.id))
  toast.add({ title: 'Added to playlist', description: target.title, icon: 'lucide:check' })
}

function addTracksToQueue(tracks: Track[]) {
  player.queue.value = [...player.queue.value, ...tracks.map(track => ({ track, context: 'LIBRARY QUEUE' }))]
  toast.add({ title: 'Added to queue', description: `${tracks.length} TRACKS`, icon: 'lucide:list-music' })
}

function showInfo(label: string) {
  toast.add({ title: label, description: 'Local library metadata is ready for AI analysis.', icon: 'lucide:info' })
}

function runAction(id: string) {
  const selected = selectedAction.value
  if (!selected) return

  if (selected.kind === 'track') {
    const track = selected.item
    if (id === 'play') selectTrack(track)
    else if (id === 'play-next') {
      const position = Math.max(0, player.index.value + 1)
      const queue = [...player.queue.value]
      queue.splice(position, 0, { track, context: 'PLAY NEXT' })
      player.queue.value = queue
      toast.add({ title: 'Queued next', description: track.title, icon: 'lucide:skip-forward' })
    } else if (id === 'queue') addTrackToQueue(track)
    else if (id === 'playlist') addTracksToDefaultPlaylist([track])
    else if (id === 'like') player.toggleFavoriteId(track.id)
    else if (id === 'album') activateSection('albums')
    else if (id === 'artist') activateSection('artists')
    else if (id === 'info') showInfo(track.title)
  }

  if (selected.kind === 'album') {
    const tracks = tracksForAlbum(selected.item.id)
    if (id === 'play') playTracks(tracks, selected.item.title)
    else if (id === 'shuffle') playTracks(tracks, selected.item.title, true)
    else if (id === 'queue') addTracksToQueue(tracks)
    else if (id === 'playlist') addTracksToDefaultPlaylist(tracks)
    else if (id === 'artist') activateSection('artists')
    else if (id === 'info') showInfo(selected.item.title)
  }

  if (selected.kind === 'artist') {
    const tracks = tracksForArtist(selected.item.id)
    if (id === 'play') playTracks(tracks, selected.item.name)
    else if (id === 'shuffle') playTracks(tracks, selected.item.name, true)
    else if (id === 'queue') addTracksToQueue(tracks)
    else if (id === 'view') showInfo(selected.item.name)
  }

  if (selected.kind === 'playlist') {
    const tracks = tracksForPlaylist(selected.item)
    if (id === 'play') playTracks(tracks, selected.item.title)
    else if (id === 'shuffle') playTracks(tracks, selected.item.title, true)
    else if (id === 'tracks' && player.currentTrack.value) {
      playlistsStore.addTracks(selected.item.id, [player.currentTrack.value.id])
      toast.add({ title: 'Track added', description: selected.item.title, icon: 'lucide:list-plus' })
    }
    else if (id === 'rename') {
      playlistsStore.updatePlaylist(selected.item.id, { title: `${selected.item.title} · EDITED` })
      toast.add({ title: 'Playlist renamed', description: 'Local prototype update complete.', icon: 'lucide:pencil' })
    } else if (id === 'export') {
      playlistsStore.startExport()
      toast.add({ title: 'Export prepared', description: selected.item.title, icon: 'lucide:upload' })
    } else if (id === 'delete') {
      playlistsStore.deletePlaylist(selected.item.id)
      toast.add({ title: 'Playlist deleted', description: selected.item.title, icon: 'lucide:trash-2' })
    }
  }
}

function playlistCover(playlist: Playlist) {
  const track = tracksForPlaylist(playlist)[0]
  return track ? getAlbum(track.albumId)?.cover : playlist.cover
}

// Horizontal section gesture: directional, thresholded, button-safe, and
// deliberately leaves mostly vertical movement to document scrolling.
const swipeOffset = ref(0)
const isSwiping = ref(false)
let swipePointerId: number | null = null
let startX = 0
let startY = 0
let startedAt = 0
let axis: 'pending' | 'horizontal' | 'vertical' = 'pending'

const sectionSurfaceStyle = computed(() => ({
  transform: `translate3d(${swipeOffset.value}px, 0, 0)`,
  transition: isSwiping.value ? 'none' : `transform var(--library-motion) var(--sys-ease)`,
}))

function interactiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, [data-library-no-swipe]'))
}

function onSectionPointerDown(event: PointerEvent) {
  if (interactiveTarget(event.target) || event.pointerType === 'mouse' && event.button !== 0) return
  swipePointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  startedAt = performance.now()
  axis = 'pending'
  isSwiping.value = false
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onSectionPointerMove(event: PointerEvent) {
  if (event.pointerId !== swipePointerId) return
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY
  if (axis === 'pending' && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 10) {
    axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.3 ? 'horizontal' : 'vertical'
  }
  if (axis !== 'horizontal') return
  isSwiping.value = true
  swipeOffset.value = Math.max(-48, Math.min(48, deltaX * 0.3))
}

function onSectionPointerEnd(event: PointerEvent) {
  if (event.pointerId !== swipePointerId) return
  const deltaX = event.clientX - startX
  const duration = Math.max(1, performance.now() - startedAt)
  const velocity = Math.abs(deltaX) / duration
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  swipePointerId = null
  isSwiping.value = false
  swipeOffset.value = 0

  const clearIntent = axis === 'horizontal' && (Math.abs(deltaX) >= 72 || Math.abs(deltaX) >= 32 && velocity >= 0.45)
  if (!clearIntent) return
  const nextIndex = activeIndex.value + (deltaX < 0 ? 1 : -1)
  const next = librarySections[nextIndex]
  if (next) activateSection(next.id)
}
</script>

<template>
  <div class="library-page">
    <div class="library-page__shell">
      <LibraryHero :expression="emoExpression" :message="emoMessage" />

      <div class="library-page__content">
        <LibraryControls :sort-label="selectedSortLabel" :track-count="totalTracks" @sort="openSort" @shuffle="shuffle" />
        <LibraryTabs :active="activeSection" :sections="librarySections" @select="activateSection" />

        <section
          class="library-page__section-surface"
          :style="sectionSurfaceStyle"
          @pointerdown="onSectionPointerDown"
          @pointermove="onSectionPointerMove"
          @pointerup="onSectionPointerEnd"
          @pointercancel="onSectionPointerEnd"
        >
          <LibrarySkeleton v-if="isLoading" :section="activeSection" />
          <Transition v-else :name="pageTransition" mode="out-in">
            <LibraryTracks
              v-if="activeSection === 'tracks'"
              key="tracks"
              :tracks="sortedTracks"
              :get-artist="getArtist"
              :get-album="getAlbum"
              :format-duration="formatDuration"
              @play="selectTrack"
              @actions="track => openActions('track', track)"
            />
            <LibraryAlbums
              v-else-if="activeSection === 'albums'"
              key="albums"
              :albums="albums"
              :get-artist="getArtist"
              @play="album => playTracks(tracksForAlbum(album.id), album.title)"
              @actions="album => openActions('album', album)"
            />
            <LibraryArtists
              v-else-if="activeSection === 'artists'"
              key="artists"
              :artists="artists"
              :track-count="trackCountForArtist"
              @play="artist => playTracks(tracksForArtist(artist.id), artist.name)"
              @actions="artist => openActions('artist', artist)"
            />
            <LibraryPlaylists
              v-else
              key="playlists"
              :playlists="playlists"
              :count-tracks="playlist => tracksForPlaylist(playlist).length"
              :cover-for="playlistCover"
              @play="playlist => playTracks(tracksForPlaylist(playlist), playlist.title)"
              @actions="playlist => openActions('playlist', playlist)"
            />
          </Transition>
        </section>
      </div>
    </div>

    <LibrarySortSheet
      :open="showSortSheet"
      :selected="sortKey"
      :options="librarySortOptions"
      @close="showSortSheet = false"
      @select="selectSort"
    />
    <LibraryActionsSheet
      :open="Boolean(selectedAction)"
      :title="actionTitle"
      :item-label="actionItemLabel"
      :actions="actions"
      @close="selectedAction = null"
      @action="runAction"
    />
  </div>
</template>

<style scoped>
.library-page { width: 100%; min-width: 0; overflow-x: clip; padding-bottom: calc(var(--library-gutter-wide) + var(--sys-safe-bottom)); }
.library-page__shell { width: 100%; max-width: var(--library-max-width); margin-inline: auto; }
.library-page__content { display: flex; flex-direction: column; gap: var(--library-gutter); padding: var(--library-gutter); }
.library-page__section-surface { min-width: 0; overflow: hidden; touch-action: pan-y; will-change: transform; }

.library-section-forward-enter-active,
.library-section-forward-leave-active,
.library-section-back-enter-active,
.library-section-back-leave-active { transition: opacity var(--library-motion) var(--sys-ease), transform var(--library-motion) var(--sys-ease); }
.library-section-forward-enter-from,
.library-section-back-leave-to { opacity: 0; transform: translate3d(var(--library-row-gap), 0, 0); }
.library-section-forward-leave-to,
.library-section-back-enter-from { opacity: 0; transform: translate3d(calc(var(--library-row-gap) * -1), 0, 0); }

@media (min-width: 768px) {
  .library-page__content { padding-inline: var(--library-gutter-wide); }
}

@media (prefers-reduced-motion: reduce) {
  .library-section-forward-enter-active,
  .library-section-forward-leave-active,
  .library-section-back-enter-active,
  .library-section-back-leave-active { transition: none; }
  .library-section-forward-enter-from,
  .library-section-forward-leave-to,
  .library-section-back-enter-from,
  .library-section-back-leave-to { transform: none; }
}
</style>
