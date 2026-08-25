<script setup lang="ts">
// ============================================================
// AppShell — the persistent application frame
// ============================================================
// Desktop : fixed sidebar + main column + bottom player bar
// Mobile  : sticky header + content + two-layer fixed dock
//           (floating search above mini player → bottom navigation)
// Global  : command palette, full player, queue drawer
// ============================================================

const route = useRoute()
const { currentTrack, isPlaying, togglePlay } = usePlayer()
const { openPalette } = useQuickSearch()
const showMobileHeader = computed(() => route.meta.hideMobileHeader !== true)

// Connect audio engine to centralized Pinia store
const playerEngine = usePlayerEngine()
onMounted(() => {
  playerEngine.init()
})

// global keyboard: ⌘K / Ctrl+K → palette, Space → play/pause
function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const typing = target.closest('input, textarea, select, [contenteditable="true"]')
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    openPalette()
    return
  }
  if (e.code === 'Space' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    togglePlay()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="min-h-dvh bg-base text-fg">
    <!-- desktop rail -->
    <DesktopSidebar />

    <!-- mobile header -->
    <MobileHeader v-if="showMobileHeader" />

    <!-- main column -->
    <main
      class="lg:pl-[248px] lg:pb-[68px]"
      :class="currentTrack ? 'sys-dock-pad-player' : 'sys-dock-pad'"
    >
      <slot />
    </main>

    <!-- desktop global mini player -->
    <MiniPlayer class="hidden lg:block fixed bottom-0 left-[248px] right-0 z-40 border-t border-line" />

    <!-- mobile dock: floating search above mini player → bottom navigation -->
    <div class="lg:hidden fixed inset-x-0 bottom-0 z-40">
      <MobileDock />
    </div>

    <!-- global overlays -->
    <QuickSearch />
    <FullPlayer />
    <QueueDrawer />
  </div>
</template>
