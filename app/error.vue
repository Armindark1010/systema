<script setup lang="ts">
// SYSTEMA — error page. Swiss precision even in failure.
const props = defineProps<{ error: { statusCode: number; message?: string } }>()

const code = computed(() => props.error.statusCode || 500)
const label = computed(() => (code.value === 404 ? 'NOT FOUND' : 'SYSTEM ERROR'))
</script>

<template>
  <div class="min-h-dvh bg-base flex flex-col">
    <header class="sys-container pt-6">
      <div class="flex items-baseline justify-between hairline-b pb-3">
        <BrandMark compact />
        <span class="label tnum text-fg-faint">{{ code }}</span>
      </div>
    </header>

    <main class="sys-container flex-1 flex flex-col justify-center py-16">
      <p class="label-muted">ERROR — {{ label }}</p>
      <h1 class="mt-3 text-display-xl font-bold tracking-tight text-fg tnum">{{ code }}</h1>
      <p class="mt-4 text-lead text-fg-muted max-w-[44ch]">
        {{ error.message || 'The system could not resolve this request.' }}
      </p>
      <div class="mt-8 flex gap-3">
        <NuxtLink to="/" class="sys-btn-primary">BACK TO HOME</NuxtLink>
        <button class="sys-btn-outline" @click="clearError({ redirect: '/' })">RETRY</button>
      </div>
    </main>

    <footer class="sys-container pb-8">
      <p class="label text-fg-faint">SYSTEMA — YOUR MUSIC SYSTEM</p>
    </footer>
  </div>
</template>
