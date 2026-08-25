<script setup lang="ts">
// ============================================================
// SmartSearch — the search page input with mode detection
// TEXT SEARCH vs AI SEMANTIC — distinct but never confusing.
// ============================================================

const props = defineProps<{ modelValue: string; semantic: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [v: string]; submit: [] }>()

const examples = [
  { label: 'BLINDING LIGHTS', query: 'Blinding Lights', semantic: false },
  { label: 'KAVINSKY', query: 'Kavinsky', semantic: false },
  { label: 'SYSTEMA', query: 'Systema', semantic: false },
  { label: 'DARK MUSIC FOR DRIVING AT NIGHT', query: 'dark music for driving at night', semantic: true },
  { label: 'یه آهنگ غمگین فارسی برای شب', query: 'یه آهنگ غمگین فارسی برای شب', semantic: true },
  { label: 'ENERGETIC MUSIC FOR GYM', query: 'energetic music for gym', semantic: true },
]

function pick(q: string) {
  emit('update:modelValue', q)
  emit('submit')
}
</script>

<template>
  <section class="sys-container mt-6 md:mt-10">
    <form role="search" @submit.prevent="emit('submit')">
      <div class="hairline-b pb-4">
        <div class="flex items-baseline justify-between mb-5">
          <span class="label text-fg-faint">SEARCH THE ARCHIVE</span>
          <!-- mode indicator -->
          <span
            class="inline-flex items-center gap-2 px-2.5 h-6 t-col border"
            :class="semantic ? 'border-ai-primary bg-ai-surface text-ai-fg' : 'border-line bg-muted text-fg-muted'"
          >
            <UIcon :name="semantic ? 'lucide:sparkles' : 'lucide:type'" class="w-3 h-3" />
            <span class="text-[10px] font-bold tracking-[0.16em] uppercase">
              {{ semantic ? 'AI SEMANTIC' : 'TEXT SEARCH' }}
            </span>
          </span>
        </div>

        <div class="flex items-center gap-3">
          <UIcon name="lucide:search" class="w-5 h-5 text-fg-muted shrink-0 hidden sm:block" />
          <input
            :value="modelValue"
            type="search"
            autofocus
            class="flex-1 min-w-0 bg-transparent text-h1 md:text-display font-bold tracking-tight text-fg placeholder:text-fg-faint focus:outline-none border-none"
            :placeholder="semantic ? 'Describe what you want to hear…' : 'Track, artist, album, playlist…'"
            aria-label="Search"
            :lang="semantic ? undefined : 'en'"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
          >
          <button
            type="submit"
            class="shrink-0 sys-btn-primary"
            :class="semantic ? '!bg-ai-primary hover:!bg-ai-secondary !shadow-ai-glow' : ''"
          >
            <UIcon :name="semantic ? 'lucide:sparkles' : 'lucide:search'" class="w-4 h-4" />
            {{ semantic ? 'AI SEARCH' : 'SEARCH' }}
          </button>
        </div>
      </div>
    </form>

    <!-- examples -->
    <div class="mt-5 flex flex-wrap gap-2">
      <button
        v-for="ex in examples"
        :key="ex.label"
        class="h-7 px-3 text-[11px] font-semibold tracking-[0.1em] uppercase border t-all pressable focus-ring"
        :class="[
          ex.semantic ? 'border-ai-line-strong text-ai-fg-muted hover:(border-ai-primary text-ai-fg)' : 'border-line text-fg-muted hover:(border-line-strong text-fg)',
          /[\u0600-\u06FF]/.test(ex.label) ? 'font-persian normal-case' : '',
        ]"
        :lang="/[\u0600-\u06FF]/.test(ex.label) ? 'fa' : undefined"
        @click="pick(ex.query)"
      >
        {{ ex.label }}
      </button>
    </div>
  </section>
</template>
