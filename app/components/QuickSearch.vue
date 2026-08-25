<script setup lang="ts">
// ============================================================
// QuickSearch — global command palette (⌘K / Ctrl+K / mobile bar)
// Access: tracks · artists · albums · playlists · pages · AI
// ============================================================

import { pageIndex, isSemanticQuery } from '~/data/search'

const { open, query, closePalette } = useQuickSearch()
const { paletteResults } = useSearch()
const { playTrack } = usePlayer()
const { getArtist, tracks, recentlyPlayed } = useMusicLibrary()
const isMobile = useMediaQuery('(max-width: 1023px)')

// Keep Nuxt UI's command dialog for desktop. On mobile, only the
// morphing glass input in MobileDock is shown; Enter opens the search page.
const desktopOpen = computed({
  get: () => open.value && !isMobile.value,
  set: (value: boolean) => {
    if (!value) closePalette()
    else if (!isMobile.value) open.value = true
  },
})

type Handler = () => void
const handlers = new Map<string, Handler>()

function selectTrack(id: string) {
  const t = tracks.value.find((x) => x.id === id)
  if (t) {
    playTrack(t, 'QUICK SEARCH')
    open.value = false
  }
}

function register(id: string, fn: Handler) {
  handlers.set(id, fn)
}

function iconFor(type: string): string {
  switch (type) {
    case 'track': return 'lucide:music-2'
    case 'album': return 'lucide:disc-3'
    case 'artist': return 'lucide:mic-vocal'
    case 'playlist': return 'lucide:list-music'
    case 'ai': return 'lucide:sparkles'
    default: return 'lucide:arrow-up-right'
  }
}

interface Item {
  id: string
  label: string
  description: string
  icon: string
  keywords?: string[]
  suffix?: string
}
interface Group {
  id: string
  label: string
  items: Item[]
}

const groups = computed<Group[]>(() => {
  const q = query.value.trim()
  const g: Group[] = []

  if (q) {
    if (isSemanticQuery(q)) {
      const id = 'ai-search'
      register(id, () => {
        open.value = false
        navigateTo(`/ai/search?q=${encodeURIComponent(q)}`)
      })
      g.push({
        id: 'ai',
        label: 'AI SEARCH',
        items: [
          {
            id,
            label: 'Semantic search in your library',
            description: `“${q}”`,
            icon: 'lucide:sparkles',
            keywords: [q],
          },
        ],
      })
    }
    const results = paletteResults.value
    if (results.length) {
      g.push({
        id: 'results',
        label: 'RESULTS',
        items: results.map((r) => {
          const id = `${r.type}:${r.id}`
          if (r.type === 'track') {
            register(id, () => selectTrack(r.id))
          } else if (r.type === 'album') {
            register(id, () => {
              open.value = false
              navigateTo(`/library/albums?album=${r.id}`)
            })
          } else if (r.type === 'artist') {
            register(id, () => {
              open.value = false
              navigateTo(`/library/artists?artist=${r.id}`)
            })
          } else if (r.type === 'playlist') {
            register(id, () => {
              open.value = false
              navigateTo(`/playlists/${r.id}`)
            })
          }
          return { id, label: r.title, description: r.subtitle, icon: iconFor(r.type) }
        }),
      })
    }
    if (!g.length) {
      const id = 'ai-fallback'
      register(id, () => {
        open.value = false
        navigateTo(`/ai/search?q=${encodeURIComponent(q)}`)
      })
      g.push({
        id: 'empty',
        label: 'NO MATCHES',
        items: [
          {
            id,
            label: 'Try an AI semantic search',
            description: `“${q}”`,
            icon: 'lucide:sparkles',
          },
        ],
      })
    }
  } else {
    g.push({
      id: 'pages',
      label: 'PAGES',
      items: pageIndex.map((p) => {
        register(p.to, () => {
          open.value = false
          navigateTo(p.to)
        })
        return { id: p.to, label: p.label, description: p.description, icon: 'lucide:arrow-up-right' }
      }),
    })
    g.push({
      id: 'library',
      label: 'FROM YOUR LIBRARY',
      items: recentlyPlayed().slice(0, 5).map((t) => {
        register(t.id, () => selectTrack(t.id))
        return {
          id: t.id,
          label: t.title,
          description: getArtist(t.artistId)?.name ?? '',
          icon: 'lucide:music-2',
          suffix: 'RECENT',
        }
      }),
    })
  }
  return g
})

function onSelect(item: unknown) {
  const it = item as { id?: string } | null
  if (it?.id && handlers.has(it.id)) handlers.get(it.id)!()
}
</script>

<template>
  <!-- Desktop command dialog -->
  <UCommandPalette
    v-model:open="desktopOpen"
    v-model:search-term="query"
    :groups="groups"
    placeholder="Search tracks, artists, albums… or describe what to hear"
    :ui="{ content: 'bg-surface', groupLabel: 'text-fg-faint', empty: 'py-8 text-center text-sm text-fg-faint' }"
    aria-label="Quick search"
    @update:model-value="onSelect"
  />
</template>
