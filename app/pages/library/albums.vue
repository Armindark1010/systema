<script setup lang="ts">
// ============================================================
// LIBRARY — ALBUMS · clean archive grid (+ detail panel)
// ============================================================

useHead({ title: 'Library — Albums' })

const route = useRoute()
const lib = useMusicLibrary()
const { albums, query, sortBy, viewMode } = lib
const player = usePlayer()

// selected album from ?album=
const selectedId = computed(() => (typeof route.query.album === 'string' ? route.query.album : null))
const selected = computed(() => (selectedId.value ? lib.getAlbum(selectedId.value) : undefined))
const selectedTracks = computed(() =>
  selected.value ? lib.tracks.value.filter((t) => t.albumId === selected.value!.id) : [],
)

function playSelected() {
  if (selected.value && selectedTracks.value.length) {
    player.playAlbum(selected.value, selectedTracks.value)
  }
}

function updateQuery(v: string) {
  query.value = v
}
function updateSort(v: string) {
  sortBy.value = v as typeof sortBy.value
}
function updateView(v: typeof viewMode.value) {
  viewMode.value = v
}
</script>

<template>
  <div class="pb-14">
    <LibraryHeader
      title="ALBUMS"
      :count="`${albums.length} RELEASES`"
      :query-model="query"
      :sort-model="sortBy"
      :view-model="viewMode"
      @update:query-model="updateQuery"
      @update:sort-model="updateSort"
      @update:view-model="updateView"
    />

    <!-- album detail panel -->
    <div v-if="selected" class="sys-container mt-8">
      <div class="grid md:grid-cols-[220px_1fr] gap-6 border border-line bg-surface p-5 md:p-6">
        <div class="max-w-[220px]">
          <Artwork :src="selected.cover" :alt="selected.title" :seed="selected.id" />
        </div>
        <div class="flex flex-col justify-between gap-4 min-w-0">
          <div>
            <p class="label-muted">ALBUM — {{ selected.year }}</p>
            <h2 class="mt-2 text-h1 font-bold tracking-tight text-fg">{{ selected.title }}</h2>
            <p class="mt-1 text-lead text-fg-muted">{{ lib.getArtist(selected.artistId)?.name }}</p>
            <p class="mt-2 text-small text-fg-faint tnum">{{ selectedTracks.length }} TRACKS</p>
          </div>
          <div class="flex gap-2">
            <button class="sys-btn-primary" :disabled="!selectedTracks.length" @click="playSelected">
              <UIcon name="lucide:play" class="w-4 h-4" /> PLAY ALBUM
            </button>
            <button class="sys-btn-ghost" @click="navigateTo('/library/albums')">
              CLOSE
            </button>
          </div>
        </div>
      </div>
      <div class="mt-4">
        <TrackList :tracks="selectedTracks" :context="selected.title" />
      </div>
    </div>

    <!-- grid / list -->
    <div class="sys-container mt-8">
      <AlbumGrid v-if="viewMode === 'grid'" :albums="albums" @open="(a: any) => navigateTo({ path: '/library/albums', query: { album: a.id } })" />
      <div v-else class="border border-line bg-surface">
        <SearchResult
          v-for="a in albums"
          :key="a.id"
          type="album"
          :title="a.title"
          :subtitle="lib.getArtist(a.artistId)?.name ?? ''"
          :meta="`${a.year}`"
          @click="navigateTo({ path: '/library/albums', query: { album: a.id } })"
        />
      </div>
    </div>
  </div>
</template>
