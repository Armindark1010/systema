/**
 * SYSTEMA — CLAP decode cancellation contract tests (Phase 23.3).
 *
 * THE BUG THESE GUARD
 * -------------------
 * A normal 44.1 kHz stereo MP3 failed with:
 *
 *   "The decoder failed while reading this file (audio/mpeg, 44100 Hz,
 *    2ch): CancellationException: Channel was cancelled"
 *
 * Nothing was wrong with the file. The capped run finished early on
 * purpose, the consumer cancelled the channel to release the producer,
 * and PcmDecoder's `catch (e: Exception)` swallowed the resulting
 * CancellationException and relabelled it DECODER_ERROR — turning a
 * successful stop into a decode failure.
 *
 * These are SOURCE CONTRACT tests. Kotlin cannot be compiled or run
 * here (no JVM/Android SDK), so they assert the invariants that make
 * the cancellation path correct, and each one is mutation-verified.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(t: string) { console.log(`\n${t}`) }

const ROOT = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const DEC = 'android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt'
const SESSION = 'android/app/src/main/java/com/systema/music/inference/clap/ClapSession.kt'
const LOG = 'android/app/src/main/java/com/systema/music/inference/clap/ClapLog.kt'

const dec = read(DEC)
const session = read(SESSION)
const log = read(LOG)

/** Kotlin has no block-comment nesting here; strip both forms. */
function strip(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const decCode = strip(dec)
const sessionCode = strip(session)

// Canary: stripping must leave real code behind, or every "absence"
// assertion below would pass vacuously.
ok('canary: decoder source survived comment stripping',
  /class PcmDecoder/.test(decCode) && /runDecodeLoop/.test(decCode))
ok('canary: session source survived comment stripping',
  /class ClapSession/.test(sessionCode) && /trySendBlocking/.test(sessionCode))

// =====================================================================
section('1. THE FIX: cancellation is never relabelled as a decode error')
{
  ok('the decoder imports CancellationException',
    /import kotlin\.coroutines\.cancellation\.CancellationException/.test(dec))

  ok('the decode loop rethrows CancellationException',
    /catch \(e: CancellationException\) \{[\s\S]{0,900}?throw e/.test(decCode))

  // THE CRITICAL SITE. The runDecodeLoop wrapper is the one that
  // swallowed the real failure, so assert it SPECIFICALLY rather than
  // relying on any cancellation catch existing somewhere in the file.
  const loopWrapper = decCode.slice(
    decCode.indexOf('codec.configure(format, null, null, 0)'),
    decCode.indexOf('runCatching { codec.stop() }'),
  )
  ok('canary: the decode-loop wrapper was located',
    loopWrapper.length > 100 && /runDecodeLoop\(/.test(loopWrapper))
  ok('the decode-loop wrapper catches CancellationException',
    /catch \(e: CancellationException\)/.test(loopWrapper))
  ok('the decode-loop wrapper rethrows it unchanged',
    /catch \(e: CancellationException\) \{[\s\S]{0,600}?throw e/.test(loopWrapper))
  ok('the decode-loop wrapper still wraps real faults as DECODER_ERROR',
    /DECODER_ERROR/.test(loopWrapper))
  const wCancel = loopWrapper.indexOf('catch (e: CancellationException)')
  const wGeneric = loopWrapper.indexOf('catch (e: Exception)')
  ok('inside the wrapper, cancellation precedes the generic catch',
    wCancel >= 0 && wGeneric >= 0 && wCancel < wGeneric)

  // ORDER IS THE WHOLE BUG. CancellationException is an Exception, so a
  // generic catch placed first would swallow it again.
  const idxCancel = decCode.indexOf('catch (e: CancellationException)')
  const idxGeneric = decCode.indexOf('catch (e: Exception)')
  ok('CancellationException is caught BEFORE the generic Exception',
    idxCancel > 0 && idxGeneric > 0 && idxCancel < idxGeneric,
    `cancel@${idxCancel} generic@${idxGeneric}`)

  // Both generic catches must be shielded.
  const cancelCatches = (decCode.match(/catch \(e: CancellationException\)/g) ?? []).length
  ok('every generic Exception handler is shielded by a cancellation catch',
    cancelCatches === (decCode.match(/catch \(e: Exception\)/g) ?? []).length,
    `${cancelCatches} cancellation vs `
    + `${(decCode.match(/catch \(e: Exception\)/g) ?? []).length} generic`)

  ok('cancellation is NOT converted into DECODER_ERROR',
    !/catch \(e: CancellationException\)[\s\S]{0,300}?DECODER_ERROR/.test(decCode))
  ok('cancellation is NOT converted into a success value',
    !/catch \(e: CancellationException\)[\s\S]{0,300}?return\s/.test(decCode))
  ok('cancellation is not silently ignored',
    !/catch \(e: CancellationException\) \{\s*\}/.test(decCode))
}

// =====================================================================
section('2. The producer treats the expected stop as success')
{
  ok('the producer catches CancellationException',
    /catch \(e: CancellationException\)/.test(sessionCode))

  // It must only be swallowed when THIS coroutine is still active.
  // Otherwise a genuine cancellation of the whole request would be
  // hidden, breaking structured concurrency.
  ok('the swallow is guarded by isActive',
    /catch \(e: CancellationException\) \{[\s\S]{0,400}?if \(isActive\)/.test(sessionCode))
  ok('a genuine cancellation still propagates',
    /if \(isActive\) \{[\s\S]{0,400}?\} else \{[\s\S]{0,120}?throw e/.test(sessionCode))
  ok('isActive is imported', /import kotlinx\.coroutines\.isActive/.test(session))
  ok('CancellationException is imported in the session',
    /import kotlinx\.coroutines\.CancellationException/.test(session))

  // The pre-existing clean path must remain.
  ok('the AudioAnalysisException CANCELLED path is preserved',
    /if \(e\.code != AudioAnalysisException\.Code\.CANCELLED\) throw e/.test(sessionCode))
  ok('ClosedSendChannelException is still handled',
    /catch \(e: ClosedSendChannelException\)/.test(sessionCode))
}

// =====================================================================
section('3. Cancellation semantics are NOT weakened')
{
  // No blanket suppression anywhere in the analysis path.
  ok('no catch of Throwable swallows everything in the decoder',
    !/catch \(e: Throwable\) \{\s*\}/.test(decCode))
  ok('no arbitrary retry was added', !/retry|attempts|maxRetries/i.test(decCode))
  ok('no arbitrary timeout was added',
    !/withTimeout|TimeUnit\.SECONDS\.sleep|Thread\.sleep/.test(decCode))
  ok('the readiness gate is untouched',
    /if \(!validated\)/.test(sessionCode))
  ok('the decoder still throws CANCELLED for shouldCancel',
    /AudioAnalysisException\.Code\.CANCELLED/.test(decCode))
  ok('the rendezvous channel is unchanged',
    /Channel<FloatArray>\(Channel\.RENDEZVOUS\)/.test(sessionCode))
  ok('back-pressure still uses trySendBlocking',
    /trySendBlocking\(copy\)\.getOrThrow\(\)/.test(sessionCode))
  ok('the producer is still joined', /producer\.join\(\)/.test(sessionCode))
  ok('the channel is still closed in finally',
    /finally \{[\s\S]{0,120}?channel\.close\(\)/.test(sessionCode))
}

// =====================================================================
section('4. No fabricated result can come from a cancelled decode')
{
  ok('an empty stream is still rejected',
    /stream\.windowsProcessed == 0/.test(sessionCode)
    && /produced no embeddable audio/.test(session))
  ok('no zero vector substitution', !/FloatArray\(\d+\) \{ 0f \}/.test(sessionCode))
  ok('no fake embedding on cancellation',
    !/catch \(e: CancellationException\)[\s\S]{0,300}?(embedding|vector)\s*=/.test(sessionCode))
  ok('cosine/threshold logic is untouched',
    !/threshold|cosine/i.test(sessionCode))
}

// =====================================================================
section('5. Request tracing makes the chain visible')
{
  ok('a requestId is generated', /val requestId =/.test(sessionCode))
  ok('ANALYZE_START is logged', /ClapLog\.ANALYZE_START/.test(sessionCode))
  ok('ANALYZE_SUCCESS is logged', /ClapLog\.ANALYZE_SUCCESS/.test(sessionCode))
  ok('DECODE_STOPPED is logged', /ClapLog\.DECODE_STOPPED/.test(sessionCode))
  ok('the producer stop carries the requestId',
    /"requestId" to requestId,[\s\S]{0,80}"reason" to "consumerSaturated"/.test(sessionCode))
  ok('the consumer stop is traced',
    /"stage" to "consumerDone"/.test(sessionCode))
  ok('the constants exist', /ANALYZE_START/.test(log) && /DECODE_STOPPED/.test(log))

  // Privacy: correlation ids only, never audio or the URI.
  const traced = sessionCode.split('ClapLog.ANALYZE_START')[1]?.slice(0, 500) ?? ''
  ok('the trace does not log the URI', !/"uri" to/.test(traced))
  ok('the trace does not log audio', !/FloatArray|samples|embedding/.test(traced))
}

// =====================================================================
section('6. Playback and the DSP analyser are unaffected')
{
  ok('the decoder does not reference the player',
    !/PlayerPlugin|ExoPlayer|MediaSession/.test(decCode))
  ok('the decoder still uses MediaExtractor/MediaCodec',
    /MediaExtractor\(\)/.test(decCode) && /MediaCodec\.createDecoderByType/.test(decCode))

  // PcmDecoder is shared with the Phase 13 DSP analyser, so the change
  // must be additive: the existing error codes all still exist.
  for (const code of [
    'UNSUPPORTED_FORMAT', 'DECODER_ERROR', 'INVALID_URI',
    'EMPTY_AUDIO', 'INVALID_PCM', 'OUT_OF_MEMORY', 'CANCELLED',
  ]) {
    ok(`the ${code} path still exists`, decCode.includes(code)
      || read('android/app/src/main/java/com/systema/music/analysis/AudioAnalysisException.kt').includes(code))
  }

  ok('the PCM encoding fix from the previous phase survives',
    /ENCODING_PCM_FLOAT/.test(decCode) && /asShortBuffer\(\)/.test(decCode))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`CLAP CANCELLATION — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All CLAP cancellation tests passed.')
console.log(`
NOT PROVEN HERE: Kotlin was NOT compiled and nothing ran on a device.
These assert source invariants only. Whether the same MP3 now analyses
end to end is UNVERIFIED. REAL_DEVICE_FIX: NOT_VERIFIED.`)
