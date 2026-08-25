<script setup lang="ts">
import { searchSettings } from '~/data/settings'

const query = ref('')
const results = computed(() => searchSettings(query.value))

function go(to: string) {
  query.value = ''
  navigateTo(to)
}
</script>

<template>
  <div class="settings-search">
    <label class="sr-only" for="settings-search-input">Search settings</label>
    <div class="flex items-center gap-2 h-11 px-3 border border-line bg-surface">
      <UIcon name="lucide:search" class="w-4 h-4 text-fg-muted shrink-0" />
      <input
        id="settings-search-input"
        v-model="query"
        type="search"
        class="min-w-0 flex-1 h-full bg-transparent border-0 outline-none text-small text-fg placeholder:text-fg-muted"
        placeholder="SEARCH SETTINGS"
        autocomplete="off"
        aria-label="Search settings"
      >
      <button
        v-if="query"
        type="button"
        class="pressable focus-ring w-8 h-8 grid place-items-center text-fg-muted"
        aria-label="Clear settings search"
        @click="query = ''"
      >
        <UIcon name="lucide:x" class="w-3.5 h-3.5" />
      </button>
    </div>

    <ul v-if="query.trim()" class="mt-2 border border-line bg-surface divide-y divide-line" role="listbox" aria-label="Settings matches">
      <li v-if="!results.length" class="px-4 py-4 text-small text-fg-muted">
        No settings match “{{ query.trim() }}”.
      </li>
      <li v-for="entry in results" :key="entry.id">
        <button
          type="button"
          class="w-full flex items-start gap-4 px-4 py-3 text-left pressable focus-ring hover:bg-hover"
          @click="go(entry.to)"
        >
          <span class="label text-fg-muted w-24 shrink-0 pt-0.5">{{ entry.categoryLabel }}</span>
          <span class="min-w-0">
            <span class="block text-small font-semibold text-fg">{{ entry.title }}</span>
            <span class="block text-small text-fg-muted mt-0.5">{{ entry.description }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
