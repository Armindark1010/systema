<script setup lang="ts">
// ============================================================
// LIBRARY — ARTISTS · structured list (+ detail panel)
// ============================================================

useHead({ title: 'Library — Artists' })

const route = useRoute()
const lib = useMusicLibrary()
const { artists, query } = lib

const selectedId = computed(() => (typeof route.query.artist === 'string' ? route.query.artist : null))
const selected = computed(() => (selectedId.value ? lib.getArtist(selectedId.value) : undefined))
const selectedAlbums = computed(() => (selected.value ? lib.albums.value.filter((a) => a.artistId === selected.value!.id) : []))
const selectedTracks = computed(() =>
  selected.value ? lib.tracks.value.filter((t) => t.artistId === selected.value!.id) : [],
)

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
}

function updateQuery(v: string) {
  query.value = v
}
</script>

<template>
  <div class="pb-14">
    <LibraryHeader
      title="ARTISTS"
      :count="`${artists.length} NAMES`"
      :query-model="query"
      :sort-model="'title'"
      :view-model="'list'"
      :show-view-toggle="false"
      @update:query-model="updateQuery"
      @update:sort-model="() => {}"
    />

    <!-- artist detail -->
    <div v-if="selected" class="sys-container mt-8">
      <div class="border border-line bg-surface p-5 md:p-6">
        <div class="flex flex-col sm:flex-row sm:items-center gap-5">
          <span class="w-16 h-16 shrink-0 grid place-items-center border border-line bg-muted text-title font-bold text-fg tnum">
            {{ initials(selected.name) }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="label-muted">ARTIST — {{ selected.origin }}</p>
            <h2 class="mt-1 text-h1 font-bold tracking-tight text-fg">{{ selected.name }}</h2>
            <p class="mt-1 text-small text-fg-faint tnum">
              {{ selectedTracks.length }} TRACKS · {{ selectedAlbums.length }} ALBUMS
            </p>
          </div>
          <button class="sys-btn-ghost self-start sm:self-center" @click="navigateTo('/library/artists')">CLOSE</button>
        </div>
      </div>

      <div class="mt-6 grid lg:grid-cols-2 gap-6">
        <section aria-label="Albums">
          <p class="label-muted mb-3">DISCOGRAPHY</p>
          <AlbumGrid :albums="selectedAlbums" cols="grid-cols-2 sm:grid-cols-2 xl:grid-cols-3" @open="(a: any) => navigateTo({ path: '/library/albums', query: { album: a.id } })" />
        </section>
        <section aria-label="Tracks">
          <p class="label-muted mb-3">TRACKS</p>
          <TrackList :tracks="selectedTracks" :context="selected.name" hide-album />
        </section>
      </div>
    </div>

    <!-- full list -->
    <div class="sys-container mt-8">
      <ArtistList :artists="artists" @open="(a: any) => navigateTo({ path: '/library/artists', query: { artist: a.id } })" />
    </div>
  </div>
</template>
