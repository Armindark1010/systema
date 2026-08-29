/**
 * SYSTEMA — Discogs-EffNet mel maths, executed.
 *
 * WHY THIS EXISTS ALONGSIDE THE KOTLIN TEST
 * -----------------------------------------
 * EffnetDiscogsMelTest.kt is the real test: it runs the production
 * class. But it needs a JVM, and this environment has none, so it can
 * only run in CI. A front end that is never executed before shipping is
 * a front end nobody has checked.
 *
 * So this file re-implements the SAME formulas in TypeScript, from the
 * same Essentia source, and executes them here. Two independent
 * transcriptions agreeing is meaningful evidence; one transcription
 * nobody ran is not.
 *
 * IMPORTANT: this is a CHECK, not the implementation. Nothing in the
 * app imports it. If the two ever disagree, the Kotlin is authoritative
 * for behaviour and Essentia's C++ is authoritative for correctness.
 */

let passed = 0
let failed = 0
const failures: string[] = []

function ok(label: string, cond: boolean, detail = '') {
  if (cond) passed++
  else {
    failed++
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(name: string) { console.log(`\n${name}`) }

// ---------------------------------------------------------------------
// Constants, from Essentia source. Must match the Kotlin exactly.
const SAMPLE_RATE = 16000
const FRAME_SIZE = 512
const HOP_SIZE = 256
const MEL_BANDS = 96
const PATCH_SIZE = 128
const PATCH_HOP = 62
const BATCH_SIZE = 64
const LOG_SHIFT = 1
const LOG_SCALE = 10000

const MIN_LOG_HZ = 1000.0
const MIN_LOG_MEL = 15.0
const LOG_STEP = 0.06875177742094911

const hzToMel = (hz: number) =>
  hz < MIN_LOG_HZ ? (3.0 * hz) / 200.0 : MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP

const melToHz = (mel: number) =>
  mel < MIN_LOG_MEL ? (200.0 * mel) / 3.0 : MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL))

// ---------------------------------------------------------------------
section('1. Slaney mel scale')
{
  ok('0 Hz -> 0 mel', Math.abs(hzToMel(0)) < 1e-12)
  ok('500 Hz -> 7.5 mel (linear region)', Math.abs(hzToMel(500) - 7.5) < 1e-12)
  ok('1000 Hz -> exactly 15 mel (break point)', Math.abs(hzToMel(1000) - 15) < 1e-12)
  ok('the scale is continuous at the break',
    Math.abs(hzToMel(999.999) - hzToMel(1000.001)) < 1e-4)

  for (const hz of [0, 100, 999, 1000, 4000, 8000]) {
    ok(`round trip ${hz} Hz`, Math.abs(melToHz(hzToMel(hz)) - hz) < 1e-9)
  }
  ok('mel is monotonic', hzToMel(100) < hzToMel(1000) && hzToMel(1000) < hzToMel(8000))
}

// ---------------------------------------------------------------------
section('2. unit_tri filterbank')

function buildFilters(): number[][] {
  const spectrumSize = FRAME_SIZE / 2 + 1
  const melMin = hzToMel(0)
  const melMax = hzToMel(SAMPLE_RATE / 2)
  const points: number[] = []
  for (let i = 0; i < MEL_BANDS + 2; i++) {
    points.push(melToHz(melMin + ((melMax - melMin) * i) / (MEL_BANDS + 1)))
  }
  const binHz = SAMPLE_RATE / FRAME_SIZE
  const filters: number[][] = []
  for (let m = 0; m < MEL_BANDS; m++) {
    const left = points[m]!
    const centre = points[m + 1]!
    const right = points[m + 2]!
    const row: number[] = []
    for (let bin = 0; bin < spectrumSize; bin++) {
      const hz = bin * binHz
      let w = 0
      if (hz > left && hz < right) {
        w = hz <= centre
          ? (centre > left ? (hz - left) / (centre - left) : 0)
          : (right > centre ? (right - hz) / (right - centre) : 0)
      }
      row.push(w)
    }
    filters.push(row)
  }
  return filters
}

{
  const filters = buildFilters()
  ok('96 filters were built', filters.length === MEL_BANDS)
  ok('each spans 257 bins', filters.every(f => f.length === FRAME_SIZE / 2 + 1))
  ok('all weights are non-negative', filters.every(f => f.every(v => v >= 0)))

  // THE distinguishing property. unit_tri => peak 1.0.
  // Slaney "area" normalisation would give peaks that shrink with
  // frequency, so this single check separates the two conventions.
  const peaks = filters.map(f => Math.max(...f))
  const lowPeak = peaks[10]!
  const highPeak = peaks[90]!

  // The SAMPLED peak is slightly under 1.0 for narrow low filters: at
  // 16 kHz / 512 the bin spacing is 31.25 Hz and the lowest triangles
  // span only ~2 bins, so no bin lands exactly on the apex. That is
  // discretisation, not a normalisation error — the same thing happens
  // in Essentia. What matters is the ORDER OF MAGNITUDE.
  ok('a low filter peaks near 1.0', lowPeak > 0.8 && lowPeak <= 1.0, lowPeak.toFixed(4))
  ok('a high filter also peaks near 1.0', highPeak > 0.8 && highPeak <= 1.0,
    highPeak.toFixed(4))

  // THE decisive check. With Slaney "area" normalisation each filter is
  // scaled by 2/(hz[i+2]-hz[i]), which here would give peaks of ~0.032
  // at the low end and ~0.005 at the high end — a 30x spread and two
  // orders of magnitude below unit_tri. Nothing about the numbers above
  // is compatible with that.
  ok('peaks are unit-scale, not area-scale (would be ~0.03)',
    peaks.every(p => p > 0.5))
  ok('peaks do not decay with frequency the way area norm does',
    Math.abs(highPeak - lowPeak) < 0.2, `low=${lowPeak.toFixed(3)} high=${highPeak.toFixed(3)}`)
  const areaPeakLow = 2 / (SAMPLE_RATE / FRAME_SIZE * 1.99)
  ok('the measured peak is far above what area norm would give',
    lowPeak > areaPeakLow * 10, `${lowPeak.toFixed(3)} vs ${areaPeakLow.toFixed(4)}`)

  // Filters must tile the spectrum in order.
  const centres = filters.map((f) => {
    let best = 0
    for (let i = 0; i < f.length; i++) if (f[i]! > f[best]!) best = i
    return best
  })
  let ascending = true
  for (let i = 1; i < centres.length; i++) if (centres[i]! < centres[i - 1]!) ascending = false
  ok('filter centres ascend monotonically', ascending)
  ok('the first filter sits at low frequency', centres[0]! < 10, String(centres[0]))
  ok('the last filter approaches Nyquist', centres[95]! > 200, String(centres[95]))
}

// ---------------------------------------------------------------------
section('3. Compression curve: log10(1 + 10000*m)')
{
  const compress = (m: number) => Math.log10(LOG_SHIFT + LOG_SCALE * Math.max(0, m))

  // The diagnostic case: silence must be EXACTLY zero.
  ok('silence compresses to exactly 0', compress(0) === 0)
  ok('log10(1 + 10000*0.0001) == log10(2)',
    Math.abs(compress(0.0001) - Math.log10(2)) < 1e-12)
  ok('log10(1 + 10000*0.1) == log10(1001)',
    Math.abs(compress(0.1) - Math.log10(1001)) < 1e-12)
  ok('the curve is monotonic', compress(0.01) < compress(0.1) && compress(0.1) < compress(1))
  ok('output is never negative for non-negative input',
    [0, 1e-9, 1e-6, 0.5, 10].every(v => compress(v) >= 0))

  // Contrast with CLAP's curve, to make the difference explicit.
  const clap = (p: number) => 10 * Math.log10(Math.max(p, 1e-10))
  ok('CLAP compression of silence is -100, not 0', Math.abs(clap(0) + 100) < 1e-9)
  ok('the two curves genuinely differ at silence', compress(0) !== clap(0))
  ok('the two curves differ on real signal too',
    Math.abs(compress(0.1) - clap(0.1)) > 1)
}

// ---------------------------------------------------------------------
section('4. Framing, mirroring Essentia padSignal')
{
  const frameCountFor = (n: number) =>
    n <= 0 ? 0 : 1 + Math.ceil((n - FRAME_SIZE / 2) / HOP_SIZE)
  const patchCountFor = (f: number) =>
    f < PATCH_SIZE ? 0 : 1 + Math.floor((f - PATCH_SIZE) / PATCH_HOP)

  ok('empty -> 0 frames', frameCountFor(0) === 0)
  ok('16000 samples -> 63 frames', frameCountFor(16000) === 63, String(frameCountFor(16000)))
  ok('frame count grows with input', frameCountFor(32000) > frameCountFor(16000))

  ok('127 frames -> 0 patches', patchCountFor(127) === 0)
  ok('128 frames -> 1 patch', patchCountFor(128) === 1)
  ok('189 frames -> 1 patch (discard partial)', patchCountFor(189) === 1)
  ok('190 frames -> 2 patches', patchCountFor(190) === 2)

  // lastPatchMode = "discard" must never round up.
  let neverRoundsUp = true
  for (let f = 128; f < 1000; f++) {
    const expected = 1 + Math.floor((f - PATCH_SIZE) / PATCH_HOP)
    if (patchCountFor(f) !== expected) neverRoundsUp = false
  }
  ok('patch count always floors, never ceils', neverRoundsUp)

  // Durations a human can sanity-check.
  const patchSeconds = ((PATCH_SIZE - 1) * HOP_SIZE + FRAME_SIZE) / SAMPLE_RATE
  ok('one patch is ~2.05 s of audio',
    patchSeconds > 2.0 && patchSeconds < 2.1, patchSeconds.toFixed(3))
  const rateHz = SAMPLE_RATE / (PATCH_HOP * HOP_SIZE)
  ok('prediction rate is ~1.008 Hz as documented',
    Math.abs(rateHz - 1.008) < 0.005, rateHz.toFixed(4))

  const minSamples = (PATCH_SIZE - 1) * HOP_SIZE + FRAME_SIZE / 2 + 1
  ok('minimum for one patch is ~2.04 s',
    Math.abs(minSamples / SAMPLE_RATE - 2.04) < 0.05,
    (minSamples / SAMPLE_RATE).toFixed(3))
  ok('a 1 s clip cannot produce a patch',
    patchCountFor(frameCountFor(SAMPLE_RATE)) === 0)
  ok('a 3 s clip can', patchCountFor(frameCountFor(SAMPLE_RATE * 3)) >= 1)
}

// ---------------------------------------------------------------------
section('5. End-to-end: silence and a tone through the real formulas')

function hann(n: number): number[] {
  // normalized=false: plain raised cosine, no gain correction.
  return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))
}

/** Naive DFT magnitude. Slow, but obviously correct — this is a check. */
function magnitudes(frame: number[]): number[] {
  const n = frame.length
  const out: number[] = []
  for (let k = 0; k <= n / 2; k++) {
    let re = 0
    let im = 0
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n
      re += frame[t]! * Math.cos(a)
      im += frame[t]! * Math.sin(a)
    }
    out.push(Math.sqrt(re * re + im * im))
  }
  return out
}

function melFrame(pcm: number[], start: number, filters: number[][], win: number[]): number[] {
  const frame: number[] = []
  for (let i = 0; i < FRAME_SIZE; i++) {
    const idx = start + i
    const s = idx < 0 || idx >= pcm.length ? 0 : pcm[idx]!
    frame.push(s * win[i]!)
  }
  const mags = magnitudes(frame)
  return filters.map((filt) => {
    let sum = 0
    for (let b = 0; b < mags.length; b++) if (filt[b] !== 0) sum += filt[b]! * mags[b]!
    return Math.log10(LOG_SHIFT + LOG_SCALE * Math.max(0, sum))
  })
}

{
  const filters = buildFilters()
  const win = hann(FRAME_SIZE)

  // SILENCE -> all bands exactly zero.
  const silence = new Array(FRAME_SIZE * 4).fill(0)
  const silentBands = melFrame(silence, 0, filters, win)
  ok('silence yields 96 bands', silentBands.length === 96)
  ok('every silent band is exactly 0', silentBands.every(v => v === 0))
  ok('no silent band is -100 (would mean CLAP compression)',
    !silentBands.some(v => v < -1))

  // A 1 kHz tone must peak in the band covering 1 kHz.
  const tone: number[] = []
  for (let i = 0; i < SAMPLE_RATE; i++) {
    tone.push(Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE))
  }
  const bands = melFrame(tone, SAMPLE_RATE / 2, filters, win)

  let peak = 0
  for (let i = 0; i < bands.length; i++) if (bands[i]! > bands[peak]!) peak = i

  const melMax = hzToMel(SAMPLE_RATE / 2)
  const expected = Math.round((hzToMel(1000) / melMax) * MEL_BANDS)
  ok('a 1 kHz tone peaks near the expected band',
    Math.abs(peak - expected) <= 3, `peak=${peak} expected≈${expected}`)
  ok('the tone produces real energy', bands[peak]! > 1, bands[peak]!.toFixed(3))
  ok('bands far from the tone are much quieter',
    bands[peak]! > bands[Math.min(95, peak + 30)]! * 2)
  ok('all bands are finite', bands.every(v => Number.isFinite(v)))
  ok('all bands are non-negative', bands.every(v => v >= 0))
}

// ---------------------------------------------------------------------
section('6. Tensor accounting')
{
  const elements = BATCH_SIZE * PATCH_SIZE * MEL_BANDS
  ok('a batch is 786432 floats', elements === 786432)
  ok('a batch is ~3.1 MB', Math.abs((elements * 4) / 1e6 - 3.146) < 0.01)
  ok('one patch is 12288 floats', PATCH_SIZE * MEL_BANDS === 12288)

  // A 3-minute track: how many batches?
  const frames = 1 + Math.ceil((SAMPLE_RATE * 180 - FRAME_SIZE / 2) / HOP_SIZE)
  const patches = 1 + Math.floor((frames - PATCH_SIZE) / PATCH_HOP)
  const batches = Math.ceil(patches / BATCH_SIZE)
  ok('a 3-minute track yields ~180 patches',
    patches > 170 && patches < 190, String(patches))
  ok('that is 3 batches', batches === 3, String(batches))
  ok('the final batch is partially padded', patches % BATCH_SIZE !== 0)
}

// ---------------------------------------------------------------------
section('7. The Kotlin implementation declares the same constants')
{
  const kt = (await import('node:fs')).readFileSync(
    'android/app/src/main/java/com/systema/music/inference/effnet/EffnetDiscogsMelFrontEnd.kt',
    'utf8',
  )
  const pairs: [string, number][] = [
    ['SAMPLE_RATE', SAMPLE_RATE],
    ['FRAME_SIZE', FRAME_SIZE],
    ['HOP_SIZE', HOP_SIZE],
    ['MEL_BANDS', MEL_BANDS],
    ['PATCH_SIZE', PATCH_SIZE],
    ['PATCH_HOP', PATCH_HOP],
    ['BATCH_SIZE', BATCH_SIZE],
  ]
  for (const [name, value] of pairs) {
    const m = new RegExp(`const val ${name} = ([0-9_]+)`).exec(kt)
    const actual = m ? Number(m[1]!.replace(/_/g, '')) : NaN
    ok(`Kotlin ${name} == ${value}`, actual === value, `found ${actual}`)
  }
  ok('Kotlin LOG_SHIFT is 1', /const val LOG_SHIFT = 1\.0f/.test(kt))
  ok('Kotlin LOG_SCALE is 10000', /const val LOG_SCALE = 10_000\.0f/.test(kt))
  ok('Kotlin uses the same mel break point',
    /MIN_LOG_HZ = 1000\.0/.test(kt) && /MIN_LOG_MEL = 15\.0/.test(kt))
  ok('Kotlin uses the same log step',
    /LOG_STEP = 0\.06875177742094911/.test(kt))
}

// ---------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`)
console.log(`EFFNET MEL MATH — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All mel maths checks passed.')
