<script setup lang="ts">
// Desktop keeps the global command palette. Mobile presents the same search
// architecture as a dedicated, full-screen workspace.
import { pageIndex, isSemanticQuery } from '~/data/search'
import { useSettingsStore } from '~/stores/settings'

const { open, query, closePalette } = useQuickSearch()
const search = useSearch()
const { paletteResults } = search
const { playTrack } = usePlayer()
const { getArtist, tracks, recentlyPlayed } = useMusicLibrary()
const isMobile = useMediaQuery('(max-width: 1023px)')

const mobileOverlay = ref<HTMLElement | null>(null)
const mobileInput = ref<HTMLInputElement | null>(null)
const mobileOverlayOpen = computed(() => isMobile.value && open.value)
const desktopOpen = computed({
  get: () => open.value && !isMobile.value,
  set: (value: boolean) => {
    if (!value) closePalette()
    else if (!isMobile.value) open.value = true
  },
})
const recentItems = computed(() => recentlyPlayed(4))

// The command palette state is intentionally shared with the catalog search
// so desktop suggestions, mobile results, and submitted routes stay aligned.
watch(query, value => (search.query.value = value), { immediate: true })

type Handler = () => void
const handlers = new Map<string, Handler>()

function selectTrack(id: string) {
  const track = tracks.value.find(item => item.id === id)
  if (!track) return
  playTrack(track, 'QUICK SEARCH')
  closePalette()
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
  handlers.clear()
  const q = query.value.trim()
  const result: Group[] = []

  if (q) {
    if (isSemanticQuery(q) && useSettingsStore().ai.enabled) {
      const id = 'ai-search'
      register(id, () => {
        closePalette()
        navigateTo(`/ai/search?q=${encodeURIComponent(q)}`)
      })
      result.push({
        id: 'ai',
        label: 'AI SEARCH',
        items: [{
          id,
          label: 'Semantic search in your library',
          description: `“${q}”`,
          icon: 'lucide:sparkles',
          keywords: [q],
        }],
      })
    }

    if (paletteResults.value.length) {
      result.push({
        id: 'results',
        label: 'RESULTS',
        items: paletteResults.value.map((item) => {
          const id = `${item.type}:${item.id}`
          if (item.type === 'track') {
            register(id, () => selectTrack(item.id))
          } else if (item.type === 'album') {
            register(id, () => {
              closePalette()
              navigateTo(`/library/albums?album=${item.id}`)
            })
          } else if (item.type === 'artist') {
            register(id, () => {
              closePalette()
              navigateTo(`/library/artists?artist=${item.id}`)
            })
          } else if (item.type === 'playlist') {
            register(id, () => {
              closePalette()
              navigateTo(`/playlists/${item.id}`)
            })
          }
          return {
            id,
            label: item.title,
            description: item.subtitle,
            icon: iconFor(item.type),
          }
        }),
      })
    }

    if (!result.length) {
      const aiOn = useSettingsStore().ai.enabled
      const id = aiOn ? 'ai-fallback' : 'empty'
      if (aiOn) {
        register(id, () => {
          closePalette()
          navigateTo(`/ai/search?q=${encodeURIComponent(q)}`)
        })
      }
      result.push({
        id: 'empty',
        label: 'NO MATCHES',
        items: [{
          id,
          label: aiOn ? 'Try an AI semantic search' : 'No matches in the archive',
          description: `“${q}”`,
          icon: aiOn ? 'lucide:sparkles' : 'lucide:search',
        }],
      })
    }
  } else {
    result.push({
      id: 'pages',
      label: 'PAGES',
      items: pageIndex.map((page) => {
        register(page.to, () => {
          closePalette()
          navigateTo(page.to)
        })
        return {
          id: page.to,
          label: page.label,
          description: page.description,
          icon: 'lucide:arrow-up-right',
        }
      }),
    })
    result.push({
      id: 'library',
      label: 'FROM YOUR LIBRARY',
      items: recentlyPlayed(5).map(track => {
        register(track.id, () => selectTrack(track.id))
        return {
          id: track.id,
          label: track.title,
          description: getArtist(track.artistId)?.name ?? '',
          icon: 'lucide:music-2',
          suffix: 'RECENT',
        }
      }),
    })
  }

  return result
})

function activate(id?: string) {
  if (id && handlers.has(id)) handlers.get(id)!()
}

function onSelect(item: unknown) {
  activate((item as { id?: string } | null)?.id)
}

function submitMobileSearch() {
  const q = query.value.trim()
  if (!q) {
    mobileInput.value?.focus()
    return
  }
  closePalette()
  search.submit(q)
}

function openAiSearch() {
  const q = query.value.trim()
  closePalette()
  navigateTo(q ? `/ai/search?q=${encodeURIComponent(q)}` : '/ai')
}

function trapOverlayFocus(event: KeyboardEvent) {
  const focusable = mobileOverlay.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )
  if (!focusable?.length) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(mobileOverlayOpen, async (active) => {
  if (active) {
    await nextTick()
    mobileInput.value?.focus()
  }

  if (!import.meta.client) return
  document.documentElement.classList.toggle('mobile-search-is-open', active)
})

onBeforeUnmount(() => {
  if (import.meta.client) document.documentElement.classList.remove('mobile-search-is-open')
})
</script>

<template>
  <UCommandPalette
    v-model:open="desktopOpen"
    v-model:search-term="query"
    :groups="groups"
    placeholder="Search tracks, artists, albums… or describe what to hear"
    :ui="{ content: 'bg-surface', groupLabel: 'text-fg-faint', empty: 'py-8 text-center text-sm text-fg-faint' }"
    aria-label="Quick search"
    @update:model-value="onSelect"
  />

  <Teleport to="body">
    <Transition name="mobile-search-overlay">
      <section
        v-if="mobileOverlayOpen"
        ref="mobileOverlay"
        class="mobile-search-overlay lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-search-title"
        @keydown.esc.stop="closePalette()"
        @keydown.tab="trapOverlayFocus"
      >
        <header class="mobile-search-overlay__header">
          <button
            type="button"
            class="mobile-search-overlay__back pressable focus-ring"
            aria-label="Close Search"
            @click="closePalette()"
          >
            <UIcon name="lucide:arrow-left" />
          </button>
          <h1 id="mobile-search-title" class="mobile-search-overlay__title">SEARCH</h1>
          <span class="mobile-search-overlay__index" aria-hidden="true">01</span>
        </header>

        <main class="mobile-search-overlay__body">
          <p class="mobile-search-overlay__eyebrow">FIND A SOUND, FEELING, OR IDEA</p>
          <h2 class="mobile-search-overlay__prompt">
            Search by title, artist,<br>
            mood, or concept.
          </h2>

          <form class="mobile-search-form" role="search" @submit.prevent="submitMobileSearch">
            <UIcon name="lucide:search" class="mobile-search-form__icon" aria-hidden="true" />
            <input
              ref="mobileInput"
              v-model="query"
              type="search"
              name="mobile-search"
              class="mobile-search-form__input focus-ring"
              placeholder="WHAT DO YOU WANT TO HEAR?"
              autocomplete="off"
              enterkeyhint="search"
              aria-label="Search SYSTEMA"
              @keydown.esc="closePalette()"
            >
            <button
              type="submit"
              class="mobile-search-form__submit pressable focus-ring"
              aria-label="Submit Search"
            >
              <UIcon name="lucide:arrow-up-right" />
            </button>
          </form>

          <template v-if="!query.trim()">
            <section class="mobile-search-section" aria-labelledby="mobile-search-recent">
              <div class="mobile-search-section__heading">
                <h3 id="mobile-search-recent">RECENT</h3>
                <span aria-hidden="true">{{ String(recentItems.length).padStart(2, '0') }}</span>
              </div>

              <div v-if="recentItems.length" class="mobile-search-list">
                <button
                  v-for="(track, index) in recentItems"
                  :key="track.id"
                  type="button"
                  class="mobile-search-list__item focus-ring"
                  @click="selectTrack(track.id)"
                >
                  <span class="mobile-search-list__number" aria-hidden="true">
                    {{ String(index + 1).padStart(2, '0') }}
                  </span>
                  <span class="mobile-search-list__copy">
                    <span>{{ track.title }}</span>
                    <small>{{ getArtist(track.artistId)?.name }}</small>
                  </span>
                  <UIcon name="lucide:arrow-up-right" aria-hidden="true" />
                </button>
              </div>
              <p v-else class="mobile-search-empty">NO RECENT LISTENS</p>
            </section>

            <button
              type="button"
              class="mobile-search-ai pressable focus-ring"
              @click="openAiSearch"
            >
              <span>
                <small>SEMANTIC DISCOVERY</small>
                <strong>AI SEARCH</strong>
              </span>
              <span class="mobile-search-ai__mark" aria-hidden="true">
                <UIcon name="lucide:sparkles" />
              </span>
            </button>
          </template>

          <section v-else class="mobile-search-results" aria-label="Search results">
            <template v-for="group in groups" :key="group.id">
              <div class="mobile-search-section__heading">
                <h3>{{ group.label }}</h3>
                <span aria-hidden="true">{{ String(group.items.length).padStart(2, '0') }}</span>
              </div>
              <div class="mobile-search-list">
                <button
                  v-for="(item, index) in group.items"
                  :key="item.id"
                  type="button"
                  class="mobile-search-list__item focus-ring"
                  @click="activate(item.id)"
                >
                  <span class="mobile-search-list__number" aria-hidden="true">
                    {{ String(index + 1).padStart(2, '0') }}
                  </span>
                  <span class="mobile-search-list__copy">
                    <span>{{ item.label }}</span>
                    <small>{{ item.description }}</small>
                  </span>
                  <UIcon :name="item.icon" aria-hidden="true" />
                </button>
              </div>
            </template>
          </section>
        </main>
      </section>
    </Transition>
  </Teleport>
</template>
