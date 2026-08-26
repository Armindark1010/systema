<script setup lang="ts">
// ============================================================
// QueueDrawer — NOW PLAYING + UP NEXT, prepared for drag & drop
// ============================================================

import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const { formatDuration } = useMusicLibrary()

// Canonical resolution shared with every other player surface.
const { artwork: nowPlayingCover } = useNowPlaying()
const { coverFor, artistFor } = useTrackFields()

const upNext = computed(() => player.queue)
</script>

<template>
  <UDrawer
    :model-value="player.queueOpen"
    direction="right"
    :handle="false"
    :ui="{
      content: '!rounded-none w-[380px] max-w-[92vw] bg-surface text-fg flex flex-col',
      overlay: 'bg-base/40 backdrop-blur-sm',
    }"
    @update:model-value="(v: boolean) => player.setQueueOpen(v)"
  >
    <template #body>
      <div class="flex-1 flex flex-col">
        <!-- drawer header -->
        <div class="flex items-center justify-between h-12 px-4 border-b border-line shrink-0">
          <span class="label-muted">QUEUE</span>
          <button
            class="pressable focus-ring w-8 h-8 grid place-items-center text-fg-muted hover:text-fg t-col"
            aria-label="Close queue"
            @click="player.setQueueOpen(false)"
          >
            <UIcon name="lucide:x" class="w-4 h-4" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-4 py-5">
          <!-- now playing -->
          <section v-if="player.currentTrack" aria-label="Now playing" class="mb-8">
            <p class="label-muted mb-3">NOW PLAYING</p>
            <div class="flex items-center gap-4 p-3 border border-line bg-muted">
              <Artwork :src="nowPlayingCover" :alt="player.currentTrack.title" class="w-14 h-14 shrink-0" seed="qnp" />
              <div class="min-w-0 flex-1">
                <p class="text-small font-semibold text-fg truncate">{{ player.currentTrack.title }}</p>
                <p class="text-[12px] text-fg-muted truncate">{{ artistFor(player.currentTrack) }}</p>
              </div>
              <span class="flex gap-[2px] items-end h-3 shrink-0" aria-hidden="true">
                <span v-if="player.isPlaying" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 0ms" />
                <span v-if="player.isPlaying" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 200ms" />
                <span v-if="player.isPlaying" class="sys-eq-bar w-[2px] h-full bg-primary" style="animation-delay: 340ms" />
              </span>
            </div>
          </section>

          <!-- up next -->
          <section aria-label="Up next">
            <p class="label-muted mb-3 flex items-center justify-between">
              UP NEXT
              <span class="label text-fg-faint tnum">{{ upNext.length }} ITEMS</span>
            </p>
            <p v-if="!upNext.length" class="text-small text-fg-faint py-6 text-center">QUEUE EMPTY</p>
            <ul v-else class="divide-y divide-line border border-line">
              <li
                v-for="(item, i) in upNext"
                :key="item.id"
                class="group flex items-center gap-3 px-3 h-12 t-col hover:bg-hover cursor-pointer"
                @click="player.playQueueItem(i)"
              >
                <UIcon name="lucide:grip-vertical" class="w-3.5 h-3.5 text-fg-faint shrink-0" aria-hidden="true" />
                <span class="tnum text-[11px] text-fg-faint w-5 shrink-0 text-right">{{ String(i + 1).padStart(2, '0') }}</span>
                <Artwork :src="coverFor(item)" :alt="item.title" class="w-8 h-8 shrink-0" :seed="item.id" />
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-medium text-fg truncate">{{ item.title }}</p>
                  <p class="text-[11px] text-fg-muted truncate">{{ artistFor(item) }}</p>
                </div>
                <span class="tnum text-[11px] text-fg-faint hidden sm:inline">{{ formatDuration(item.duration) }}</span>
                <button
                  class="pressable focus-ring w-7 h-7 grid place-items-center text-fg-faint opacity-0 group-hover:opacity-100 hover:text-danger t-col"
                  :aria-label="`Remove ${item.title} from queue`"
                  @click.stop="player.removeFromQueue(i)"
                >
                  <UIcon name="lucide:x" class="w-3.5 h-3.5" />
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </UDrawer>
</template>
