<script setup lang="ts">
// ============================================================
// SearchResults — grouped results page sections
// ============================================================

const { query, grouped } = useSearch()
const { aiRecommendations } = useAIInsightsData()

function openAlbum(id: string) {
  navigateTo(`/library/albums?album=${id}`)
}
function openArtist(id: string) {
  navigateTo(`/library/artists?artist=${id}`)
}
function openPlaylist(id: string) {
  navigateTo(`/playlists/${id}`)
}
</script>

<template>
  <div v-if="query.trim()" class="sys-container mt-8 space-y-10 pb-10">
    <!-- AI semantic mode: recommendation strip -->
    <section v-if="grouped.semantic" aria-label="AI recommendations">
      <SectionHeader label="AI SEMANTIC SEARCH" title="What you might want to hear" />
      <div class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AIRecommendationCard
          v-for="rec in aiRecommendations"
          :key="rec.id"
          :rec="rec"
          compact
          @open="navigateTo('/ai/insights')"
        />
      </div>
    </section>

    <!-- tracks -->
    <section v-if="grouped.tracks.length" aria-label="Tracks">
      <SectionHeader label="TRACKS" :to="`/library/tracks?q=${encodeURIComponent(query)}`" />
      <div class="mt-4">
        <TrackList :tracks="grouped.tracks" context="SEARCH" hide-album />
      </div>
    </section>

    <!-- albums -->
    <section v-if="grouped.albums.length" aria-label="Albums">
      <SectionHeader label="ALBUMS" :to="`/library/albums?q=${encodeURIComponent(query)}`" />
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <AlbumCard v-for="al in grouped.albums" :key="al.id" :album="al" @open="(a) => openAlbum(a.id)" />
      </div>
    </section>

    <!-- artists -->
    <section v-if="grouped.artists.length" aria-label="Artists">
      <SectionHeader label="ARTISTS" :to="`/library/artists?q=${encodeURIComponent(query)}`" />
      <div class="mt-4 border border-line bg-surface">
        <SearchResult
          v-for="a in grouped.artists"
          :key="a.id"
          type="artist"
          :title="a.name"
          :subtitle="a.origin"
          @click="openArtist(a.id)"
        />
      </div>
    </section>

    <!-- playlists -->
    <section v-if="grouped.playlists.length" aria-label="Playlists">
      <SectionHeader label="PLAYLISTS" to="/playlists" />
      <div class="mt-4 border border-line bg-surface">
        <SearchResult
          v-for="p in grouped.playlists"
          :key="p.id"
          type="playlist"
          :title="p.title"
          :subtitle="p.description ?? ''"
          :meta="`${p.trackIds.length} TRACKS`"
          @click="openPlaylist(p.id)"
        />
      </div>
    </section>

    <!-- empty -->
    <p v-if="!grouped.semantic && !grouped.tracks.length && !grouped.albums.length && !grouped.artists.length && !grouped.playlists.length" class="py-16 text-center text-small text-fg-faint">
      NO MATCHES FOR “{{ query }}” — TRY AN <NuxtLink class="underline hover:text-primary" :to="`/ai/search?q=${encodeURIComponent(query)}`">AI SEMANTIC SEARCH</NuxtLink>
    </p>
  </div>
</template>
