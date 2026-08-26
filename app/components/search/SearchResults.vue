<script setup lang="ts">
// ============================================================
// SearchResults — grouped search results view
// ============================================================
// Features:
// - Hierarchical grouped presentation (Tracks, Albums, Artists, Playlists)
// - Direct tap to play tracks without opening Full Player
// - Contextual three-dot actions sheet
// - Clean empty state when no matches found
// ============================================================

import type { Album, Artist, Playlist, Track } from '~/types'
import type { ActionItem } from './SearchActionSheet.vue'
import { useSearchStore } from '~/stores/search'
import { usePlayerStore } from '~/stores/player'

const search = useSearchStore()
const player = usePlayerStore()
const { getAlbum, getArtist, formatDuration } = useMusicLibrary()
const { coverFor } = useTrackFields()
const toast = useToast()
const router = useRouter()

const selectedAction = ref<ActionItem | null>(null)

function trackCover(track: Track) {
  return coverFor(track)
}

function trackArtist(track: Track) {
  return track.artist || getArtist(track.artistId)?.name || 'SYSTEMA'
}

function albumCover(album: Album) {
  return album.cover
}

function albumArtist(album: Album) {
  return getArtist(album.artistId)?.name || 'SYSTEMA'
}

function playlistCover(playlist: Playlist) {
  const firstTrackId = playlist.trackIds[0]
  if (firstTrackId) {
    const track = player.queue.find(t => t.id === firstTrackId)
    if (track) return trackCover(track)
  }
  return playlist.cover
}

function onPlayTrack(track: Track) {
  // CRITICAL REQUIREMENT: Play track immediately via Pinia, do NOT open Full Player!
  player.playTrack(track, 'SEARCH')
  toast.add({
    title: 'Now playing',
    description: track.title,
    icon: 'lucide:play',
  })
}

function onSelectAlbum(album: Album) {
  router.push(`/library/albums?album=${album.id}`)
}

function onSelectArtist(artist: Artist) {
  router.push(`/library/artists?artist=${artist.id}`)
}

function onSelectPlaylist(playlist: Playlist) {
  router.push(`/playlists/${playlist.id}`)
}

function openTrackActions(track: Track) {
  selectedAction.value = { kind: 'track', item: track }
}

function openAlbumActions(album: Album) {
  selectedAction.value = { kind: 'album', item: album }
}

function openArtistActions(artist: Artist) {
  selectedAction.value = { kind: 'artist', item: artist }
}

function openPlaylistActions(playlist: Playlist) {
  selectedAction.value = { kind: 'playlist', item: playlist }
}

function runAction(actionId: string, target: ActionItem) {
  if (target.kind === 'track') {
    const t = target.item
    if (actionId === 'play') onPlayTrack(t)
    else if (actionId === 'play-next') {
      player.addToQueue(t, true)
      toast.add({ title: 'Playing next', description: t.title, icon: 'lucide:skip-forward' })
    } else if (actionId === 'queue') {
      player.addToQueue(t)
      toast.add({ title: 'Added to queue', description: t.title, icon: 'lucide:list-music' })
    } else if (actionId === 'like') {
      player.toggleFavoriteId(t.id)
      toast.add({ title: player.isFavorite(t.id) ? 'Added to favorites' : 'Removed from favorites', icon: 'lucide:heart' })
    } else if (actionId === 'album') {
      router.push(`/library/albums?album=${t.albumId}`)
    } else if (actionId === 'artist') {
      router.push(`/library/artists?artist=${t.artistId}`)
    } else if (actionId === 'info') {
      toast.add({ title: t.title, description: `${trackArtist(t)} · ${formatDuration(t.duration)}`, icon: 'lucide:info' })
    }
  }

  if (target.kind === 'album') {
    const al = target.item
    if (actionId === 'play') onSelectAlbum(al)
    else if (actionId === 'artist') router.push(`/library/artists?artist=${al.artistId}`)
  }

  if (target.kind === 'artist') {
    const ar = target.item
    if (actionId === 'play' || actionId === 'view') onSelectArtist(ar)
  }

  if (target.kind === 'playlist') {
    const pl = target.item
    if (actionId === 'play') onSelectPlaylist(pl)
  }
}
</script>

<template>
  <div class="search-results-shell">
    <!-- No matches state -->
    <SearchNoResults
      v-if="!search.hasResults && search.hasQuery && !search.isSearching"
      :query="search.query"
      @suggestion-click="q => search.setQuery(q)"
    />

    <!-- Grouped results -->
    <div v-else-if="search.hasResults" class="search-results-list">
      <!-- TRACKS SECTION -->
      <section v-if="search.visibleTracks.length" class="search-group" aria-label="Tracks">
        <SearchResultSection title="TRACKS" :count="search.visibleTracks.length" />
        <div class="search-group-items">
          <SearchTrackResult
            v-for="res in search.visibleTracks"
            :key="res.id"
            :result="res"
            :artist-name="trackArtist(res.item)"
            :cover="trackCover(res.item)"
            :duration-formatted="formatDuration(res.item.duration)"
            @play="onPlayTrack"
            @actions="openTrackActions"
          />
        </div>
      </section>

      <!-- ALBUMS SECTION -->
      <section v-if="search.visibleAlbums.length" class="search-group" aria-label="Albums">
        <SearchResultSection title="ALBUMS" :count="search.visibleAlbums.length" />
        <div class="search-group-items">
          <SearchAlbumResult
            v-for="res in search.visibleAlbums"
            :key="res.id"
            :result="res"
            :artist-name="albumArtist(res.item)"
            :cover="albumCover(res.item)"
            @select="onSelectAlbum"
            @actions="openAlbumActions"
          />
        </div>
      </section>

      <!-- ARTISTS SECTION -->
      <section v-if="search.visibleArtists.length" class="search-group" aria-label="Artists">
        <SearchResultSection title="ARTISTS" :count="search.visibleArtists.length" />
        <div class="search-group-items">
          <SearchArtistResult
            v-for="res in search.visibleArtists"
            :key="res.id"
            :result="res"
            @select="onSelectArtist"
            @actions="openArtistActions"
          />
        </div>
      </section>

      <!-- PLAYLISTS SECTION -->
      <section v-if="search.visiblePlaylists.length" class="search-group" aria-label="Playlists">
        <SearchResultSection title="PLAYLISTS" :count="search.visiblePlaylists.length" />
        <div class="search-group-items">
          <SearchPlaylistResult
            v-for="res in search.visiblePlaylists"
            :key="res.id"
            :result="res"
            :cover="playlistCover(res.item)"
            @select="onSelectPlaylist"
            @actions="openPlaylistActions"
          />
        </div>
      </section>
    </div>

    <!-- Contextual actions sheet -->
    <SearchActionSheet
      :target="selectedAction"
      :is-liked="selectedAction?.kind === 'track' ? player.isFavorite(selectedAction.item.id) : false"
      @close="selectedAction = null"
      @action="runAction"
    />
  </div>
</template>

<style scoped>
.search-results-shell {
  width: 100%;
  padding: 0 var(--sys-content-pad, 1rem) 2rem;
}

.search-results-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.search-group {
  display: flex;
  flex-direction: column;
}

.search-group-items {
  display: flex;
  flex-direction: column;
}
</style>
