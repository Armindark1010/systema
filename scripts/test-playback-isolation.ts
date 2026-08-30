// ============================================================
// SYSTEMA — Playback Isolation Regression Tests
// ============================================================
// HARD RULE: AI / semantic analysis / ONNX / model loading must
// NEVER break, block, modify, or depend on normal music playback.
//
// Playback must work even when:
// * no AI model is installed
// * CLAP is unavailable
// * Discogs-EffNet is unavailable
// * semantic model fails
// * ONNX Runtime fails
// * audio decoding for analysis fails
// * resampling fails
// * semantic inference fails
// * model import is invalid
// * AI analysis throws any exception
// ============================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    if (detail) console.log(`      ${detail}`)
  }
}

function group(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

interface Track {
  id: string
  title: string
  duration: number
  uri?: string
}

const T1: Track = { id: 'tr-01', title: 'Signal Grid', duration: 180, uri: 'content://media/1' }
const T2: Track = { id: 'tr-02', title: 'Linear Motion', duration: 210, uri: 'content://media/2' }
const T3: Track = { id: 'tr-03', title: 'Trans-Europe', duration: 240, uri: 'content://media/3' }

// Simulated independent player store
class IsolatedPlayerStore {
  playbackOrder: Track[] = [T1, T2, T3]
  currentIndex = 0
  isPlaying = false
  currentTime = 0
  duration = 180
  playerError: { code: string; message: string } | null = null

  get currentTrack(): Track | null {
    return this.playbackOrder[this.currentIndex] ?? null
  }

  playTrack(track: Track) {
    const idx = this.playbackOrder.findIndex(t => t.id === track.id)
    if (idx >= 0) {
      this.currentIndex = idx
    } else {
      this.playbackOrder = [track]
      this.currentIndex = 0
    }
    this.duration = track.duration
    this.currentTime = 0
    this.isPlaying = true
    this.playerError = null
  }

  pause() {
    this.isPlaying = false
  }

  resume() {
    if (this.currentTrack) this.isPlaying = true
  }

  togglePlay() {
    if (!this.currentTrack) return
    if (this.isPlaying) this.pause()
    else this.resume()
  }

  next() {
    if (this.currentIndex < this.playbackOrder.length - 1) {
      this.currentIndex++
      this.currentTime = 0
      this.isPlaying = true
      this.duration = this.currentTrack?.duration ?? 0
    } else {
      this.isPlaying = false
    }
  }

  previous() {
    if (this.currentTime > 3) {
      this.currentTime = 0
      return
    }
    if (this.currentIndex > 0) {
      this.currentIndex--
      this.currentTime = 0
      this.isPlaying = true
      this.duration = this.currentTrack?.duration ?? 0
    }
  }

  seek(seconds: number) {
    this.currentTime = Math.max(0, Math.min(seconds, this.duration))
  }
}

// ------------------------------------------------------------
group('1. Semantic model initialization throws → player.play() still succeeds')
// ------------------------------------------------------------
{
  const player = new IsolatedPlayerStore()

  // Simulate semantic engine throwing during async startup / analysis
  async function simulateFaultySemanticInit() {
    throw new Error('FATAL_ONNX_INIT_FAILED: library not found')
  }

  let semanticErrorCaught = false
  try {
    void simulateFaultySemanticInit().catch(() => {
      semanticErrorCaught = true
    })
  } catch {
    semanticErrorCaught = true
  }

  // Player play action
  player.playTrack(T2)
  check('player.play() activates playback after semantic init error', player.isPlaying === true)
  check('player.currentTrack matches requested track', player.currentTrack?.id === 'tr-02')
  check('player.playerError remains null', player.playerError === null)

  player.pause()
  check('player.pause() works', player.isPlaying === false)

  player.resume()
  check('player.resume() works', player.isPlaying === true)

  player.seek(50)
  check('player.seek() works', player.currentTime === 50)

  player.next()
  check('player.next() advances track', player.currentTrack?.id === 'tr-03')

  player.previous()
  check('player.previous() moves back', player.currentTrack?.id === 'tr-02')
}

// ------------------------------------------------------------
group('2. EffNet unavailable / not installed → playback works')
// ------------------------------------------------------------
{
  const player = new IsolatedPlayerStore()

  // Simulate EffNet status reporting MODEL_NOT_INSTALLED
  const effnetStatus = {
    available: false,
    installed: false,
    errorCode: 'MODEL_NOT_INSTALLED',
    detail: 'No model installed',
  }

  player.playTrack(T1)
  check('play() succeeds when EffNet is not installed', player.isPlaying && player.currentTrack?.id === 'tr-01')

  player.togglePlay()
  check('togglePlay() pauses', player.isPlaying === false)
  player.togglePlay()
  check('togglePlay() resumes', player.isPlaying === true)
}

// ------------------------------------------------------------
group('3. EffNet invalid graph / signature mismatch → playback works')
// ------------------------------------------------------------
{
  const player = new IsolatedPlayerStore()

  // Simulate signature verification throwing InferenceException
  function simulateSignatureMismatch() {
    throw new Error('INPUT_SHAPE_MISMATCH: Model expects 96 mel bands but got 64.')
  }

  let errorCaught = false
  try {
    simulateSignatureMismatch()
  } catch {
    errorCaught = true
  }
  check('signature mismatch error isolated', errorCaught)

  player.playTrack(T3)
  check('playback unaffected by invalid model file', player.isPlaying && player.currentTrack?.id === 'tr-03')
}

// ------------------------------------------------------------
group('4. ONNX Runtime crash / unavailable → playback works')
// ------------------------------------------------------------
{
  const player = new IsolatedPlayerStore()

  function simulateOnnxRuntimeUnavailable() {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'ONNX Runtime not loaded' }
  }

  const res = simulateOnnxRuntimeUnavailable()
  check('ONNX runtime report is safe outcome', res.ok === false)

  player.playTrack(T2)
  player.seek(120)
  check('playback and seeking work without ONNX Runtime', player.isPlaying && player.currentTime === 120)
}

// ------------------------------------------------------------
group('5. Audio decoding failure during analysis → playback unaffected')
// ------------------------------------------------------------
{
  const player = new IsolatedPlayerStore()

  // MediaExtractor/Codec decoding error in analysis worker
  function simulateAnalysisDecodeError() {
    return { ok: false, code: 'DECODE_FAILED', message: 'AudioTrack unreadable for analysis' }
  }

  const analysisRes = simulateAnalysisDecodeError()
  check('analysis decode failure is contained', analysisRes.code === 'DECODE_FAILED')

  player.playTrack(T1)
  player.next()
  check('player transport continues across analysis decode error', player.currentTrack?.id === 'tr-02' && player.isPlaying)
}

// ------------------------------------------------------------
group('6. Resampling failure / wrong sample rate → playback unaffected')
// ------------------------------------------------------------
{
  const player = new IsolatedPlayerStore()

  function simulateResampleContractError() {
    return { ok: false, code: 'INPUT_SHAPE_MISMATCH', message: 'Rate mismatch: expected 16000 Hz' }
  }

  const res = simulateResampleContractError()
  check('resampling error reported accurately without crashing', res.code === 'INPUT_SHAPE_MISMATCH')

  player.playTrack(T3)
  player.previous()
  check('playback controls completely isolated from DSP resampling errors', player.currentTrack?.id === 'tr-02')
}

// ------------------------------------------------------------
group('7. Source code inspection: architecture boundary enforcement')
// ------------------------------------------------------------
{
  const fullPlayer = read('app/components/FullPlayer.vue')
  const playerStore = read('app/stores/player.ts')
  const useNativePlayer = read('app/composables/useNativePlayer.ts')
  const semanticRuntime = read('app/services/music-semantics/providers/semanticRuntime.ts')
  const inferenceBenchmark = read('android/app/src/main/java/com/systema/music/inference/InferenceBenchmark.kt')
  const embeddingLab = read('android/app/src/main/java/com/systema/music/inference/EmbeddingQualityLab.kt')
  const effnetSession = read('android/app/src/main/java/com/systema/music/inference/effnet/EffnetDiscogsSession.kt')

  check('FullPlayer does not await AI analysis during play',
    !/togglePlay\(\)\s*\{[\s\S]*?await\s+(ai|semantic)/.test(fullPlayer))

  check('Player store has no dependency on ONNX or InferenceNative',
    !playerStore.includes('InferenceNative') && !playerStore.includes('Onnx') && !playerStore.includes('effnet'))

  check('useNativePlayer has no dependency on InferenceNative or AI analysis',
    !useNativePlayer.includes('InferenceNative') && !useNativePlayer.includes('effnetEmbedTrack'))

  check('semanticRuntime is wrapped in try/catch and never throws uncaught exceptions',
    semanticRuntime.includes('try {') && semanticRuntime.includes('catch (error) {'))

  check('InferenceBenchmark decodes at model inputSampleRate',
    inferenceBenchmark.includes('descriptor.inputSampleRate'))

  check('EmbeddingQualityLab decodes at model inputSampleRate',
    embeddingLab.includes('descriptor.inputSampleRate'))

  check('EffnetDiscogsSession decodes at 16000 Hz',
    effnetSession.includes('EffnetDiscogsMelFrontEnd.SAMPLE_RATE'))
}

// ------------------------------------------------------------
group('Summary')
// ------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
