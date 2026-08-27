<script setup lang="ts">
// ============================================================
// LIBRARY — SYSTEMA's local, music-first archive
// ============================================================
// Powered by centralized Pinia state (Library Store + Player Store).
// Features:
// - Direct track play without opening Full Player
// - Direction-locked interactive horizontal section swipe
// - Seamless vertical document scrolling
// ============================================================

import type { Album, Artist, Playlist, Track } from '~/types'
import type { EmoExpression } from '~/types/emo'
import type { LibraryAction } from '~/components/library/LibraryActionsSheet.vue'
import { librarySections, librarySortOptions, type LibrarySection, type LibrarySortKey } from '~/stores/library'
import { useSettingsStore } from '~/stores/settings'

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
  // Native device library. All inert on the web, where the mock
  // catalog keeps rendering exactly as before.
  isNativeLibrary,
  isScanning,
  needsPermission,
  scanLabel,
  libraryError,
  permissionStatus,
  requestLibraryPermission,
  scanLibrary,
  // Pagination
  hasMoreTracks,
  isLoadingMore,
  loadedCount,
  allTracksLoaded,
  loadMoreTracks,
} = library


/**
 * On Android an empty track list is meaningful: it means we are still
 * scanning, or the user has not granted audio access. Surfacing that
 * beats the generic "NO TRACKS YET" empty state.
 */
const nativeNotice = computed(() => {
  if (!isNativeLibrary.value || sortedTracks.value.length > 0) return null

  if (needsPermission.value) {
    return {
      title: 'PERMISSION REQUIRED',
      body: permissionStatus.value === 'denied'
        ? 'SYSTEMA cannot read your audio files. Grant music access in Android settings, then scan again.'
        : 'SYSTEMA needs access to the audio on this device to build your library.',
      action: 'GRANT ACCESS',
    }
  }
  if (isScanning.value) {
    return {
      title: 'SCANNING DEVICE',
      body: scanLabel.value || 'Reading the device media index…',
      action: null,
    }
  }
  if (libraryError.value) {
    return { title: 'LIBRARY ERROR', body: libraryError.value.message, action: 'RETRY' }
  }
  return {
    title: 'NO MUSIC FOUND',
    body: 'No audio files were found on this device.',
    action: 'SCAN AGAIN',
  }
})

async function onNativeNoticeAction() {
  if (needsPermission.value) {
    const granted = await requestLibraryPermission()
    if (granted) await scanLibrary()
    return
  }
  await scanLibrary()
}

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

const activeIndex = computed(() => {
  const idx = librarySections.findIndex(section => section.id === activeSection.value)
  return idx >= 0 ? idx : 0
})

if (activeSection.value !== 'tracks') {
  setSection('tracks')
}

// ---- Infinite scroll ---------------------------------------
// The Library scrolls the document, so the sentinel is observed
// against the viewport. Loading begins ~400px before it appears.
const loadMoreSentinel = ref<HTMLElement | null>(null)

// Only observe while there is genuinely another page to fetch and the
// tracks pane is the one on screen.
const canLoadMore = computed(
  () => isNativeLibrary.value && hasMoreTracks.value && activeIndex.value === 0,
)

useInfiniteScroll(loadMoreSentinel, () => loadMoreTracks(), canLoadMore, { rootMargin: 400 })

// ---- Fast scroll + scroll-to-top ---------------------------
// One shared, rAF-throttled scroll reader drives both controls, so
// there is a single passive listener rather than one per control.
const { scrollY, maxScroll, measure: measureScroll } = useDocumentScroll()

// Both controls belong to the tracks pane only; the album/artist/
// playlist panes keep their existing behaviour untouched.
const showScrollTools = computed(() => activeIndex.value === 0 && sortedTracks.value.length > 0)

// Appending a page makes the document taller, which changes the
// fast-scroll mapping. Re-measure after the DOM has grown.
watch(() => sortedTracks.value.length, () => nextTick(measureScroll))

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
onBeforeUnmount(() => {
  if (emoTimer) clearTimeout(emoTimer)
})

function activateSection(section: LibrarySection) {
  if (section === activeSection.value) return
  setSection(section)
  react('curious', section.toUpperCase())
}

// Direction-locked interactive horizontal swipe
const gestures = useLibraryGestures({
  activeIndex,
  totalSections: librarySections.length,
  onNavigate: (nextIdx) => {
    const nextSection = librarySections[nextIdx]
    if (nextSection) {
      activateSection(nextSection.id)
    }
  },
})

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

/**
 * MANDATORY REQUIREMENT:
 * Tapping a library track plays it immediately via Pinia, updates
 * Mini Player and EMO, but MUST NOT open the Full Screen Player.
 */
function selectTrack(track: Track) {
  react('listening', 'NOW PLAYING')
  playTrack(track)
}

function openActions(kind: 'track' | 'album' | 'artist' | 'playlist', item: Track | Album | Artist | Playlist) {
  selectedAction.value = { kind, item } as NonNullable<typeof selectedAction.value>
  react(kind === 'playlist' ? 'happy' : 'curious', 'ACTIONS')
}

function onTrackLongPress(track: Track) {
  const target = useSettingsStore().gestures.longPress
  if (target === 'queue') {
    player.addToQueue(track)
    toast.add({ title: 'Added to queue', description: track.title, icon: 'lucide:list-music' })
    react('curious', 'QUEUED')
    return
  }
  if (target === 'playlist') {
    addTracksToDefaultPlaylist([track])
    react('happy', 'PLAYLIST')
    return
  }
  openActions('track', track)
}

const actionTitle = computed(() => {
  if (!selectedAction.value) return 'ACTIONS'
  return selectedAction.value.kind === 'track'
    ? 'TRACK ACTIONS'
    : selectedAction.value.kind === 'album'
      ? 'ALBUM ACTIONS'
      : selectedAction.value.kind === 'artist'
        ? 'ARTIST ACTIONS'
        : 'PLAYLIST ACTIONS'
})

const actionItemLabel = computed(() => {
  const selected = selectedAction.value
  if (!selected) return ''
  if (selected.kind === 'track') {
    return `${selected.item.title} · ${getArtist(selected.item.artistId)?.name ?? 'UNKNOWN ARTIST'}`
  }
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
    default:
      return []
  }
})

function addTracksToDefaultPlaylist(tracks: Track[]) {
  let target = playlistsStore.playlists.value[0]
  if (!target) target = playlistsStore.createPlaylist('LIBRARY PICKS', 'Created from Library')
  playlistsStore.addTracks(target.id, tracks.map(track => track.id))
  toast.add({ title: 'Added to playlist', description: target.title, icon: 'lucide:check' })
}

function addTracksToQueue(tracks: Track[]) {
  for (const track of tracks) {
    player.addToQueue(track)
  }
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
      player.addToQueue(track, true)
      toast.add({ title: 'Queued next', description: track.title, icon: 'lucide:skip-forward' })
    } else if (id === 'queue') {
      player.addToQueue(track)
      toast.add({ title: 'Added to queue', description: track.title, icon: 'lucide:list-music' })
    } else if (id === 'playlist') addTracksToDefaultPlaylist([track])
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
    } else if (id === 'rename') {
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

function isPaneVisible(paneIndex: number) {
  return (
    activeIndex.value === paneIndex ||
    gestures.isDragging.value ||
    gestures.isTransitioning.value
  )
}
</script>

<template>
  <div class="library-page">
    <div class="library-page__shell">
      <LibraryHero :expression="emoExpression" :message="emoMessage" />

      <div class="library-page__content">
        <LibraryControls
          :sort-label="selectedSortLabel"
          :track-count="totalTracks"
          @sort="openSort"
          @shuffle="shuffle"
        />
        <!-- <LibraryTabs
          :active="activeSection"
          :sections="librarySections"
          @select="activateSection"
        /> -->

        <LibrarySkeleton v-if="isLoading" :section="activeSection" />

        <!-- Direction-locked interactive horizontal swipe surface -->
        <section
          v-else
          class="library-page__swipe-container"
          @pointerdown="gestures.onPointerDown"
          @pointermove="gestures.onPointerMove"
          @pointerup="gestures.onPointerUp"
          @pointercancel="gestures.onPointerCancel"
        >
          <div
            class="library-page__swipe-track"
            :style="{
              transform: gestures.trackTransform.value,
              transition: gestures.trackTransition.value,
            }"
          >
            <!-- 0: TRACKS -->
            <div
              class="library-page__swipe-pane"
              :class="{
                'is-active': activeIndex === 0,
                'is-inert': !isPaneVisible(0),
              }"
              :aria-hidden="activeIndex !== 0"
            >
              <LibraryEmptyState v-if="nativeNotice" :title="nativeNotice.title">
                {{ nativeNotice.body }}
                <template v-if="nativeNotice.action">
                  <button
                    class="sys-btn-outline !h-8 mt-3"
                    @click="onNativeNoticeAction"
                  >
                    {{ nativeNotice.action }}
                  </button>
                </template>
              </LibraryEmptyState>
              <template v-else>
                <LibraryTracks
                  :tracks="sortedTracks"
                  :get-artist="getArtist"
                  :get-album="getAlbum"
                  :format-duration="formatDuration"
                  @play="selectTrack"
                  @actions="track => openActions('track', track)"
                  @longpress="onTrackLongPress"
                />

                <!--
                  Pagination sentinel. Observed by IntersectionObserver
                  with a bottom rootMargin, so the next page starts
                  loading before the user hits the true end of the list.
                -->
                <div
                  v-if="isNativeLibrary && hasMoreTracks"
                  ref="loadMoreSentinel"
                  class="library-page__sentinel"
                  aria-hidden="true"
                />

                <p
                  v-if="isLoadingMore"
                  class="library-page__more label-muted"
                  role="status"
                >
                  LOADING MORE TRACKS…
                </p>
                <p
                  v-else-if="allTracksLoaded && loadedCount > 0"
                  class="library-page__more label-muted"
                >
                  {{ loadedCount }} TRACKS · END OF LIBRARY
                </p>
              </template>
            </div>

            <!-- 1: ALBUMS (commented out) -->
            <!--
            <div
              class="library-page__swipe-pane"
              :class="{
                'is-active': activeIndex === 1,
                'is-inert': !isPaneVisible(1),
              }"
              :aria-hidden="activeIndex !== 1"
            >
              <LibraryAlbums
                :albums="albums"
                :get-artist="getArtist"
                @play="album => playTracks(tracksForAlbum(album.id), album.title)"
                @actions="album => openActions('album', album)"
              />
            </div>
            -->

            <!-- 2: ARTISTS (commented out) -->
            <!--
            <div
              class="library-page__swipe-pane"
              :class="{
                'is-active': activeIndex === 2,
                'is-inert': !isPaneVisible(2),
              }"
              :aria-hidden="activeIndex !== 2"
            >
              <LibraryArtists
                :artists="artists"
                :track-count="trackCountForArtist"
                @play="artist => playTracks(tracksForArtist(artist.id), artist.name)"
                @actions="artist => openActions('artist', artist)"
              />
            </div>
            -->

            <!-- 3: PLAYLISTS (commented out) -->
            <!--
            <div
              class="library-page__swipe-pane"
              :class="{
                'is-active': activeIndex === 3,
                'is-inert': !isPaneVisible(3),
              }"
              :aria-hidden="activeIndex !== 3"
            >
              <LibraryPlaylists
                :playlists="playlists"
                :count-tracks="playlist => tracksForPlaylist(playlist).length"
                :cover-for="playlistCover"
                @play="playlist => playTracks(tracksForPlaylist(playlist), playlist.title)"
                @actions="playlist => openActions('playlist', playlist)"
              />
            </div>
            -->
          </div>
        </section>
        <!--
          Overlay controls for the track list. Both are fixed-position
          and only the fast-scroll thumb is interactive, so neither can
          block normal scrolling or the row action menus.
        -->
        <LibraryFastScroll
          v-if="showScrollTools"
          :scroll-y="scrollY"
          :max-scroll="maxScroll"
        />
        <LibraryScrollTop
          v-if="showScrollTools"
          :scroll-y="scrollY"
        />

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
.library-page {
  width: 100%;
  min-width: 0;
  overflow-x: clip;
  padding-bottom: calc(var(--library-gutter-wide) + var(--sys-safe-bottom));
}

.library-page__shell {
  width: 100%;
  max-width: var(--library-max-width);
  margin-inline: auto;
}

.library-page__content {
  display: flex;
  flex-direction: column;
  gap: var(--library-gutter);
  padding: var(--library-gutter);
}

.library-page__swipe-container {
  position: relative;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  touch-action: pan-y;
}

.library-page__swipe-track {
  display: flex;
  width: 100%;
  align-items: flex-start;
  will-change: transform;
}

.library-page__sentinel {
  width: 100%;
  height: 1px;
}

.library-page__more {
  padding-block: var(--library-gap, 0.75rem);
  text-align: center;
}

.library-page__swipe-pane {
  flex: 0 0 100%;
  width: calc(100vw);
  /* max-width: 100%; */
  min-width: 0;
  box-sizing: border-box;
}

.library-page__swipe-pane.is-inert {
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}

.library-page__swipe-pane.is-active {
  height: auto;
  overflow: visible;
  visibility: visible;
  pointer-events: auto;
}

@media (min-width: 768px) {
  .library-page__content {
    padding-inline: var(--library-gutter-wide);
  }
}

@media (prefers-reduced-motion: reduce) {
  .library-page__swipe-track {
    transition: none !important;
  }
}
</style>
