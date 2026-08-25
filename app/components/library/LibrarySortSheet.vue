<script setup lang="ts">
import type { LibrarySortKey, LibrarySortOption } from '~/composables/useLibrary'

defineProps<{
  open: boolean
  selected: LibrarySortKey
  options: LibrarySortOption[]
}>()

const emit = defineEmits<{
  close: []
  select: [key: LibrarySortKey]
}>()

function select(key: LibrarySortKey) {
  emit('select', key)
  emit('close')
}
</script>

<template>
  <LibrarySheetFrame :open="open" title="SORT TRACKS" @close="emit('close')">
    <div class="library-sort-options" role="radiogroup" aria-label="Sort tracks">
      <button
        v-for="option in options"
        :key="option.id"
        class="library-sort-option focus-ring"
        :class="{ 'is-selected': selected === option.id }"
        role="radio"
        :aria-checked="selected === option.id"
        @click="select(option.id)"
      >
        <span class="text-small">{{ option.label }}</span>
        <UIcon v-if="selected === option.id" name="lucide:check" class="library-sort-option__check" aria-hidden="true" />
      </button>
    </div>
  </LibrarySheetFrame>
</template>

<style scoped>
.library-sort-options { display: flex; flex-direction: column; }
.library-sort-option { display: flex; min-height: var(--library-menu-size); align-items: center; justify-content: space-between; padding-inline: var(--library-control-pad); border: 0; border-bottom: var(--library-line-width) solid var(--sys-border); background: transparent; color: var(--sys-foreground-muted); text-align: left; cursor: pointer; }
.library-sort-option:hover,
.library-sort-option.is-selected { background: var(--sys-surface-muted); color: var(--sys-foreground); }
.library-sort-option.is-selected { font-weight: 600; }
.library-sort-option__check { width: var(--library-icon-size); height: var(--library-icon-size); color: var(--sys-primary); }
</style>
