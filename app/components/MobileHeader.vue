<script setup lang="ts">
// ------------------------------------------------------------
// Greeting temporarily disabled.
//
// The time-of-day greeting ("GOOD MORNING" / "GOOD AFTERNOON" /
// "GOOD EVENING") and the "YOUR MUSIC SYSTEM" subtitle are commented
// out rather than deleted, so they can be restored by uncommenting
// this block and the matching markup below.
//
// type Greeting = 'GOOD MORNING' | 'GOOD AFTERNOON' | 'GOOD EVENING'
//
// function greetingForHour(hour: number): Greeting {
//   if (hour >= 5 && hour < 12) return 'GOOD MORNING'
//   if (hour >= 12 && hour < 18) return 'GOOD AFTERNOON'
//   return 'GOOD EVENING'
// }
//
// const greeting = useState<Greeting>(
//   'mobile-header-greeting',
//   () => greetingForHour(new Date().getHours()),
// )
//
// let greetingTimer: ReturnType<typeof setInterval> | undefined
//
// function updateGreeting() {
//   greeting.value = greetingForHour(new Date().getHours())
// }
//
// onMounted(() => {
//   updateGreeting()
//   greetingTimer = setInterval(updateGreeting, 60_000)
// })
//
// onBeforeUnmount(() => {
//   if (greetingTimer) clearInterval(greetingTimer)
// })
// ------------------------------------------------------------
</script>

<template>
  <!--
    The camera / status-bar inset is applied once at the app root
    (app.vue, .app-safe-top) so it covers every page, including the
    ones that hide this header. Nothing cutout-related belongs here.
  -->
  <header class="lg:hidden sticky top-0 z-30 bg-base px-4 pt-3 pb-3">
    <div class="sys-panel rounded-3 shadow-1 px-5 py-5">
      <div class="flex items-center justify-between">
        <BrandMark compact />

        <NuxtLink
          to="/settings"
          class="pressable focus-ring w-7 h-7 grid place-items-center text-fg-muted hover:text-fg"
          aria-label="Settings"
        >
          <UIcon name="lucide:sliders-horizontal" class="w-4 h-4" />
        </NuxtLink>
      </div>

      <!--
        Greeting + subtitle intentionally commented out (see script).

        <div class="mt-6">
          <p class="text-h2 font-semibold text-fg" aria-live="polite">
            {{ greeting }}
          </p>
          <p class="mt-2 label text-fg">
            YOUR MUSIC SYSTEM
          </p>
        </div>
      -->
    </div>
  </header>
</template>
