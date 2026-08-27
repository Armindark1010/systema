<script setup lang="ts">
// ============================================================
// SYSTEMA — results render boundary (dev labs)
// ============================================================
// A results panel must never be able to blank the page it lives on.
//
// WHY THIS EXISTS
// ---------------
// Phase 18's labelled evaluation went white near the end of a run on
// device. The cause was a TypeError thrown inside a render function
// (`undefined.toFixed()`, from a field the Capacitor bridge had
// silently dropped). Vue's response to an unhandled render error is to
// unmount the component tree, which left a blank — but still
// scrollable — page.
//
// The bridge bug itself is fixed at its source. This is the structural
// backstop: these labs render numbers that come from native code, and
// a display bug in one panel should cost that panel, not the whole
// screen with the progress and the controls on it.
//
// WHAT IT DOES NOT DO
// -------------------
// It does not swallow the error. The error is re-thrown into the
// console (so it appears in `adb logcat -s chromium`), shown on screen
// in full, and exposed via the `error` event for the host page to
// record. It never auto-reloads, never navigates away and never
// silently renders a fallback that looks like real data — a caught
// error is displayed AS an error.
//
// `onErrorCaptured` only sees errors from DESCENDANTS, never from the
// component it is declared in. That is precisely why this is a
// separate component wrapping the results, rather than a hook added
// to the page itself.
// ============================================================

const props = withDefaults(defineProps<{
  /** Shown above the message, e.g. "PAIR RESULTS". */
  label?: string
}>(), { label: 'RESULTS' })

const emit = defineEmits<{ error: [message: string] }>()

const failure = ref<string | null>(null)

onErrorCaptured((err) => {
  const message = err instanceof Error
    ? `${err.name}: ${err.message}`
    : String(err)

  failure.value = message
  emit('error', message)

  // Keep the stack in the console/logcat. The UI shows the message;
  // this keeps the full trace available for diagnosis.
  console.error(`[${props.label}] render failed — panel isolated:`, err)

  // Stop here: the tree above this boundary must keep rendering.
  // Propagating would let Vue unmount the page, which is the exact
  // failure this component exists to prevent.
  return false
})

/** Re-mounts the slot content, e.g. after new data arrives. */
function retry() {
  failure.value = null
}

defineExpose({ retry })
</script>

<template>
  <div
    v-if="failure"
    class="border border-danger/40 rounded-lg bg-danger/5 p-4 space-y-2"
  >
    <p class="label text-danger">{{ label }} — DISPLAY ERROR</p>
    <p class="text-small text-fg leading-relaxed">
      This panel could not be rendered, so it has been isolated. The
      evaluation itself is unaffected and the rest of the page is live.
    </p>
    <p class="text-micro text-fg-muted font-mono break-all">{{ failure }}</p>
    <button type="button" class="sys-btn-outline chip" @click="retry">
      RETRY PANEL
    </button>
  </div>
  <slot v-else />
</template>
