<script setup lang="ts">
// ============================================================
// SEARCH — normal text search + AI semantic search
// ============================================================

useHead({ title: 'Search' })

const route = useRoute()
const { query, semantic, submit } = useSearch()

// sync from URL ?q=
watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q !== query.value) query.value = String(q)
  },
  { immediate: true },
)

function updateQuery(v: string) {
  query.value = v
}
</script>

<template>
  <div>
    <SmartSearch :model-value="query" :semantic="semantic" @update:model-value="updateQuery" @submit="submit()" />
    <SearchResults />
  </div>
</template>
