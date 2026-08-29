<script setup lang="ts">
// ============================================================
// PLAYLISTS — archive + create / import / export
// ============================================================

useHead({ title: 'Playlists' })

const pl = usePlaylists()
const player = usePlayer()
const history = usePlaybackHistory()
const { playlists } = pl
const toast = useToast()

const favoriteCount = computed(() => player.favorites.value.size)
const recentsCount = computed(() => history.recentTrackIds.value.length)

const createOpen = ref(false)
const importOpen = ref(false)
const exportOpen = ref(false)
const newTitle = ref('')
const newDescription = ref('')

function onCreate() {
  if (!newTitle.value.trim()) return
  const created = pl.createPlaylist(newTitle.value.trim().toUpperCase(), newDescription.value.trim() || undefined)
  toast.add({ title: 'Playlist created', description: created.title, icon: 'lucide:check' })
  createOpen.value = false
  newTitle.value = ''
  newDescription.value = ''
  navigateTo(`/playlists/${created.id}`)
}
</script>

<template>
  <div class="pb-14">
    <header class="sys-container mt-6 md:mt-10">
      <div class="flex flex-wrap items-end justify-between gap-4 hairline-b pb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-h1 font-bold tracking-tight text-fg">PLAYLISTS</h1>
          <span class="label tnum text-fg-faint">{{ playlists.length }} SETS</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="sys-btn-ghost" @click="importOpen = true">
            <UIcon name="lucide:file-input" class="w-3.5 h-3.5" /> IMPORT
          </button>
          <button class="sys-btn-ghost" @click="exportOpen = true">
            <UIcon name="lucide:file-output" class="w-3.5 h-3.5" /> EXPORT
          </button>
          <button class="sys-btn-primary" @click="createOpen = true">
            <UIcon name="lucide:plus" class="w-4 h-4" /> CREATE PLAYLIST
          </button>
        </div>
      </div>
    </header>

    <!-- Primary System Playlists (Favorites & Recents) -->
    <div class="sys-container mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
      <!-- FAVORITES (Red Border, Small Rectangular Card) -->
      <NuxtLink
        to="/playlists/favorites"
        class="group relative flex items-center justify-between p-3.5 sm:p-4 bg-surface/80 hover:bg-surface border border-red-500/50 hover:border-red-500 rounded-sm transition-all duration-200 focus-ring pressable shadow-sm"
      >
        <div class="flex items-center gap-3.5 min-w-0">
          <div class="w-10 h-10 rounded-sm bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 group-hover:scale-105 group-hover:bg-red-500/15 transition-all flex-shrink-0">
            <UIcon name="lucide:heart" class="w-5 h-5 fill-current" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-bold tracking-wider text-fg group-hover:text-red-400 transition-colors uppercase truncate">
              FAVORITES
            </h2>
            <p class="text-[11px] text-fg-muted font-mono tracking-wider uppercase mt-0.5">
              {{ favoriteCount }} TRACKS
            </p>
          </div>
        </div>
        <div class="flex items-center text-fg-faint group-hover:text-red-400 group-hover:translate-x-0.5 transition-all">
          <UIcon name="lucide:chevron-right" class="w-4 h-4" />
        </div>
      </NuxtLink>

      <!-- RECENTS (Small Rectangular Card) -->
      <NuxtLink
        to="/playlists/recents"
        class="group relative flex items-center justify-between p-3.5 sm:p-4 bg-surface/80 hover:bg-surface border border-line hover:border-line-strong rounded-sm transition-all duration-200 focus-ring pressable shadow-sm"
      >
        <div class="flex items-center gap-3.5 min-w-0">
          <div class="w-10 h-10 rounded-sm bg-primary/10 border border-primary/25 flex items-center justify-center text-primary group-hover:scale-105 group-hover:bg-primary/15 transition-all flex-shrink-0">
            <UIcon name="lucide:clock-3" class="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-bold tracking-wider text-fg group-hover:text-primary transition-colors uppercase truncate">
              RECENTS
            </h2>
            <p class="text-[11px] text-fg-muted font-mono tracking-wider uppercase mt-0.5">
              {{ recentsCount }} TRACKS
            </p>
          </div>
        </div>
        <div class="flex items-center text-fg-faint group-hover:text-primary group-hover:translate-x-0.5 transition-all">
          <UIcon name="lucide:chevron-right" class="w-4 h-4" />
        </div>
      </NuxtLink>
    </div>

    <div class="sys-container mt-8">
      <PlaylistList :playlists="playlists" @create="createOpen = true" />
    </div>

    <!-- create modal -->
    <UModal
      v-model:open="createOpen"
      :ui="{ width: 'max-w-[480px]', content: 'bg-surface text-fg' }"
      title="CREATE PLAYLIST"
      description="A NEW SET IN THE ARCHIVE"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="onCreate">
          <label class="block">
            <span class="label-muted">TITLE</span>
            <input v-model="newTitle" type="text" class="sys-input mt-2" placeholder="MY NEW SET" autofocus>
          </label>
          <label class="block">
            <span class="label-muted">DESCRIPTION</span>
            <input v-model="newDescription" type="text" class="sys-input mt-2" placeholder="OPTIONAL — WHAT IS THIS SET?">
          </label>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="sys-btn-ghost" @click="createOpen = false">CANCEL</button>
            <button type="submit" class="sys-btn-primary" :disabled="!newTitle.trim()">CREATE</button>
          </div>
        </form>
      </template>
    </UModal>

    <PlaylistImport :open="importOpen" @update:open="v => importOpen = v" />
    <PlaylistExport :open="exportOpen" @update:open="v => exportOpen = v" />
  </div>
</template>
