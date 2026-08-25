<script setup lang="ts">
const props = defineProps<{ modelValue: string; isSearching?: boolean; isSemantic?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: []; clear: [] }>()
const inputRef = ref<HTMLInputElement | null>(null)

function onInput(event: Event) { emit('update:modelValue', (event.target as HTMLInputElement).value) }
function onClear() { emit('clear'); emit('update:modelValue', ''); inputRef.value?.focus() }
function onSubmit() { emit('submit'); inputRef.value?.blur() }
onMounted(() => nextTick(() => inputRef.value?.focus()))
</script>

<template>
  <div class="w-full px-4 py-4 sm:px-6">
    <p class="mb-2 text-micro font-bold tracking-[0.16em] text-fg-muted">SEARCH MUSIC, ARTISTS, ALBUMS, GENRES...</p>
    <form class="flex h-14 w-full items-center gap-3 border border-line-strong bg-surface px-4 text-fg shadow-1 transition-colors focus-within:border-primary focus-within:bg-base" role="search" @submit.prevent="onSubmit">
      <UIcon v-if="isSearching" name="lucide:loader-2" class="h-5 w-5 flex-none animate-spin text-primary" aria-hidden="true" />
      <UIcon v-else :name="isSemantic ? 'lucide:sparkles' : 'lucide:search'" class="h-5 w-5 flex-none" :class="isSemantic ? 'text-primary' : 'text-fg-muted'" aria-hidden="true" />
      <input ref="inputRef" :value="modelValue" type="search" class="h-full min-w-0 flex-1 bg-transparent text-body font-medium text-fg outline-none placeholder:text-fg-muted" placeholder="Search music, artists, albums, genres..." aria-label="Search music, artists, albums, genres" autofocus autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" @input="onInput">
      <span v-if="isSemantic" class="hidden items-center gap-1 border border-line bg-primary-muted px-2 py-1 text-micro font-bold tracking-[0.1em] text-primary sm:inline-flex"><UIcon name="lucide:sparkles" class="h-3 w-3" />AI</span>
      <button v-if="modelValue" type="button" class="grid h-9 w-9 flex-none place-items-center border border-line bg-surface-muted text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-ring" aria-label="Clear search" @click="onClear"><UIcon name="lucide:x" class="h-4 w-4" /></button>
    </form>
  </div>
</template>
