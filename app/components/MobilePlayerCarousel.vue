<script setup lang="ts">
// Mobile now-playing carousel — native horizontal scroll snapping keeps
// swiping tactile while the shared player remains the source of truth.
const player = usePlayer()
const {
  queue,
  index,
  isPlaying,
  progressMs,
  progressPct,
  togglePlay,
  playTrack,
  openFullPlayer,
} = player
const { getAlbum, getArtist, formatDuration } = useMusicLibrary()

const scroller = ref<HTMLElement | null>(null)
let settleTimer: ReturnType<typeof setTimeout> | null = null

function coverFor(albumId: string) {
  return getAlbum(albumId)?.cover
}

function artistFor(artistId: string) {
  return getArtist(artistId)?.name ?? ''
}

function elapsedFor(cardIndex: number) {
  return cardIndex === index.value
    ? formatDuration(Math.floor(progressMs.value / 1000))
    : '0:00'
}

function scrollToCurrent(behavior: ScrollBehavior = 'smooth') {
  const element = scroller.value
  if (!element || index.value < 0) return
  const card = element.querySelector<HTMLElement>(`[data-queue-index="${index.value}"]`)
  if (!card) return
  const left = card.offsetLeft - (element.clientWidth - card.offsetWidth) / 2
  element.scrollTo({ left, behavior })
}

function settleOnNearestCard() {
  const element = scroller.value
  if (!element) return
  const cards = [...element.querySelectorAll<HTMLElement>('[data-queue-index]')]
  if (!cards.length) return

  const viewportCenter = element.scrollLeft + element.clientWidth / 2
  const nearest = cards.reduce((best, card) => {
    const cardDistance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - viewportCenter)
    const bestDistance = Math.abs(best.offsetLeft + best.offsetWidth / 2 - viewportCenter)
    return cardDistance < bestDistance ? card : best
  })
  const nextIndex = Number(nearest.dataset.queueIndex)
  const item = queue.value[nextIndex]

  if (item && nextIndex !== index.value) {
    playTrack(item.track, item.context)
  }
}

function onScroll() {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(settleOnNearestCard, 110)
}

function toggleCard(cardIndex: number) {
  const item = queue.value[cardIndex]
  if (!item) return
  if (cardIndex === index.value) togglePlay()
  else playTrack(item.track, item.context)
}

watch(index, async () => {
  await nextTick()
  scrollToCurrent()
})

watch(() => queue.value.length, async () => {
  await nextTick()
  scrollToCurrent('auto')
})

onMounted(async () => {
  await nextTick()
  scrollToCurrent('auto')
})

onBeforeUnmount(() => {
  if (settleTimer) clearTimeout(settleTimer)
})
</script>

<template>
  <section class="mobile-player-carousel" aria-label="Now playing queue">
    <div
      ref="scroller"
      class="mobile-player-carousel__track no-scrollbar"
      @scroll.passive="onScroll"
    >
      <article
        v-for="(item, cardIndex) in queue"
        :key="`${item.track.id}-${cardIndex}`"
        class="mobile-player-card mobile-liquid-surface"
        :class="cardIndex === index ? 'mobile-player-card--active' : ''"
        :data-queue-index="cardIndex"
        :aria-label="`${item.track.title} by ${artistFor(item.track.artistId)}`"
      >
        <img
          v-if="coverFor(item.track.albumId)"
          :src="coverFor(item.track.albumId)"
          alt=""
          class="mobile-player-card__ambient"
          aria-hidden="true"
        >

        <div class="relative z-[1] flex items-center gap-3 min-w-0">
          <button
            type="button"
            class="shrink-0 rounded-[14px] overflow-hidden focus-ring"
            :aria-label="`Open full player for ${item.track.title}`"
            @click="cardIndex === index ? openFullPlayer() : playTrack(item.track, item.context)"
          >
            <Artwork
              :src="coverFor(item.track.albumId)"
              :alt="item.track.title"
              :seed="item.track.id"
              class="w-[52px] h-[52px]"
              rounded
            />
          </button>

          <button
            type="button"
            class="min-w-0 flex-1 text-left focus-ring"
            :aria-label="`Open full player for ${item.track.title}`"
            @click="cardIndex === index ? openFullPlayer() : playTrack(item.track, item.context)"
          >
            <span class="flex items-center gap-2 min-w-0">
              <span
                v-if="cardIndex === index"
                class="text-[8px] leading-none font-bold tracking-[0.16em] text-primary shrink-0"
              >
                NOW PLAYING
              </span>
              <span v-else class="text-[8px] leading-none font-bold tracking-[0.16em] text-fg-faint shrink-0">
                IN QUEUE
              </span>
              <span class="h-px bg-line/70 flex-1" aria-hidden="true" />
            </span>
            <span class="mt-0.5 block text-[13px] leading-5 font-semibold text-fg truncate">
              {{ item.track.title }}
            </span>
            <span class="block text-[11px] leading-4 text-fg-muted truncate">
              {{ artistFor(item.track.artistId) }}
            </span>
            <span class="mt-0.5 flex items-center gap-2 text-[9px] leading-none font-semibold tracking-[0.08em] text-fg-faint tnum">
              <span>{{ elapsedFor(cardIndex) }} / {{ formatDuration(item.track.duration) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ String(cardIndex + 1).padStart(2, '0') }} / {{ String(queue.length).padStart(2, '0') }}</span>
            </span>
          </button>

          <button
            type="button"
            class="mobile-player-card__play shrink-0 grid place-items-center rounded-full bg-primary text-primary-fg focus-ring pressable"
            :aria-label="cardIndex === index && isPlaying ? `Pause ${item.track.title}` : `Play ${item.track.title}`"
            @click="toggleCard(cardIndex)"
          >
            <UIcon
              :name="cardIndex === index && isPlaying ? 'lucide:pause' : 'lucide:play'"
              class="w-4 h-4"
            />
          </button>
        </div>

        <div class="mobile-player-card__progress" aria-hidden="true">
          <span
            class="block h-full bg-primary"
            :style="{ width: cardIndex === index ? `${progressPct}%` : '0%' }"
          />
        </div>
      </article>
    </div>
  </section>
</template>
