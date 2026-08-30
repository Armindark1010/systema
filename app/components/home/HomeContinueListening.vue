<script setup lang="ts">
import type { ContinueListeningItem } from '~/composables/useContinueListening'

const { items, hasItems, showViewAll, storageEngineInfo, isDurableRoom, resumeSession, removeSession } = useContinueListening()

const openMenuId = ref<string | null>(null)

function openMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function removeItem(id: string) {
  removeSession(id)
  openMenuId.value = null
}
function resetProgress(id: string) {
  // Optional: reset listened ranges for this session
  openMenuId.value = null
}
</script>

<template>
  <section v-if="hasItems" aria-labelledby="home-continue-title">
    <h2 id="home-continue-title" class="sr-only">Continue Listening</h2>
    <div class="flex items-center justify-between">
      <SectionHeader
        label="CONTINUE LISTENING"
        :to="showViewAll ? '/playlists' : undefined"
      />
      <!-- Temporary diagnostic badge for Room SQLite vs LocalStorage -->
      <span
        v-if="storageEngineInfo"
        class="text-[9px] font-mono tracking-wider px-2 py-0.5 rounded border"
        :class="isDurableRoom ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line bg-surface text-fg-faint'"
      >
        ● {{ isDurableRoom ? 'ROOM SQLITE (v6)' : 'LOCALSTORAGE' }}
      </span>
    </div>

    <div
      class="mt-4 flex gap-3.5 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth pb-2"
      role="list"
      aria-label="In-progress playlists to continue"
    >
      <div
        v-for="item in items"
        :key="item.playlist.id"
        class="shrink-0 snap-start w-[270px] sm:w-[290px]"
        role="listitem"
      >
        <div
          class="group block w-full text-left p-3.5 border border-line bg-surface hover:border-fg-muted/60 active:bg-surface-elevated pressable focus-ring transition-colors duration-150 cursor-pointer"
          :class="item.isCurrentlyPlaying ? 'border-primary/60 bg-primary-muted/20' : ''"
          :aria-label="`Resume ${item.playlist.title} at ${item.track.title} by ${item.artistName} from ${item.currentTimeFormatted}`"
          @click="resumeSession(item)"
          role="button"
          tabindex="0"
        >
          <!-- top: artwork + playlist title + track index -->
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-12 h-12 shrink-0 relative overflow-hidden rounded-sm border border-line bg-muted">
              <Artwork
                :src="item.playlist.cover"
                :alt="item.playlist.title"
                :seed="item.playlist.id"
                class="w-full h-full object-cover"
              />
              <span
                v-if="item.isCurrentlyPlaying"
                class="absolute inset-0 bg-primary/20 flex items-center justify-center text-primary backdrop-blur-[1px]"
                aria-hidden="true"
              >
                <UIcon name="lucide:volume-2" class="w-4 h-4 animate-pulse" />
              </span>
            </div>

            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-semibold text-fg truncate uppercase tracking-tight group-hover:text-primary transition-colors">
                {{ item.playlist.title }}
              </p>
              <p class="mt-0.5 text-[10px] font-bold tracking-[0.14em] text-fg-faint uppercase tnum">
                {{ item.trackNumberDisplay }}
              </p>
            </div>

            <div
              class="w-7 h-7 shrink-0 rounded-full border border-line flex items-center justify-center text-fg-muted group-hover:(border-primary bg-primary text-primary-fg) transition-colors"
              aria-hidden="true"
            >
              <UIcon :name="item.isCurrentlyPlaying ? 'lucide:pause' : 'lucide:play'" class="w-3.5 h-3.5 translate-x-[0.5px]" />
            </div>

            <!-- Three-dot menu -->
            <div class="relative shrink-0" @click.stop>
              <button
                type="button"
                class="w-7 h-7 rounded-full border border-line flex items-center justify-center text-fg-muted hover:text-primary hover:border-primary transition-colors"
                aria-label="Playlist options"
                @click="openMenu(item.playlist.id)"
              >
                <UIcon name="lucide:more-vertical" class="w-3.5 h-3.5" />
              </button>
              <div
                v-if="openMenuId === item.playlist.id"
                class="absolute right-0 top-8 z-20 w-48 bg-surface border border-line shadow-xl rounded-md overflow-hidden"
              >
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 text-[11px] hover:bg-primary-muted transition-colors"
                  @click="removeItem(item.playlist.id)"
                >
                  Remove from Continue Listening
                </button>
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 text-[11px] hover:bg-primary-muted transition-colors border-t border-line"
                  @click="resetProgress(item.playlist.id)"
                >
                  Reset Progress
                </button>
              </div>
            </div>
          </div>

          <!-- middle: current track + artist -->
          <div class="mt-3 min-w-0">
            <p class="text-[12.5px] font-medium text-fg truncate group-hover:text-primary transition-colors">
              {{ item.track.title }}
            </p>
            <p class="text-[11px] text-fg-muted truncate mt-0.5">
              {{ item.artistName }}
            </p>
          </div>

          <!-- bottom: delicate progress bar + time/percentage -->
          <div class="mt-3" aria-hidden="true">
            <div class="h-[3px] w-full bg-line/80 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-300 rounded-full"
                :style="{ width: `${item.progressPct}%` }"
              />
            </div>

            <div class="mt-1.5 flex items-center justify-between text-[10.5px] tnum">
              <span class="text-fg-muted">
                {{ item.currentTimeFormatted }} / {{ item.durationFormatted }}
              </span>
              <span class="font-semibold text-primary">
                LISTENED {{ Math.round(item.progressPct) }}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
