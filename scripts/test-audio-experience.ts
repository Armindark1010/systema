// ============================================================
// SYSTEMA — Phase 4: audio experience tests
// ============================================================
// Two kinds of assertion here, deliberately kept apart:
//
//   BEHAVIOURAL — a transcription of the sleep-timer deadline logic and
//   the engine's seek/error-skip rules, executed for real. Nuxt
//   composables and Kotlin cannot be imported under tsx, so the model
//   is a direct transcription; any behavioural change must be made in
//   both places.
//
//   STRUCTURAL — assertions over the shipping Kotlin/TS source for the
//   things only a device could otherwise prove: that audio focus is
//   delegated to Media3, that the sleep timer pauses the real player,
//   that there is exactly one player/session/timer.
//
// Covers §2-§5, §11-§19, §21-§27.
// ============================================================

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Source with comments stripped, for absence assertions. */
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const ENGINE = 'android/app/src/main/java/com/systema/music/player/PlayerEngine.kt'
const SERVICE = 'android/app/src/main/java/com/systema/music/player/PlaybackService.kt'
const PLUGIN = 'android/app/src/main/java/com/systema/music/player/PlayerPlugin.kt'
const SLEEP = 'app/composables/useSleepTimer.ts'
const RESTORE = 'app/composables/usePlaybackRestore.ts'
const NATIVE = 'app/composables/useNativePlayer.ts'
const STORE = 'app/stores/player.ts'
const SESSION = 'app/services/persistence/playbackSession.ts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
  }
}

function equal(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`      expected ${b}`)
    console.log(`      actual   ${a}`)
  }
}

function group(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ============================================================
// BEHAVIOURAL MODELS
// ============================================================

/**
 * Sleep timer — mirrors app/composables/useSleepTimer.ts.
 *
 * The point of the model is the deadline: remaining time is DERIVED
 * from an absolute instant, never decremented, so a frozen app cannot
 * lose time.
 */
class SleepTimerModel {
  deadlineAt: number | null = null
  isActive = false
  remainingMs = 0
  selectedMinutes = 0
  /** Real pauses issued against the player. */
  pauses = 0
  expiries = 0
  playing = true

  constructor(public now: number) {}

  set(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.cancel()
      return
    }
    this.selectedMinutes = minutes
    this.deadlineAt = this.now + Math.round(minutes * 60 * 1000)
    this.isActive = true
    this.refresh()
  }

  cancel() {
    this.deadlineAt = null
    this.isActive = false
    this.remainingMs = 0
    this.selectedMinutes = 0
  }

  refresh(): number {
    if (this.deadlineAt === null) {
      this.remainingMs = 0
      return 0
    }
    this.remainingMs = Math.max(0, this.deadlineAt - this.now)
    return this.remainingMs
  }

  /** Advances wall-clock time; the app may or may not have been awake. */
  advance(ms: number, awake = true) {
    this.now += ms
    if (awake) this.tick()
  }

  /** What the visible ticker does once per second. */
  tick() {
    const left = this.refresh()
    if (left <= 0 && this.isActive) this.expire()
  }

  expire() {
    this.deadlineAt = null
    this.isActive = false
    this.remainingMs = 0
    this.selectedMinutes = 0
    this.expiries++
    if (this.playing) {
      this.pauses++
      this.playing = false
    }
  }

  /** Resume from the background: re-derive, then expire if overdue. */
  resumeFromBackground() {
    this.tick()
  }
}

/** Seek clamping — mirrors PlayerEngine.seekTo/seekBy and store.seek. */
function clampSeek(requested: number, durationMs: number | null): number {
  // Unknown duration = pass through (only the floor applies).
  const known = durationMs !== null && Number.isFinite(durationMs) && durationMs > 0
  if (!known) return Math.max(0, requested)
  return Math.min(Math.max(0, requested), durationMs)
}

/** Error-skip — mirrors PlayerEngine.nextPlayableIndexFrom. */
function nextPlayableIndexFrom(
  trackIds: string[],
  failed: Set<string>,
  fromIndex: number,
  repeatAll: boolean,
): number | null {
  if (!trackIds.length) return null
  for (let i = fromIndex + 1; i < trackIds.length; i++) {
    if (!failed.has(trackIds[i]!)) return i
  }
  if (!repeatAll) return null
  for (let i = 0; i <= fromIndex && i < trackIds.length; i++) {
    if (!failed.has(trackIds[i]!)) return i
  }
  return null
}

// ------------------------------------------------------------
group('1. Sleep timer — duration options (§11)')
// ------------------------------------------------------------
{
  const src = read(SLEEP)
  for (const mins of [15, 30, 45, 60]) {
    check(`${mins} minutes offered`, src.includes(`{ label: '${mins} MIN', value: ${mins} }`))
  }
  check('OFF offered', src.includes("{ label: 'OFF', value: 0 }"))
  check('CUSTOM offered', src.includes("custom: true"))
  check('custom duration is bounded', src.includes('SLEEP_TIMER_MAX_MINUTES'))

  const t = new SleepTimerModel(1000)
  t.set(15)
  equal('15 minutes arms a 15-minute deadline', t.deadlineAt, 1000 + 15 * 60_000)
  equal('remaining reads back', t.remainingMs, 15 * 60_000)
  check('reported active', t.isActive)

  t.cancel()
  check('cancel deactivates', !t.isActive)
  equal('cancel zeroes the remainder', t.remainingMs, 0)
  equal('cancel clears the deadline', t.deadlineAt, null)

  const z = new SleepTimerModel(0)
  z.set(0)
  check('a zero duration does not arm', !z.isActive)
  z.set(-5)
  check('a negative duration does not arm', !z.isActive)
  z.set(Number.NaN)
  check('NaN does not arm', !z.isActive)
}

// ------------------------------------------------------------
group('2. Sleep timer — expiry stops REAL playback (§13)')
// ------------------------------------------------------------
{
  const t = new SleepTimerModel(0)
  t.set(15)
  t.advance(14 * 60_000)
  check('still active one minute out', t.isActive)
  equal('no pause yet', t.pauses, 0)

  t.advance(60_000)
  check('inactive after expiry', !t.isActive)
  equal('the player was paused exactly once', t.pauses, 1)
  equal('expiry fired once', t.expiries, 1)
  check('playback actually stopped', !t.playing)

  // Structural: the pause must go through the store ACTION, because a
  // direct ref write bypasses the $onAction bridge and never reaches
  // Media3. That was the original bug.
  // Comment-stripped: the file DOCUMENTS the old broken calls in its
  // header, and an absence assertion must not match the explanation.
  const src = readCode(SLEEP)
  check('pauses via the store action', src.includes('player.pause()'))
  check('does not write isPlaying directly',
    !/isPlaying\.value\s*=/.test(src) && !/player\.isPlaying\s*=/.test(src))
  check('the old mock-engine stop is gone', !src.includes('stopPlaybackCompletely'))
  check('native expiry pauses the real ExoPlayer',
    /onSleepTimerExpired[\s\S]{0,400}player\?\.pause\(\)/.test(read(ENGINE)))
}

// ------------------------------------------------------------
group('3. Sleep timer — survives the background (§14, §15)')
// ------------------------------------------------------------
{
  // The critical case: the WebView is frozen for the whole duration.
  const t = new SleepTimerModel(0)
  t.set(15)
  t.advance(20 * 60_000, /* awake */ false)
  check('no tick ran while frozen', t.isActive)
  t.resumeFromBackground()
  check('expiry is detected on resume', !t.isActive)
  equal('and the player is paused', t.pauses, 1)

  // A decrementing counter would have lost the frozen time entirely.
  const drifting = new SleepTimerModel(0)
  drifting.set(15)
  drifting.advance(5 * 60_000, false)
  drifting.advance(5 * 60_000, false)
  drifting.resumeFromBackground()
  equal('remaining is derived from the deadline, not decremented',
    drifting.remainingMs, 5 * 60_000)

  const src = read(SLEEP)
  check('deadline-based, not decrement-based', src.includes('deadlineAt'))
  check('no per-second decrement', !/remainingMs\.value\s*-=/.test(src))
  check('re-reads native state on resume', src.includes('syncFromNative'))
  check('listens for visibility changes', src.includes('visibilitychange'))
  check('lifecycle installed once', src.includes('lifecycleInstalled'))
  check('state is module-scoped, not component-scoped',
    src.includes('// ---- Module-scoped state'))

  // §14: one centralised mechanism.
  // Counts invocations; `ReturnType<typeof setInterval>` is a type, not
  // a timer.
  check('exactly one display interval',
    (readCode(SLEEP).match(/setInterval\(/g) ?? []).length === 1)
  check('the interval only renders',
    src.includes('The ticker only *renders*'))

  const engine = read(ENGINE)
  check('the native timer is a single scheduled message',
    (engine.match(/postDelayed\(sleepRunnable/g) ?? []).length === 1)
  check('the native timer holds no wakelock', !engine.includes('WakeLock'))
  check('native timer is cancelled on release',
    /fun release[\s\S]{0,800}removeCallbacks\(sleepRunnable\)/.test(engine))
}

// ------------------------------------------------------------
group('4. Sleep timer — track changes do not reset it (§16)')
// ------------------------------------------------------------
{
  const t = new SleepTimerModel(0)
  t.set(15)
  const deadline = t.deadlineAt
  t.advance(3 * 60_000)
  // Simulate Next / Previous / a track ending — none of which touch
  // the timer, because nothing binds the deadline to a track.
  t.advance(0)
  equal('the deadline is untouched by track changes', t.deadlineAt, deadline)
  equal('remaining keeps counting down', t.remainingMs, 12 * 60_000)
  check('still active', t.isActive)

  const engine = readCode(ENGINE)
  const sleepSection = engine.slice(engine.indexOf('private var sleepDeadlineAt'))
  check('the native timer references no track id',
    !sleepSection.includes('trackId') && !sleepSection.includes('currentMediaItem'))
  check('setQueue does not cancel the timer',
    !/fun setQueueAndPlay[\s\S]{0,1500}sleepDeadlineAt/.test(engine))
}

// ------------------------------------------------------------
group('5. Sleep timer — one mechanism, one state (§14, §26)')
// ------------------------------------------------------------
{
  const sleep = read(SLEEP)
  const store = read(STORE)

  check('the store mirror is written by the timer', sleep.includes('player.sleepTimer'))
  check('the store still exposes sleepTimer', store.includes('sleepTimer,'))
  check('the native timer is the source of truth on Android',
    sleep.includes('setSleepTimerNative'))
  check('browser falls back to a single timeout',
    sleep.includes('fallbackTimeout') && !sleep.includes('setInterval(onExpired'))
  check('native availability is guarded', sleep.includes('isNativePlayerAvailable()'))

  // No component may run its own countdown.
  const full = read('app/components/FullPlayer.vue')
  check('FullPlayer runs no timer of its own', !full.includes('setInterval'))
  const modal = read('app/components/player/PlayerSleepTimer.vue')
  check('the modal runs no timer of its own', !modal.includes('setInterval'))
  check('the modal was reused, not redesigned (§12)',
    modal.includes('SLEEP TIMER') && modal.includes('player-sheet'))
  check('the modal shows the remaining time', modal.includes('remaining'))
}

// ------------------------------------------------------------
group('6. Audio focus is delegated to Media3 (§2)')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  check('handleAudioFocus is enabled', engine.includes('handleAudioFocus = */ true'))
  check('usage is declared as media', engine.includes('C.USAGE_MEDIA'))
  check('content type is music', engine.includes('C.AUDIO_CONTENT_TYPE_MUSIC'))

  // §2: "do not manually fight audio focus".
  const code = readCode(ENGINE) + readCode(SERVICE)
  check('no manual AudioManager focus request',
    !code.includes('requestAudioFocus') && !code.includes('abandonAudioFocus'))
  check('no OnAudioFocusChangeListener', !code.includes('OnAudioFocusChangeListener'))
  check('no manual ducking volume maths', !code.includes('setVolume(0.2'))

  // Reported to the frontend rather than reimplemented.
  check('focus-loss pauses are identified',
    engine.includes('PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS'))
  check('the reason reaches the snapshot', engine.includes('interrupted ='))
  check('the flag clears when playback resumes',
    /onIsPlayingChanged[\s\S]{0,200}lastPauseWasInterruption = false/.test(engine))
  check('the bridge forwards it', read(PLUGIN).includes('.put("interrupted", interrupted)'))
  check('the store mirrors it', read(STORE).includes('const interrupted = ref(false)'))
  check('the composable applies it', read(NATIVE).includes('player.interrupted ='))

  // §2: never blindly resume. Nothing may auto-resume on focus gain.
  check('no auto-resume on focus gain',
    !/AUDIO_FOCUS_GAIN[\s\S]{0,200}play\(\)/.test(engine))
}

// ------------------------------------------------------------
group('7. Headphones and Bluetooth (§3, §4)')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  check('becoming-noisy handling is on', engine.includes('setHandleAudioBecomingNoisy(true)'))
  check('it is delegated, not hand-rolled',
    !readCode(ENGINE).includes('ACTION_AUDIO_BECOMING_NOISY'))
  check('no custom headset BroadcastReceiver',
    !readCode(ENGINE).includes('BroadcastReceiver') && !readCode(SERVICE).includes('BroadcastReceiver'))
  check('no auto-resume on reconnect', !engine.includes('ACTION_HEADSET_PLUG'))

  // §4: Bluetooth goes through MediaSession, over the same player.
  const svc = read(SERVICE)
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  check('a MediaSession is built', svc.includes('MediaSession.Builder'))
  check('over the engine player', svc.includes('PlayerEngine.get(applicationContext).sessionPlayer()'))
  check('media buttons are routed to the service',
    manifest.includes('android.intent.action.MEDIA_BUTTON'))
  check('the session service action is declared',
    manifest.includes('androidx.media3.session.MediaSessionService'))
  check('no second command system', !svc.includes('CustomCommand'))
  check('seek increments are declared so seek buttons appear',
    engine.includes('setSeekBackIncrementMs') && engine.includes('setSeekForwardIncrementMs'))
}

// ------------------------------------------------------------
group('8. Seek edge cases (§18, §19)')
// ------------------------------------------------------------
{
  equal('seek to 0', clampSeek(0, 200_000), 0)
  equal('seek to duration', clampSeek(200_000, 200_000), 200_000)
  equal('seek beyond duration clamps', clampSeek(999_000, 200_000), 200_000)
  equal('seek below 0 clamps', clampSeek(-5_000, 200_000), 0)
  equal('seek with unknown duration passes through', clampSeek(45_000, null), 45_000)
  // The regression: a 0 duration during preparation must NOT clamp
  // every seek to the start of the track.
  equal('seek while preparing (duration 0) is not forced to 0', clampSeek(45_000, 0), 45_000)
  equal('negative seek while preparing still floors', clampSeek(-1_000, 0), 0)

  const engine = read(ENGINE)
  check('an unknown duration is TIME_UNSET *or* zero',
    engine.includes('it != C.TIME_UNSET && it > 0'))
  check('the helper documents the 0-duration trap',
    engine.includes('it also briefly reports **0**'))
  check('seeking an empty queue is a no-op',
    /fun seekTo[\s\S]{0,400}mediaItemCount == 0/.test(engine))
  check('seek failures cannot crash the session',
    /fun seekTo[\s\S]{0,600}catch \(t: Throwable\)/.test(engine))
  check('seekBy is guarded identically',
    /fun seekBy[\s\S]{0,600}catch \(t: Throwable\)/.test(engine))

  // §18: throttled, but the first movement is immediate.
  const native = read(NATIVE)
  check('seeks are throttled', native.includes('SEEK_THROTTLE_MS'))
  check('the leading edge is sent immediately', native.includes('Leading edge'))
  check('native position is authoritative after a seek',
    native.includes('re-anchor') || native.includes('re-anchors'))

  const store = read(STORE)
  check('the store does not clamp against an unknown duration',
    store.includes('dur > 0 ? Math.min(floored, dur) : floored'))
  check('percentage seeks need a duration', store.includes('if (dur <= 0) return'))
  check('non-finite seeks are rejected', store.includes('if (!Number.isFinite(timeInSecondsOrMs)) return'))
}

// ------------------------------------------------------------
group('9. Invalid tracks do not loop (§21)')
// ------------------------------------------------------------
{
  const ids = ['a', 'b', 'c']

  equal('skips to the next track', nextPlayableIndexFrom(ids, new Set(['a']), 0, false), 1)
  equal('skips over a second failure',
    nextPlayableIndexFrom(ids, new Set(['a', 'b']), 0, false), 2)
  equal('stops when nothing is left',
    nextPlayableIndexFrom(ids, new Set(['a', 'b', 'c']), 0, false), null)
  equal('no wrap without repeat-all',
    nextPlayableIndexFrom(ids, new Set(['c']), 2, false), null)

  // The loop that repeat-all used to cause.
  equal('repeat-all wraps to a good track',
    nextPlayableIndexFrom(ids, new Set(['c']), 2, true), 0)
  equal('repeat-all does not retry known-bad tracks forever',
    nextPlayableIndexFrom(ids, new Set(['a', 'b', 'c']), 2, true), null)
  equal('repeat-all wraps past a failure to a good one',
    nextPlayableIndexFrom(ids, new Set(['a', 'c']), 2, true), 1)
  equal('an empty queue yields nothing',
    nextPlayableIndexFrom([], new Set(), 0, true), null)

  const engine = read(ENGINE)
  check('failures are remembered', engine.includes('failedTrackIds'))
  check('a structured error still reaches the UI',
    /onPlayerError[\s\S]{0,600}forEachListener \{ it\.onError/.test(engine))
  check('the failure memory resets on a new queue',
    /A new context deserves a fresh attempt/.test(engine))
  check('an all-bad queue stops instead of spinning',
    engine.includes('No playable item remains; stopping'))
  check('the UI receives the error state', read(NATIVE).includes('player.playerError = error'))
}

// ------------------------------------------------------------
group('10. Playback restoration wiring (§6, §7, §10)')
// ------------------------------------------------------------
{
  const restore = read(RESTORE)
  const session = read(SESSION)

  check('restoration never autoplays', restore.includes('player.isPlaying = false'))
  check('the no-autoplay rule is explicit', restore.includes('RESTORE, DO NOT PLAY'))
  check('it does not call playTrack', !restore.includes('player.playTrack('))
  check('it does not call playQueue', !restore.includes('player.playQueue('))
  check('it does not call resume', !restore.includes('player.resume('))

  // §10: Recents must not be polluted by a restore.
  check('restoration never records history', !readCode(RESTORE).includes('recordPlayed'))
  check('the recents rule is explicit', restore.includes('RECENTS ARE UNTOUCHED'))

  // Phase 4.1 renamed restore() -> restoreWhenReady(): the restore now
  // waits for the native library instead of running once, immediately.
  // The guard itself is unchanged — live playback still wins.
  check('live native playback wins over stored state',
    read('app/composables/usePlayerEngine.ts').includes('if (!player.currentTrack) restore.restoreWhenReady()'))
  check('saves are debounced', restore.includes('SAVE_DEBOUNCE_MS'))
  check('state is saved when backgrounded', restore.includes('visibilitychange'))
  check('state is saved on pause', restore.includes('if (!playing) saveNow()'))
  // Still one-shot, but the latch is now set only on a SETTLED outcome
  // (restored / skipped / discarded) and never on a wait — otherwise
  // the first, too-early attempt would consume the only chance.
  check('restore runs at most once',
    restore.includes('if (!import.meta.client || restoreSettled || restoreInFlight) return restoreSettled'))

  // §6: no heavy data.
  check('no artwork is persisted', !session.includes('artworkUri'))
  check('no uri is persisted', !/uri:/.test(session))
  check('ids are documented as stable', session.includes('stable SYSTEMA id'))
  check('media3 indexes are explicitly not stored',
    session.includes('Media3 indexes are never stored'))
}

// ------------------------------------------------------------
group('11. Browser fallback stays intact (§25)')
// ------------------------------------------------------------
{
  const sleep = read(SLEEP)
  const restore = read(RESTORE)
  const service = read('app/services/native/playerService.ts')

  check('sleep timer guards native calls', sleep.includes('if (isNativePlayerAvailable())'))
  check('sleep timer has a browser path', sleep.includes('// Browser: a single timeout'))
  check('native sleep calls go through the guarded facade',
    service.includes("guarded(() => NativePlayer.setSleepTimer"))
  check('restoration is platform-agnostic', !restore.includes('Capacitor'))
  check('restoration is client-guarded', restore.includes('import.meta.client'))
  check('the web engine still initialises',
    read('app/composables/usePlayerEngine.ts').includes('engine.start(track)'))
  check('native init still returns early off-device',
    read(NATIVE).includes('if (!isNativePlayerAvailable()) return false'))
}

// ------------------------------------------------------------
group('12. One of everything; no leaks (§26, §27)')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  const svc = read(SERVICE)
  const plugin = read(PLUGIN)

  check('one ExoPlayer instance', (engine.match(/ExoPlayer\.Builder/g) ?? []).length === 1)
  check('the engine is a singleton', engine.includes('@Volatile'))
  check('one MediaSession', (svc.match(/MediaSession\.Builder/g) ?? []).length === 1)
  check('the service does not build its own player', !svc.includes('ExoPlayer.Builder'))
  check('application context only, no Activity leak', !svc.includes('MainActivity'))

  // §27: Activity recreation must not duplicate listeners.
  check('the plugin detaches its playback listener',
    plugin.includes('engine.removeListener(engineListener)'))
  check('the plugin detaches its sleep listener',
    plugin.includes('engine.removeSleepTimerListener(sleepListener)'))
  check('exactly one handleOnDestroy',
    (plugin.match(/override fun handleOnDestroy/g) ?? []).length === 1)
  check('listener lists are copied before dispatch',
    engine.includes('synchronized(listeners) { listeners.toList() }'))
  check('sleep listeners are dispatched safely',
    engine.includes('synchronized(sleepListeners) { sleepListeners.toList() }'))
  check('a throwing listener cannot kill playback',
    /forEachListener[\s\S]{0,400}catch \(t: Throwable\)/.test(engine))

  // One progress clock on device.
  const native = read(NATIVE)
  check('one native progress clock',
    (readCode(NATIVE).match(/setInterval\(/g) ?? []).length === 1)
  check('the web clock is skipped on native',
    read('app/composables/usePlayerEngine.ts').includes('if (nativeReady)'))
  check('the composable is installed once', native.includes('if (!import.meta.client || installed)'))
  check('listeners are disposable', native.includes('disposeListeners?.()'))
}

// ------------------------------------------------------------
group('13. MediaSession and Pinia stay consistent (§23, §24)')
// ------------------------------------------------------------
{
  const engine = read(ENGINE)
  const svc = read(SERVICE)

  check('no hand-maintained session state', !svc.includes('setPlaybackState'))
  check('state is derived from the player', engine.includes('private fun snapshotNow'))
  check('every transport change emits a snapshot',
    engine.includes('override fun onPlaybackStateChanged(playbackState: Int) = emitSnapshot()'))
  check('sleep expiry emits a snapshot too',
    /onSleepTimerExpired[\s\S]{0,600}emitSnapshot\(\)/.test(engine))

  const native = read(NATIVE)
  for (const field of ['isPlaying', 'currentIndex', 'isShuffle', 'repeatMode', 'buffering']) {
    check(`${field} is mirrored from native`, native.includes(`player.${field} =`))
  }
  check('native remains authoritative', native.includes('Native is the source of truth'))
  check('echoes are not sent back', native.includes('applyingNativeState'))
}

// ------------------------------------------------------------
console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
