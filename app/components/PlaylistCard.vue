<script setup lang="ts">
import type { Playlist } from '~/types'

const props = defineProps<{ playlist: Playlist }>()
const { playPlaylist } = usePlayer()

const kindLabel = computed(() => (props.playlist.kind === 'ai' ? 'AI' : props.playlist.kind === 'system' ? 'SYSTEM' : 'USER'))
</script>

<template>
  <article class="group t-col pressable focus-ring">
    <NuxtLink :to="`/playlists/${playlist.id}`" class="block" :aria-label="`Playlist ${playlist.title}`">
      <div class="relative">
        <Artwork :src="playlist.cover" :alt="playlist.title" :seed="playlist.id" rounded />
        <span
          class="absolute top-2 left-2 h-5 px-2 inline-flex items-center text-[9px] font-bold tracking-[0.16em] uppercase border"
          :class="playlist.kind === 'ai' ? 'border-ai-line-strong bg-ai-base/80 text-ai-fg' : 'border-line bg-surface/85 text-fg-muted backdrop-blur-sm'"
        >
          {{ kindLabel }}
        </span>
        <span
          class="absolute right-2 bottom-2 w-9 h-9 grid place-items-center bg-primary text-primary-fg opacity-0 translate-y-1 group-hover:(opacity-100 translate-y-0) t-all"
          role="button"
          :aria-label="`Play playlist ${playlist.title}`"
          tabindex="0"
          @click.prevent="playPlaylist(playlist)"
          @keydown.enter.prevent="playPlaylist(playlist)"
          @keydown.space.prevent="playPlaylist(playlist)"
        >
          <UIcon name="lucide:play" class="w-4 h-4" />
        </span>
      </div>
      <div class="mt-2.5">
        <p class="text-[13px] font-semibold text-fg truncate">{{ playlist.title }}</p>
        <p class="text-[11.5px] text-fg-muted truncate">{{ playlist.trackIds.length }} TRACKS</p>
      </div>
    </NuxtLink>
  </article>
</template>
