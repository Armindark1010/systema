<script setup lang="ts">
// ============================================================
// MiniPlayer — persistent compact player
// Rendered in the mobile dock (above bottom nav) and as the
// desktop bottom bar. Shows while a track is loaded.
// ============================================================

const { currentTrack, isPlaying, togglePlay, progressPct, openFullPlayer, favorites, toggleFavorite } = usePlayer()
const { getAlbum, getArtist } = useMusicLibrary()

const cover = computed(() => (currentTrack.value ? getAlbum(currentTrack.value.albumId)?.cover : undefined))
const artistName = computed(() => (currentTrack.value ? getArtist(currentTrack.value.artistId)?.name : ''))
</script>

<template>
  <div v-if="currentTrack" class="relative bg-player">
    <!-- progress hairline -->
    <div class="absolute top-0 inset-x-0 h-[2px] bg-hover" aria-hidden="true">
      <div class="h-full bg-primary t-all" :style="{ width: progressPct + '%' }" />
    </div>

    <div class="flex items-center gap-3 px-3 md:px-4 h-[60px]">
      <!-- artwork + info — click opens full player -->
      <button
        class="flex items-center gap-3 flex-1 min-w-0 text-left pressable focus-ring py-1"
        :aria-label="`Now playing: ${currentTrack.title} by ${artistName}`"
        @click="openFullPlayer()"
      >
        <Artwork :src="cover" :alt="currentTrack.title" class="w-10 h-10 shrink-0" seed="mini" />
        <span class="min-w-0">
          <span class="flex items-center gap-2">
            <span class="flex gap-[2px] items-end h-3 shrink-0" aria-hidden="true">
              <span v-if="isPlaying" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 0ms" />
              <span v-if="isPlaying" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 180ms" />
              <span v-if="isPlaying" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 320ms" />
            </span>
            <span class="text-[13px] font-semibold text-fg truncate">{{ currentTrack.title }}</span>
          </span>
          <span class="block text-[12px] text-fg-muted truncate">{{ artistName }}</span>
        </span>
      </button>

      <button
        class="pressable focus-ring w-8 h-8 grid place-items-center shrink-0 t-col"
        :class="favorites.has(currentTrack.id) ? 'text-primary' : 'text-fg-faint hover:text-fg'"
        :aria-label="favorites.has(currentTrack.id) ? 'Remove from favorites' : 'Add to favorites'"
        @click.stop="toggleFavorite()"
      >
        <UIcon :name="favorites.has(currentTrack.id) ? 'lucide:heart' : 'lucide:heart'" class="w-4 h-4" />
      </button>

      <button
        class="w-9 h-9 shrink-0 grid place-items-center bg-primary text-primary-fg hover:bg-primary-strong t-all pressable focus-ring"
        :aria-label="isPlaying ? 'Pause' : 'Play'"
        @click.stop="togglePlay()"
      >
        <UIcon :name="isPlaying ? 'lucide:pause' : 'lucide:play'" class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
