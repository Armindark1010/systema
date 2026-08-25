<script setup lang="ts">
// ============================================================
// LibraryHeader — archive toolbar: count · search · sort · view
// ============================================================

import type { LibrarySort, ViewMode } from '~/types'

const props = withDefaults(defineProps<{
  title: string
  count: string
  queryModel: string
  sortModel: LibrarySort
  viewModel: ViewMode
  showViewToggle?: boolean
}>(), { showViewToggle: true })

const emit = defineEmits<{
  'update:queryModel': [v: string]
  'update:sortModel': [v: LibrarySort]
  'update:viewModel': [v: ViewMode]
}>()

const sortOptions: { value: LibrarySort; label: string }[] = [
  { value: 'title', label: 'TITLE' },
  { value: 'artist', label: 'ARTIST' },
  { value: 'album', label: 'ALBUM' },
  { value: 'duration', label: 'DURATION' },
  { value: 'plays', label: 'MOST PLAYED' },
  { value: 'added', label: 'DATE ADDED' },
]
</script>

<template>
  <header class="sys-container mt-6 md:mt-10">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 hairline-b pb-4">
      <div class="flex items-baseline gap-4">
        <h1 class="text-h1 font-bold tracking-tight text-fg">{{ title }}</h1>
        <span class="label tnum text-fg-faint">{{ count }}</span>
      </div>

      <div class="flex items-center gap-3">
        <!-- search -->
        <label class="relative block w-56 lg:w-72">
          <span class="sr-only">Search {{ title.toLowerCase() }}</span>
          <UIcon name="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-faint pointer-events-none" />
          <input
            :value="queryModel"
            type="search"
            class="sys-input !pl-8 !h-8 text-small"
            :placeholder="`SEARCH ${title.toUpperCase()}`"
            @input="emit('update:queryModel', ($event.target as HTMLInputElement).value)"
          >
        </label>

        <!-- sort -->
        <label class="relative">
          <span class="sr-only">Sort by</span>
          <select
            :value="sortModel"
            class="h-8 pl-3 pr-8 text-small font-semibold tracking-wide bg-surface border border-line text-fg-muted hover:(border-line-strong text-fg) t-col focus-ring appearance-none cursor-pointer"
            @change="emit('update:sortModel', ($event.target as HTMLSelectElement).value as LibrarySort)"
          >
            <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <UIcon name="lucide:chevron-down" class="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-faint pointer-events-none" />
        </label>

        <!-- view toggle -->
        <div v-if="showViewToggle" class="flex border border-line" role="group" aria-label="View mode">
          <button
            class="w-8 h-8 grid place-items-center t-col focus-ring"
            :class="viewModel === 'list' ? 'bg-primary-muted text-primary' : 'text-fg-muted hover:text-fg'"
            aria-label="List view"
            :aria-pressed="viewModel === 'list'"
            @click="emit('update:viewModel', 'list')"
          >
            <UIcon name="lucide:list" class="w-4 h-4" />
          </button>
          <button
            class="w-8 h-8 grid place-items-center t-col focus-ring border-l border-line"
            :class="viewModel === 'grid' ? 'bg-primary-muted text-primary' : 'text-fg-muted hover:text-fg'"
            aria-label="Grid view"
            :aria-pressed="viewModel === 'grid'"
            @click="emit('update:viewModel', 'grid')"
          >
            <UIcon name="lucide:layout-grid" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
