<script setup lang="ts">
import type { EmoExpression, EmoGaze } from '~/types/emo'
import { emoBehavior } from '~/data/emo'
import { usePlayerStore } from '~/stores/player'

const props = withDefaults(defineProps<{
  expression?: EmoExpression
  isPlaying?: boolean
  bpm?: number
  energy?: number
  mood?: string
  volume?: number
  isThinking?: boolean
  message?: string
}>(), {
  expression: undefined,
  isPlaying: undefined,
  bpm: undefined,
  energy: undefined,
  mood: undefined,
  volume: undefined,
  isThinking: false,
  message: '',
})

const emit = defineEmits<{
  tap: []
  'expression-change': [expression: EmoExpression]
}>()

const player = usePlayerStore()

const blinking = ref(false)
const gaze = ref<EmoGaze>('center')
const mounted = ref(false)

// Effective reactive bindings: use prop override if provided, otherwise consume centralized Pinia player state
const effectiveIsPlaying = computed(() =>
  props.isPlaying !== undefined ? props.isPlaying : player.isPlaying,
)
const effectiveEnergy = computed(() => {
  if (props.energy !== undefined) return props.energy
  return player.currentTrack ? player.currentTrack.energy / 100 : 0.5
})
const effectiveBpm = computed(() => {
  if (props.bpm !== undefined) return props.bpm
  return player.currentTrack?.ai?.bpm ?? 118
})
const effectiveMood = computed(() => {
  if (props.mood !== undefined) return props.mood
  return player.currentTrack?.mood?.toUpperCase() ?? 'FOCUSED'
})

// Transient subtle reactions to player store events
const transientReaction = ref<{ expression: EmoExpression; message: string } | null>(null)
let reactionTimer: ReturnType<typeof setTimeout> | undefined

function setTransient(expression: EmoExpression, message: string, duration = 750) {
  if (reactionTimer) clearTimeout(reactionTimer)
  transientReaction.value = { expression, message }
  reactionTimer = setTimeout(() => {
    transientReaction.value = null
  }, duration)
}

// Watchers on Player Store
watch(
  () => player.currentTrack?.id,
  (newId, oldId) => {
    if (!mounted.value || !newId || newId === oldId) return
    const title = player.currentTrack?.title ?? 'TRACK'
    setTransient('curious', `TRACK · ${title.toUpperCase()}`, 800)
  },
)

watch(
  () => player.isPlaying,
  (playing) => {
    if (!mounted.value || props.isPlaying !== undefined) return
    if (playing) {
      const expr = effectiveEnergy.value >= emoBehavior.music.highEnergy ? 'dancing' : 'listening'
      setTransient(expr, 'PLAYING', 650)
    } else {
      setTransient('idle', 'PAUSED', 650)
    }
  },
)

watch(
  () => player.isShuffle,
  () => {
    if (!mounted.value) return
    setTransient('excited', `SHUFFLE ${player.isShuffle ? 'ON' : 'OFF'}`, 700)
  },
)

// Queue order watcher for subtle reaction
let prevQueueSummary = ''
watch(
  () => player.queue.map(t => t.id).join(','),
  (summary) => {
    if (!mounted.value) {
      prevQueueSummary = summary
      return
    }
    if (prevQueueSummary && summary !== prevQueueSummary) {
      setTransient('thinking', 'QUEUE UPDATED', 700)
    }
    prevQueueSummary = summary
  },
)

const activeExpression = computed<EmoExpression>(() => {
  if (props.isThinking) return 'thinking'
  if (props.expression !== undefined) return props.expression
  if (transientReaction.value?.expression) return transientReaction.value.expression
  if (effectiveIsPlaying.value) {
    return effectiveEnergy.value >= emoBehavior.music.highEnergy ? 'dancing' : 'listening'
  }
  return 'idle'
})

const energyBand = computed(() => {
  if (effectiveEnergy.value >= emoBehavior.music.highEnergy) return 'high'
  if (effectiveEnergy.value <= emoBehavior.music.lowEnergy) return 'low'
  return 'medium'
})

const motion = computed(() => {
  if (activeExpression.value === 'thinking' || activeExpression.value === 'analyzing') return 'idle'
  if (activeExpression.value === 'dancing' || (effectiveIsPlaying.value && energyBand.value === 'high')) return 'dancing'
  if (effectiveIsPlaying.value) return 'listening'
  return 'idle'
})

const companionStyle = computed(() => {
  const beatDuration = emoBehavior.music.secondsPerMinute / Math.max(emoBehavior.music.minimumBpm, effectiveBpm.value)
  return {
    '--emo-beat-duration': `${beatDuration}s`,
    '--emo-beat-duration-double': `${beatDuration * emoBehavior.music.slowBeatMultiplier}s`,
    '--emo-beat-delay-two': `${beatDuration * emoBehavior.music.equalizerPhaseTwo}s`,
    '--emo-beat-delay-three': `${beatDuration * emoBehavior.music.equalizerPhaseThree}s`,
  }
})

const statusText = computed(() => {
  if (props.message) return props.message
  if (transientReaction.value?.message) return transientReaction.value.message
  return `${activeExpression.value.toUpperCase()} · ${effectiveMood.value}`
})

let blinkTimer: ReturnType<typeof setTimeout> | undefined
let blinkEndTimer: ReturnType<typeof setTimeout> | undefined
let doubleBlinkTimer: ReturnType<typeof setTimeout> | undefined
let gazeTimer: ReturnType<typeof setTimeout> | undefined
let gazeResetTimer: ReturnType<typeof setTimeout> | undefined

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function clearBlinkTimers() {
  if (blinkTimer) clearTimeout(blinkTimer)
  if (blinkEndTimer) clearTimeout(blinkEndTimer)
  if (doubleBlinkTimer) clearTimeout(doubleBlinkTimer)
  blinkTimer = undefined
  blinkEndTimer = undefined
  doubleBlinkTimer = undefined
  blinking.value = false
}

function blinkProfile() {
  if (activeExpression.value === 'sleepy') {
    return {
      min: emoBehavior.blink.sleepyMin,
      max: emoBehavior.blink.sleepyMax,
      duration: emoBehavior.blink.sleepyDuration,
    }
  }
  if (activeExpression.value === 'excited' || activeExpression.value === 'dancing') {
    return {
      min: emoBehavior.blink.excitedMin,
      max: emoBehavior.blink.excitedMax,
      duration: emoBehavior.blink.normalDuration,
    }
  }
  if (['thinking', 'analyzing', 'focused', 'surprised'].includes(activeExpression.value)) {
    return {
      min: emoBehavior.blink.specialMin,
      max: emoBehavior.blink.specialMax,
      duration: emoBehavior.blink.normalDuration,
    }
  }
  return {
    min: emoBehavior.blink.idleMin,
    max: emoBehavior.blink.idleMax,
    duration: emoBehavior.blink.normalDuration,
  }
}

function finishBlink(duration: number, allowDouble: boolean) {
  blinking.value = false
  const shouldDouble = allowDouble && Math.random() < emoBehavior.blink.doubleChance
  if (!shouldDouble) {
    scheduleBlink()
    return
  }

  doubleBlinkTimer = setTimeout(() => {
    blinking.value = true
    blinkEndTimer = setTimeout(() => {
      blinking.value = false
      scheduleBlink()
    }, duration)
  }, emoBehavior.blink.doubleGap)
}

function performBlink() {
  if (!mounted.value || document.hidden) {
    scheduleBlink()
    return
  }

  const profile = blinkProfile()
  blinking.value = true
  blinkEndTimer = setTimeout(
    () => finishBlink(profile.duration, activeExpression.value !== 'sleepy'),
    profile.duration,
  )
}

function scheduleBlink() {
  if (!mounted.value) return
  const profile = blinkProfile()
  blinkTimer = setTimeout(performBlink, randomBetween(profile.min, profile.max))
}

function clearGazeTimers() {
  if (gazeTimer) clearTimeout(gazeTimer)
  if (gazeResetTimer) clearTimeout(gazeResetTimer)
  gazeTimer = undefined
  gazeResetTimer = undefined
}

function nextGaze(): EmoGaze {
  if (activeExpression.value === 'thinking' || activeExpression.value === 'analyzing') {
    return Math.random() > 0.5 ? 'up' : 'right'
  }
  if (activeExpression.value === 'sleepy') return 'down'
  if (props.isPlaying && energyBand.value === 'high') {
    return Math.random() > 0.5 ? 'left' : 'right'
  }
  const choices: EmoGaze[] = ['left', 'right', 'up', 'down', 'user', 'center', 'center']
  return choices[Math.floor(Math.random() * choices.length)] ?? 'center'
}

function scheduleGaze() {
  if (!mounted.value) return
  gazeTimer = setTimeout(() => {
    gaze.value = nextGaze()
    gazeResetTimer = setTimeout(() => {
      gaze.value = 'center'
      scheduleGaze()
    }, emoBehavior.gaze.hold)
  }, randomBetween(emoBehavior.gaze.idleMin, emoBehavior.gaze.idleMax))
}

function resetBehavior() {
  clearBlinkTimers()
  clearGazeTimers()
  gaze.value = activeExpression.value === 'thinking' || activeExpression.value === 'analyzing' ? 'up' : 'center'
  scheduleBlink()
  scheduleGaze()
}

async function onTap() {
  emit('tap')
  emit('expression-change', 'curious')
  await nextTick()
  clearGazeTimers()
  gaze.value = 'user'
  gazeResetTimer = setTimeout(() => {
    gaze.value = 'center'
    scheduleGaze()
  }, emoBehavior.gaze.hold)
}

watch(activeExpression, () => {
  if (mounted.value) resetBehavior()
})

watch(() => props.isPlaying, () => {
  if (mounted.value) resetBehavior()
})

onMounted(() => {
  mounted.value = true
  resetBehavior()
})

onBeforeUnmount(() => {
  mounted.value = false
  clearBlinkTimers()
  clearGazeTimers()
})
</script>

<template>
  <div class="emo-companion" :style="companionStyle">
    <button
      type="button"
      class="emo-character"
      :data-expression="activeExpression"
      :data-motion="motion"
      :data-energy="energyBand"
      :data-playing="effectiveIsPlaying"
      :aria-label="`Interact with EMO. Current expression: ${activeExpression}`"
      @click="onTap"
    >
      <span class="emo-character__machine" aria-hidden="true">
        <span class="emo-head">
          <EmoFace
            :expression="activeExpression"
            :gaze="gaze"
            :blinking="blinking"
          />
          <span class="emo-headphones" aria-hidden="true">
            <span class="emo-headband" />
            <span class="emo-earcup emo-earcup--left">
              <span class="emo-earcup__pad" />
            </span>
            <span class="emo-earcup emo-earcup--right">
              <span class="emo-earcup__pad" />
            </span>
          </span>
        </span>
        <span class="emo-neck" />
        <span class="emo-body">
          <span class="emo-chest">
            <span class="emo-chest-bar" />
            <span class="emo-chest-bar" />
            <span class="emo-chest-bar" />
          </span>
        </span>
        <span class="emo-feet">
          <span class="emo-foot" />
          <span class="emo-foot" />
        </span>
      </span>
    </button>

    <p class="emo-companion__status" aria-live="polite">
      {{ statusText }}
    </p>
  </div>
</template>
