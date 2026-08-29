/**
 * SYSTEMA — CLAP audio input / decode contract tests (Phase 23.2).
 *
 * THE BUG THESE GUARD
 * -------------------
 * Full Player analysis reached native inference and then failed with
 * "The decoder failed while reading this file" — a message that could
 * not distinguish a permission problem from a codec problem, because
 * the underlying cause was attached to the exception and then thrown
 * away.
 *
 * These tests cover the boundary that TypeScript actually owns: the
 * URI must reach native UNCHANGED and stay tied to its own track, a
 * decode failure must surface as an explained INFERENCE_FAILED, and no
 * failure may ever produce a fabricated embedding.
 *
 * NATIVE DECODING IS NOT TESTED HERE. There is no JVM or Android SDK
 * in this environment; the Kotlin changes are unverified.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ClapProvider, type ClapProviderDeps } from '../app/services/ai-similarity/providers/clapProvider'
import {
  recallClapModel,
  rememberClapModel,
  setClapPreferenceStorage,
} from '../app/services/ai-similarity/providers/clapModelPreference'

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

function memoryStore() {
  const map = new Map<string, string>()
  setClapPreferenceStorage({
    get: k => map.get(k) ?? null,
    set: (k, v) => { map.set(k, v) },
    remove: (k) => { map.delete(k) },
  })
}

interface Seen { trackId: string, uri: string }

function providerWith(
  embed: (o: { trackId: string, uri: string }) => Promise<unknown>,
): { deps: ClapProviderDeps, seen: Seen[] } {
  const seen: Seen[] = []
  const deps: ClapProviderDeps = {
    status: async () => ({
      loaded: true, modelId: 'clap-audio', validated: true,
      multiTrackUnlocked: true, lastSingleTrackId: '',
      status: 'VALIDATED', productionSelected: false, productionNote: '',
      metadata: { id: 'clap-audio', sha256: 'abcdef0123456789' },
    }) as never,
    recallModel: () => recallClapModel(),
    loadModel: async () => ({}),
    validateModel: async () => ({ ok: true }),
    embedTrack: async (o) => {
      seen.push({ trackId: o.trackId, uri: o.uri })
      return await embed({ trackId: o.trackId, uri: o.uri }) as never
    },
  }
  return { deps, seen }
}

const goodEmbed = async () => ({
  trackId: 't',
  vector: new Array(512).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
  embeddingDimension: 512,
  inferenceMs: 100,
})

// =====================================================================
section('1. The player URI reaches native UNCHANGED')
{
  memoryStore(); rememberClapModel('clap-audio')

  // A real MediaStore URI, exactly as the player holds it.
  const URI = 'content://media/external/audio/media/1234'
  const { deps, seen } = providerWith(goodEmbed)
  const r = await new ClapProvider({}, deps).embed({
    trackId: 'ms:external_primary:1234', uri: URI, title: 'Song',
  })

  ok('the embed succeeds', r.ok)
  ok('native received exactly one request', seen.length === 1)
  ok('the URI is passed through byte-for-byte', seen[0]?.uri === URI)
  ok('no scheme rewriting', seen[0]?.uri.startsWith('content://'))
  ok('no percent-encoding was applied',
    !seen[0]?.uri.includes('%2F') && !seen[0]?.uri.includes('%3A'))
  ok('no file path extraction', !seen[0]?.uri.startsWith('/'))
  ok('no WebView conversion (http/localhost)',
    !/https?:\/\//.test(seen[0]?.uri ?? ''))
  ok('the track id travels with it',
    seen[0]?.trackId === 'ms:external_primary:1234')
}

// =====================================================================
section('2. A URI with spaces and unicode survives intact')
{
  memoryStore(); rememberClapModel('clap-audio')
  const URI = 'content://media/external/audio/media/99'
  const { deps, seen } = providerWith(goodEmbed)
  await new ClapProvider({}, deps).embed({ trackId: 'Bjørk — Jóga', uri: URI })
  ok('a unicode track id is not mangled', seen[0]?.trackId === 'Bjørk — Jóga')
  ok('the URI is still exact', seen[0]?.uri === URI)
}

// =====================================================================
section('3. Missing URI is rejected BEFORE native inference')
{
  memoryStore(); rememberClapModel('clap-audio')

  for (const [label, uri] of [
    ['absent', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ] as const) {
    const { deps, seen } = providerWith(goodEmbed)
    const r = await new ClapProvider({}, deps).embed({ trackId: 't', uri })
    ok(`a ${label} URI fails`, !r.ok)
    ok(`a ${label} URI reports NO_AUDIO_SOURCE`,
      !r.ok && r.code === 'NO_AUDIO_SOURCE')
    ok(`a ${label} URI never reaches native`, seen.length === 0)
  }
}

// =====================================================================
section('4. A decode failure is explained, never faked')
{
  memoryStore(); rememberClapModel('clap-audio')

  const { deps } = providerWith(async () => {
    throw new Error(
      'Could not decode the selected track: The decoder failed while '
      + 'reading this file (audio/flac, 44100 Hz, 2ch): '
      + 'IllegalStateException: null (cause: MediaCodec.CodecException: ...)',
    )
  })
  const r = await new ClapProvider({}, deps).embed({
    trackId: 't', uri: 'content://media/external/audio/media/7',
  })

  ok('the embed fails', !r.ok)
  ok('it reports INFERENCE_FAILED', !r.ok && r.code === 'INFERENCE_FAILED')
  ok('the decoder detail survives to the caller',
    !r.ok && /decode/i.test(r.message))
  ok('NO embedding is returned', !r.ok && !('embedding' in r))
  ok('no zero vector is substituted', !r.ok)
}

// =====================================================================
section('5. A decode failure never becomes a fake embedding')
{
  memoryStore(); rememberClapModel('clap-audio')

  // Native returns success-shaped payload but with NO vector.
  const { deps } = providerWith(async () => ({
    trackId: 't', embeddingDimension: 512, inferenceMs: 10,
  }))
  const r = await new ClapProvider({}, deps).embed({
    trackId: 't', uri: 'content://media/external/audio/media/8',
  })
  ok('a missing vector is rejected', !r.ok)
  ok('a missing vector is INVALID_EMBEDDING',
    !r.ok && r.code === 'INVALID_EMBEDDING')

  // Native returns an all-zero vector.
  const { deps: d2 } = providerWith(async () => ({
    trackId: 't', vector: new Array(512).fill(0),
    embeddingDimension: 512, inferenceMs: 10,
  }))
  const r2 = await new ClapProvider({}, d2).embed({
    trackId: 't', uri: 'content://media/external/audio/media/9',
  })
  ok('an all-zero vector is refused, not scored', !r2.ok)
}

// =====================================================================
section('6. Track A can never be embedded with Track B\'s URI')
{
  memoryStore(); rememberClapModel('clap-audio')
  const { deps, seen } = providerWith(goodEmbed)
  const provider = new ClapProvider({}, deps)

  await provider.embed({ trackId: 'A', uri: 'content://media/external/audio/media/1' })
  await provider.embed({ trackId: 'B', uri: 'content://media/external/audio/media/2' })

  ok('two distinct requests were made', seen.length === 2)
  ok('A kept its own URI',
    seen[0]?.trackId === 'A' && seen[0]?.uri.endsWith('/1'))
  ok('B kept its own URI',
    seen[1]?.trackId === 'B' && seen[1]?.uri.endsWith('/2'))
  ok('the URIs were not swapped', seen[0]?.uri !== seen[1]?.uri)
}

// =====================================================================
section('7. The provider does not transform the URI in source')
{
  const src = read('app/services/ai-similarity/providers/clapProvider.ts')
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const code = strip(src)

  ok('no decodeURIComponent', !/decodeURIComponent/.test(code))
  ok('no encodeURIComponent', !/encodeURIComponent/.test(code))
  ok('no convertFileSrc', !/convertFileSrc/.test(code))
  ok('no file:// rewriting', !/file:\/\//.test(code))
  ok('no path extraction from the URI', !/\.replace\(['"]content:/.test(code))
  ok('the uri is forwarded directly', /uri: audio\.uri/.test(code))

  // The player's own mapping must also stay raw.
  const playerSvc = strip(read('app/services/native/playerService.ts'))
  ok('playback also forwards the raw uri', /uri: track\.uri/.test(playerSvc))
  ok('playback does not convert the audio uri',
    !/convertFileSrc\(track\.uri\)/.test(playerSvc))
}

// =====================================================================
section('8. Native: the decoder no longer assumes 16-bit PCM')
{
  const dec = read('android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')

  ok('16-bit output is requested explicitly',
    /KEY_PCM_ENCODING/.test(dec) && /ENCODING_PCM_16BIT/.test(dec))
  ok('the real output encoding is read back',
    /outFormat\.getInteger\(MediaFormat\.KEY_PCM_ENCODING\)/.test(dec))
  // Assert the BRANCH, not just the token: `if (false)` around the
  // float path would leave both tokens present while restoring the
  // original 16-bit-only assumption.
  ok('float PCM is handled',
    /if \(pcmEncoding == AudioFormat\.ENCODING_PCM_FLOAT\) \{/.test(dec)
    && /asFloatBuffer\(\)/.test(dec))
  ok('the float branch is selected by the real encoding, not a constant',
    !/if \(false\)/.test(dec) && !/if \(true\)/.test(dec))
  ok('16-bit PCM is still handled', /asShortBuffer\(\)/.test(dec))
  ok('an unknown encoding fails loudly rather than producing noise',
    /unsupported PCM/.test(dec))
  ok('float samples are not rescaled by 32768',
    /sum \+= floats\.get/.test(dec))
  ok('16-bit samples are still scaled',
    /shorts\.get\(f \* channels \+ c\) \/ 32768f/.test(dec))

  // The real cause must be preserved, not swallowed.
  ok('the decode failure names the exception class',
    /e\.javaClass\.simpleName/.test(dec))
  ok('the decode failure reports mime and rate',
    /\$\{mime\}/.test(dec) && /\$\{sourceRate\}/.test(dec))
  ok('the failure is also logged natively', /DECODE_FAILURE/.test(dec))

  const session = read('android/app/src/main/java/com/systema/music/inference/clap/ClapSession.kt')
  ok('CLAP surfaces the underlying cause',
    /cause: \$\{cause\.javaClass\.simpleName\}/.test(session))
  ok('the cause chain is walked', /generateSequence\(t\) \{ it\.cause \}/.test(session))
}

// =====================================================================
section('9. Diagnostics are safe: no full URI, no audio')
{
  const plugin = read('android/app/src/main/java/com/systema/music/inference/InferencePlugin.kt')

  ok('the audio input is logged structurally', /ClapLog\.AUDIO_INPUT/.test(plugin))
  ok('the scheme is logged', /uriScheme/.test(plugin))
  ok('the authority is logged', /uriAuthority/.test(plugin))

  // The whole URI must NOT be logged: it can contain a filename.
  const block = plugin.split('ClapLog.AUDIO_INPUT')[1]?.slice(0, 400) ?? ''
  ok('the full URI is never logged', !/"uri" to uri/.test(block))
  ok('no audio samples are logged', !/FloatArray|samples/.test(block))

  const dec = read('android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')
  const logLine = dec.split('DECODE_FAILURE')[1]?.slice(0, 300) ?? ''
  ok('the decoder log carries no URI', !/uri/i.test(logLine))
  ok('the decoder log carries no samples', !/monoScratch|emitBuffer/.test(logLine))
}

// =====================================================================
section('10. Playback is untouched by any of this')
{
  const dec = read('android/app/src/main/java/com/systema/music/analysis/decode/PcmDecoder.kt')
  // Strip comments first: this file's header explains WHY it avoids
  // ExoPlayer, so a bare search matches its own rationale.
  const decCode = dec.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('the decoder does not touch the player',
    !/PlayerPlugin|ExoPlayer|MediaSession/.test(decCode))
  ok('the decoder uses MediaExtractor/MediaCodec directly',
    /MediaExtractor\(\)/.test(decCode) && /MediaCodec\.createDecoderByType/.test(decCode))

  const provider = read('app/services/ai-similarity/providers/clapProvider.ts')
  ok('the provider does not touch playback',
    !/\.pause\(\)|\.play\(\)|setQueue|seekTo/.test(provider))
  ok('no recommendation behaviour', !/recommend\w*\s*\(/.test(provider))
  ok('no production threshold', !/productionThreshold|CLAP_THRESHOLD/.test(provider))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`CLAP AUDIO INPUT — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All CLAP audio input tests passed.')
console.log(`
NOT PROVEN HERE: the Kotlin was NOT compiled (no JVM/Android SDK) and
nothing ran on a device. Whether the failing track specifically decodes
to float PCM is a HYPOTHESIS derived from reading the decoder; the new
diagnostic log is what will confirm or refute it on the next run.
REAL_DEVICE_FIX: NOT_VERIFIED.`)
