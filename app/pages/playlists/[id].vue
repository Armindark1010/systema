<script setup lang="ts">
// ============================================================
// PLAYLIST DETAIL — view / edit / reorder / import / export
// ============================================================

const route = useRoute()
const pl = usePlaylists()
const toast = useToast()

const id = computed(() => String(route.params.id))
const playlist = computed(() => pl.getPlaylist(id.value))

useHead({ title: computed(() => playlist.value ? `Playlist — ${playlist.value.title}` : 'Playlist') })

const editOpen = ref(false)
const importOpen = ref(false)
const exportOpen = ref(false)
const deleteOpen = ref(false)
const editTitle = ref('')
const editDescription = ref('')

function openEdit() {
  if (!playlist.value) return
  editTitle.value = playlist.value.title
  editDescription.value = playlist.value.description ?? ''
  editOpen.value = true
}

function saveEdit() {
  if (!playlist.value || !editTitle.value.trim()) return
  pl.updatePlaylist(playlist.value.id, {
    title: editTitle.value.trim().toUpperCase(),
    description: editDescription.value.trim() || undefined,
  })
  toast.add({ title: 'Playlist updated', icon: 'lucide:check' })
  editOpen.value = false
}

function confirmDelete() {
  if (!playlist.value) return
  pl.deletePlaylist(playlist.value.id)
  toast.add({ title: 'Playlist deleted', description: playlist.value.title, icon: 'lucide:trash-2' })
  deleteOpen.value = false
  navigateTo('/playlists')
}

function onRemove(trackId: string) {
  pl.removeTrack(id.value, trackId)
  toast.add({ title: 'Track removed', icon: 'lucide:trash-2' })
}
</script>

<template>
  <div class="pb-14">
    <PlaylistView
      v-if="playlist"
      :playlist="playlist"
      @edit="openEdit"
      @import="importOpen = true"
      @export="exportOpen = true"
      @remove="() => deleteOpen = true"
    />
    <div v-else class="sys-container pt-16">
      <EmptyState label="PLAYLIST NOT FOUND" action-label="ALL PLAYLISTS" to="/playlists">
        This playlist does not exist in the archive — it may have been deleted.
      </EmptyState>
    </div>

    <!-- edit modal -->
    <UModal
      v-model:open="editOpen"
      :ui="{ width: 'max-w-[480px]', content: 'bg-surface text-fg' }"
      title="EDIT PLAYLIST"
      description="TITLE + DESCRIPTION"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="saveEdit">
          <label class="block">
            <span class="label-muted">TITLE</span>
            <input v-model="editTitle" type="text" class="sys-input mt-2" autofocus>
          </label>
          <label class="block">
            <span class="label-muted">DESCRIPTION</span>
            <input v-model="editDescription" type="text" class="sys-input mt-2">
          </label>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="sys-btn-ghost" @click="editOpen = false">CANCEL</button>
            <button type="submit" class="sys-btn-primary" :disabled="!editTitle.trim()">SAVE</button>
          </div>
        </form>
      </template>
    </UModal>

    <!-- delete confirm -->
    <UModal
      v-model:open="deleteOpen"
      :ui="{ width: 'max-w-[420px]', content: 'bg-surface text-fg' }"
      title="DELETE PLAYLIST"
      description="THIS CANNOT BE UNDONE"
    >
      <template #body>
        <p class="text-small text-fg-muted">
          Delete <strong class="text-fg">{{ playlist?.title }}</strong> from the archive?
        </p>
        <div class="flex justify-end gap-2 mt-6">
          <button class="sys-btn-ghost" @click="deleteOpen = false">CANCEL</button>
          <button class="sys-btn-primary !bg-danger hover:!bg-danger" @click="confirmDelete">
            <UIcon name="lucide:trash-2" class="w-4 h-4" /> DELETE
          </button>
        </div>
      </template>
    </UModal>

    <PlaylistImport :open="importOpen" @update:open="v => importOpen = v" />
    <PlaylistExport :open="exportOpen" :playlist-id="playlist?.id" :playlist-title="playlist?.title" @update:open="v => exportOpen = v" />
  </div>
</template>
