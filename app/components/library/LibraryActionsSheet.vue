<script setup lang="ts">
export interface LibraryAction {
  id: string
  label: string
  icon: string
  danger?: boolean
}

defineProps<{
  open: boolean
  title: string
  itemLabel: string
  actions: LibraryAction[]
}>()

const emit = defineEmits<{
  close: []
  action: [id: string]
}>()

function choose(id: string) {
  emit('action', id)
  emit('close')
}
</script>

<template>
  <LibrarySheetFrame :open="open" :title="title" :label="`${title} for ${itemLabel}`" @close="emit('close')">
    <p class="library-actions-sheet__item text-small">{{ itemLabel }}</p>
    <div class="library-actions-sheet__list">
      <button
        v-for="action in actions"
        :key="action.id"
        class="library-actions-sheet__action focus-ring"
        :class="{ 'is-danger': action.danger }"
        @click="choose(action.id)"
      >
        <UIcon :name="action.icon" class="library-actions-sheet__icon" aria-hidden="true" />
        <span class="text-small">{{ action.label }}</span>
      </button>
    </div>
  </LibrarySheetFrame>
</template>

<style scoped>
.library-actions-sheet__item { padding: var(--library-control-pad); border-bottom: var(--library-line-width) solid var(--sys-border); color: var(--sys-foreground-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-actions-sheet__list { display: flex; flex-direction: column; }
.library-actions-sheet__action { display: grid; min-height: var(--library-menu-size); grid-template-columns: var(--library-icon-size) minmax(0, 1fr); gap: var(--library-row-gap); align-items: center; padding-inline: var(--library-control-pad); border: 0; border-bottom: var(--library-line-width) solid var(--sys-border); background: transparent; color: var(--sys-foreground); text-align: left; cursor: pointer; }
.library-actions-sheet__action:hover { background: var(--sys-surface-muted); }
.library-actions-sheet__action.is-danger { color: var(--sys-danger); }
.library-actions-sheet__icon { width: var(--library-icon-size); height: var(--library-icon-size); color: var(--sys-foreground-muted); }
.library-actions-sheet__action.is-danger .library-actions-sheet__icon { color: inherit; }
</style>
