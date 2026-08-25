<script setup lang="ts">
import type { EmoExpression, EmoGaze } from '~/types/emo'

withDefaults(defineProps<{
  expression: EmoExpression
  gaze?: EmoGaze
  blinking?: boolean
}>(), {
  gaze: 'center',
  blinking: false,
})
</script>

<template>
  <div
    class="emo-face"
    :class="{ 'is-blinking': blinking }"
    :data-expression="expression"
    :data-gaze="gaze"
    aria-hidden="true"
  >
    <span class="emo-eyes">
      <span class="emo-eye" />
      <span class="emo-eye" />
    </span>
    <span class="emo-mouth" />
    <span class="emo-face-scan" />
  </div>
</template>
