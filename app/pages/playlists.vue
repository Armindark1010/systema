<script setup lang="ts">
// ============================================================
// PLAYLISTS — archive + create / import / export
// ============================================================

useHead({ title: 'Playlists' })

const pl = usePlaylists()
const { playlists } = pl
const toast = useToast()

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

    <PlaylistImport :open="importOpen" @update:open="(v: boolean) => (importOpen = v)" />
    <PlaylistExport :open="exportOpen" :playlist-title="playlists[0]?.title" @update:open="(v: boolean) => (exportOpen = v)" />
  </div>
</template>
