<script setup lang="ts">
// ============================================================
// AppShell — the persistent application frame
// ============================================================
// Desktop : fixed sidebar + main column + bottom player bar
// Mobile  : sticky header + content + fixed dock
//           (quick search → mini player → bottom navigation)
// Global  : command palette, full player, queue drawer
// ============================================================

const { isPlaying, togglePlay } = usePlayer()
const { openPalette } = useQuickSearch()

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
    <MobileHeader />

    <!-- main column -->
    <main class="lg:pl-[248px] sys-dock-pad lg:pb-[68px]">
      <slot />
    </main>

    <!-- desktop global mini player -->
    <MiniPlayer class="hidden lg:block fixed bottom-0 left-[248px] right-0 z-40 border-t border-line" />

    <!-- mobile dock: quick search → mini player → bottom nav -->
    <div class="lg:hidden fixed inset-x-0 bottom-0 z-40">
      <MobileDock />
    </div>

    <!-- global overlays -->
    <QuickSearch />
    <FullPlayer />
    <QueueDrawer />
  </div>
</template>
