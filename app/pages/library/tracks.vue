<script setup lang="ts">
// ============================================================
// LIBRARY — TRACKS · the structured archive list
// ============================================================

useHead({ title: 'Library — Tracks' })

const route = useRoute()
const lib = useMusicLibrary()
const { tracks, query, sortBy, viewMode } = lib

// sync from ?q=
watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q !== query.value) query.value = String(q)
  },
  { immediate: true },
)

const empty = computed(() => tracks.value.length === 0)

function updateQuery(v: string) {
  query.value = v
}
function updateSort(v: string) {
  sortBy.value = v as typeof sortBy.value
}
</script>

<template>
  <div class="pb-14">
    <LibraryHeader
      title="TRACKS"
      :count="`${tracks.length} ITEMS`"
      :query-model="query"
      :sort-model="sortBy"
      :view-model="viewMode"
      :show-view-toggle="false"
      @update:query-model="updateQuery"
      @update:sort-model="updateSort"
    />
    <div class="sys-container mt-6">
      <TrackList v-if="!empty" :tracks="tracks" context="LIBRARY — TRACKS" />
      <EmptyState v-else label="NO MATCHES" action-label="CLEAR SEARCH" to="/library/tracks">
        Nothing in the archive matches “{{ query }}”. Try an AI semantic search instead.
      </EmptyState>
    </div>
  </div>
</template>
