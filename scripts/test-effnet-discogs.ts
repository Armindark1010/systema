/**
 * SYSTEMA — Discogs-EffNet integration tests (Phase 29).
 *
 * WHAT THESE DEFEND
 * -----------------
 * A mel front end is the easiest place in this whole phase to be
 * confidently wrong. If the filterbank normalisation, the compression
 * curve or the spectrum convention is off, nothing crashes: the model
 * emits well-formed embeddings that mean nothing, the heads emit
 * plausible mood labels, and the dataset fills with noise that a human
 * then spends hours labelling.
 *
 * So these tests check the front end against Essentia's OWN published
 * constants, and check that the loader refuses anything it cannot
 * actually run — especially the .pb the model is most commonly
 * distributed as.
 */

import { readFileSync } from 'node:fs'

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

function section(name: string) {
  console.log(`\n${name}`)
}

const read = (p: string) => readFileSync(p, 'utf8')

const KT = 'android/app/src/main/java/com/systema/music/inference'
const frontEnd = read(`${KT}/effnet/EffnetDiscogsMelFrontEnd.kt`)
const model = read(`${KT}/effnet/EffnetDiscogsModel.kt`)
const preparer = read(`${KT}/ModelInputPreparer.kt`)
const importer = read(`${KT}/ModelImporter.kt`)

// =====================================================================
section('1. Front-end constants match Essentia source exactly')
{
  // Every value below was read from
  //   src/algorithms/spectral/tensorflowinputmusicnn.cpp
  //   src/algorithms/machinelearning/tensorflowpredicteffnetdiscogs.h
  // Getting any one wrong yields silently meaningless embeddings.
  const expect: [string, RegExp][] = [
    ['sample rate is 16000', /const val SAMPLE_RATE = 16_000/],
    ['frame size is 512', /const val FRAME_SIZE = 512/],
    ['hop size is 256', /const val HOP_SIZE = 256/],
    ['96 mel bands', /const val MEL_BANDS = 96/],
    ['patch size is 128 frames', /const val PATCH_SIZE = 128/],
    ['patch hop is 62 frames', /const val PATCH_HOP = 62/],
    ['a default batch of 64', /const val DEFAULT_BATCH_SIZE = 64/],
    ['log shift is 1', /const val LOG_SHIFT = 1\.0f/],
    ['log scale is 10000', /const val LOG_SCALE = 10_000\.0f/],
  ]
  for (const [label, re] of expect) ok(label, re.test(frontEnd))

  ok('the source of every constant is cited',
    /tensorflowinputmusicnn\.cpp/.test(frontEnd)
    && /tensorflowpredicteffnetdiscogs\.h/.test(frontEnd))
}

// =====================================================================
section('2. This is NOT the CLAP front end')
{
  // The two differ at every stage. Reusing CLAP's would be undetectable
  // downstream, so the difference is asserted structurally.
  ok('a separate class exists', /class EffnetDiscogsMelFrontEnd/.test(frontEnd))
  ok('it does not import ClapMelFrontEnd', !/ClapMelFrontEnd/.test(
    frontEnd.replace(/\/\*[\s\S]*?\*\//g, '')))
  ok('the difference from CLAP is documented', /WHY THIS IS NOT ClapMelFrontEnd/.test(frontEnd))

  // unit_tri, not Slaney area normalisation.
  ok('filters use unit_tri normalisation', /unit_tri/.test(frontEnd))
  ok('unit_tri is explained as unit HEIGHT', /unit HEIGHT/.test(frontEnd))
  ok('it explicitly is NOT divided by bandwidth',
    /NOT divided by bandwidth/.test(frontEnd))

  // Magnitude, not power.
  ok('the spectrum is magnitude, not power', /MAGNITUDE, not power/.test(frontEnd))
  ok('no squaring of magnitudes', !/mags\[bin\] \* mags\[bin\]/.test(frontEnd))

  // log10(1 + 10000*m), not 10*log10(max(p, 1e-10)).
  ok('compression is log10(LOG_SHIFT + LOG_SCALE * m)',
    /log10\(LOG_SHIFT \+ LOG_SCALE \* max\(0f, sum\)\)/.test(frontEnd))
  // The header contains a CLAP-vs-EffNet comparison table that names
  // CLAP's formula on purpose. Strip comments so the assertion is
  // about executable code, not documentation.
  const feCode = frontEnd
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  ok('canary: front-end code survived comment stripping',
    feCode.includes('fun melFrames'))
  ok('no CLAP-style 10*log10 in code', !/10f? \* log10/.test(feCode))
  ok('no amin floor constant in code', !/1e-10/.test(feCode))

  // Zero padding, not reflection.
  ok('frames are zero-padded, not reflected', /Zero-pad, NOT reflect/.test(frontEnd))
  ok('no reflectSample helper leaked in', !/reflectSample/.test(frontEnd))

  // The window must be unnormalised.
  ok('the Hann window is unnormalised', /UNNORMALISED/.test(frontEnd))
  ok('normalized=false is cited from source', /normalized=false/.test(frontEnd))
}

// =====================================================================
section('3. Framing arithmetic mirrors Essentia padSignal')
{
  ok('the first frame is zero-centred', /zero-CENTRED|zero-centred/.test(frontEnd))
  ok('frameCountFor subtracts half a frame',
    /\(sampleCount - frameSize \/ 2\.0\) \/ hopSize/.test(frontEnd))
  ok('frameCountFor rounds up then adds one', /1 \+ ceil\(hops\)/.test(frontEnd))
  ok('patch start offset uses -frameSize/2',
    /f \* hopSize - frameSize \/ 2/.test(frontEnd))

  // lastPatchMode = discard: floor, never ceil.
  ok('patchCountFor floors (lastPatchMode=discard)',
    /1 \+ \(\(frameCount - PATCH_SIZE\) \/ PATCH_HOP\)/.test(frontEnd))
  ok('too-short audio yields zero patches, not one padded patch',
    /if \(frameCount < PATCH_SIZE\) return 0/.test(frontEnd))

  // Numeric check of the documented formulas.
  const HOP = 256
  const FRAME = 512
  const PATCH = 128
  const PHOP = 62
  const frameCountFor = (n: number) => n <= 0 ? 0 : 1 + Math.ceil((n - FRAME / 2) / HOP)
  const patchCountFor = (f: number) => f < PATCH ? 0 : 1 + Math.floor((f - PATCH) / PHOP)

  ok('16000 samples (1 s) -> 63 frames', frameCountFor(16000) === 63,
    String(frameCountFor(16000)))
  ok('1 s of audio yields NO complete patch', patchCountFor(frameCountFor(16000)) === 0)
  ok('~2.1 s yields exactly one patch', patchCountFor(frameCountFor(33280)) === 1,
    String(patchCountFor(frameCountFor(33280))))
  ok('30 s yields many patches', patchCountFor(frameCountFor(16000 * 30)) > 20)

  // A patch is ~2.05 s; the prediction rate is ~1.008 Hz.
  const patchSeconds = ((PATCH - 1) * HOP + FRAME) / 16000
  ok('one patch is about 2 seconds of audio',
    patchSeconds > 1.9 && patchSeconds < 2.2, patchSeconds.toFixed(3))
  const rate = 16000 / (PHOP * HOP)
  ok('patch hop gives ~1.008 Hz prediction rate',
    Math.abs(rate - 1.008) < 0.01, rate.toFixed(4))
}

// =====================================================================
section('4. Output tensor shape is [batch, 128, 96]')
{
  ok('toBatch emits the documented shape',
    /listOf\(\s*batchSize\.toLong\(\),\s*PATCH_SIZE\.toLong\(\),\s*melBands\.toLong\(\)\s*\)/
      .test(frontEnd))
  ok('the tensor is sized batch*patch*bands',
    /FloatArray\(batchSize \* PATCH_SIZE \* melBands\)/.test(frontEnd))
  // The batch is a property of the EXPORT, not of the front end.
  ok('the batch size is a parameter, not a constant',
    /fun toBatch\([^)]*batchSize: Int/s.test(frontEnd))
  ok('a dynamic export can run the whole track in one call',
    /fun toSingleBatch\(/.test(frontEnd))

  const elements = 64 * 128 * 96
  ok('a full batch is 786432 floats', elements === 786432)
  ok('that is ~3.1 MB at 4 bytes each',
    Math.abs(elements * 4 / 1e6 - 3.14) < 0.1)

  // The zero-padded tail must be traceable, never silently averaged in.
  ok('realPatchCount is reported', /realPatchCount/.test(frontEnd))
  ok('padding slots are documented as deliberate',
    /stay zero — deliberately/.test(frontEnd))
  ok('predictions from padding must be discarded',
    /MUST be discarded/.test(frontEnd))
  ok('toBatch returns null when no complete patch exists',
    /if \(available <= 0\) return null/.test(frontEnd))
}

// =====================================================================
section('5. The .pb is rejected with an actionable message')
{
  ok('rejectionReasonFor exists', /fun rejectionReasonFor/.test(model))
  ok('.pb is rejected', /lower\.endsWith\("\.pb"\)/.test(model))
  ok('the .pb message names it a TensorFlow frozen graph',
    /TensorFlow frozen graph/.test(model))
  // Kotlin concatenation splits phrases across source lines, so
  // normalise whitespace and quote-plus-quote joins before matching.
  const modelText = model.replace(/"\s*\+\s*\n?\s*"/g, '').replace(/\s+/g, ' ')
  ok('canary: model text was joined', modelText.includes('TensorFlow frozen graph'))
  ok('it explains SYSTEMA is ONNX-only',
    /SYSTEMA runs ONNX Runtime only/.test(modelText))
  ok('it names the correct file to download instead',
    /download '\$MODEL_ID\.onnx' instead|Download '\$MODEL_ID\.onnx'/.test(model))
  ok('it states no conversion is needed for the embedding',
    /No conversion is required for the embedding model/.test(modelText))
  ok('it refuses to suggest adding TensorFlow',
    /second inference architecture/.test(modelText))

  ok('.tflite is rejected', /\.tflite/.test(model))
  ok('.pt / .pth are rejected', /\.pt"\)|\.pth"/.test(model))
  ok('anything not .onnx is rejected', /!lower\.endsWith\("\.onnx"\)/.test(model))
  ok('a .onnx file passes the format gate', /else -> null/.test(model))

  // The check must run BEFORE the file is copied.
  const rejectIdx = importer.indexOf('rejectionReasonFor')
  const copyIdx = importer.indexOf('copyToStaging(uri, staging)')
  ok('rejection happens before the copy', rejectIdx !== -1 && rejectIdx < copyIdx)
  ok('the importer imports the model object',
    /import com\.systema\.music\.inference\.effnet\.EffnetDiscogsModel/.test(importer))
}

// =====================================================================
section('6. Model identity and signature verification')
{
  ok('model id matches the official file name',
    /const val MODEL_ID = "discogs-effnet-bs64-1"/.test(model))
  ok('version is recorded', /const val VERSION = "1"/.test(model))
  ok('the input node name is the documented one',
    /const val INPUT_NAME = "serving_default_melspectrogram"/.test(model))
  ok('embeddings come from PartitionedCall:1',
    /const val OUTPUT_EMBEDDINGS = "PartitionedCall:1"/.test(model))
  ok('styles are PartitionedCall:0, kept separate',
    /const val OUTPUT_STYLES = "PartitionedCall:0"/.test(model))
  ok('embedding dimension is 1280', /const val EMBEDDING_DIM = 1280/.test(model))
  ok('style class count is 400', /const val STYLE_CLASS_COUNT = 400/.test(model))
  ok('the non-commercial licence is recorded',
    /const val LICENSE = "CC-BY-NC-SA-4\.0"/.test(model))

  // Signature verification is the guard against loading a lookalike.
  ok('verifySignature exists', /fun verifySignature/.test(model))
  ok('a missing 1280-d output is a hard failure',
    /No \$\{EMBEDDING_DIM\}-d embedding output found/.test(model))
  ok('a wrong embedding width is a hard failure',
    /is \$width-d, expected/.test(model))
  ok('a mel-band mismatch is a hard failure',
    /expects \$melBands mel bands but the front end produces/.test(model))
  ok('the failure explains why width equals identity',
    /different model, not a compatible one/.test(model))
}

// =====================================================================
section('7. The embedding is never treated as a prediction')
{
  ok('the model is documented as an embedding model',
    /is an EMBEDDING model/.test(model))
  ok('it states it is NOT a genre classifier',
    /NOT a genre classifier/.test(model))
  ok('it states it is NOT a mood classifier',
    /NOT a mood classifier/.test(model))
  ok('it states it is NOT a vocal detector',
    /NOT a vocal detector/.test(model))
  ok('it says heads are required', /require separate classification heads/.test(model))

  // The 400 style logits are real output but a DIFFERENT taxonomy.
  ok('Discogs styles are not surfaced as MTG-Jamendo genre',
    /different taxonomy from/.test(model))
  ok('using styles would require labelling them as Discogs styles',
    /labelled as Discogs styles/.test(model))

  // No classification vocabulary may appear in the embedding layer.
  const combined = `${frontEnd}\n${model}`
  for (const word of ['melancholic', 'energetic', 'happy', 'sad']) {
    ok(`no "${word}" label in the embedding layer`,
      !new RegExp(`"${word}"`).test(combined))
  }
}

// =====================================================================
section('8. The mel path is enabled for THIS model only')
{
  ok('LOG_MEL_SPECTROGRAM dispatches to the EffNet front end',
    /InputFormat\.LOG_MEL_SPECTROGRAM ->/.test(preparer)
    && /EffnetDiscogsModel\.prepareMel/.test(preparer))
  ok('it is gated on the model being EffNet',
    /EffnetDiscogsModel\.isEffnetDiscogs\(model\)/.test(preparer))
  ok('any other log-mel model is still refused',
    /SYSTEMA has no front end matching ITS training/.test(preparer))
  ok('plain MEL_SPECTROGRAM is still refused',
    /InputFormat\.MEL_SPECTROGRAM\s*\n?\s*-> throw InferenceException/.test(preparer))
  ok('the reason for the narrow gate is documented',
    /must not become "any mel model will work"/.test(preparer))
}

// =====================================================================
section('9. Refuses to fabricate input')
{
  ok('a wrong sample rate is rejected, not resampled',
    /requires \$expected Hz mono PCM but received/.test(model))
  ok('it refuses to resample locally',
    /resampling here would hide a configuration error/.test(model))
  ok('audio shorter than one patch is rejected',
    /Need at least \$minimum samples/.test(model))
  ok('it refuses to pad silence into a patch',
    /Padding with silence would make the/.test(model))
  ok('minimumSamplesForOnePatch is derived, not guessed',
    /\(PATCH_SIZE - 1\) \* hopSize \+ frameSize \/ 2 \+ 1/.test(frontEnd))

  // The length guard must be a real comparison against the derived
  // minimum. Weakening it to a constant-false condition would let a
  // 200 ms clip through and the model would describe silence.
  ok('the short-audio guard compares against the minimum',
    /if \(pcm\.size < minimum\) \{/.test(model))
  ok('the minimum comes from the front end, not a literal',
    /val minimum = frontEnd\.minimumSamplesForOnePatch\(\)/.test(model))
  ok('the guard is not disabled', !/if \(false\) \{/.test(model))

  // The embedding width check is the only thing standing between a
  // 512-d CLAP model and the classification heads.
  ok('the width check compares against EMBEDDING_DIM',
    /if \(width != EMBEDDING_DIM\) \{/.test(model))
  ok('the width check is not a tautology',
    !/if \(width != null && width < 0\)/.test(model))
  ok('the too-short path documents the fabrication risk',
    /never as a zero-filled patch/.test(frontEnd))

  // No randomness, anywhere.
  ok('no Math.random in the front end', !/Math\.random|Random\(/.test(frontEnd))
  ok('no random in the model wrapper', !/Math\.random|Random\(/.test(model))
}

// =====================================================================
section('10. Reuses the existing pipeline, adds no second loader')
{
  ok('no OrtEnvironment in the new files',
    !/OrtEnvironment/.test(frontEnd) && !/OrtEnvironment/.test(model))
  ok('no OrtSession in the new files',
    !/OrtSession/.test(frontEnd) && !/OrtSession/.test(model))
  ok('no file loading in the new files',
    !/FileInputStream|File\(/.test(frontEnd))
  ok('the model contributes a ModelDescriptor instead',
    /fun descriptorFor\(/.test(model) && /ModelDescriptor\(/.test(model))
  ok('the descriptor declares LOG_MEL_SPECTROGRAM',
    /inputFormat = InputFormat\.LOG_MEL_SPECTROGRAM/.test(model))
  ok('the descriptor declares 16 kHz',
    /inputSampleRate = EffnetDiscogsMelFrontEnd\.SAMPLE_RATE/.test(model))
  ok('the descriptor declares mono', /inputChannels = 1/.test(model))
  ok('the reason for reusing the pipeline is documented',
    /WHY A DESCRIPTOR AND NOT A NEW LOADER/.test(model))
  ok('it reuses the shared FFT primitive',
    /import com\.systema\.music\.analysis\.dsp\.Fft/.test(frontEnd))
  ok('it does not alter Phase 13 analysis',
    !/AudioAnalysisPlugin|SongAnalysis/.test(frontEnd))
}

// =====================================================================
section('11. Runtime readiness is reported honestly')
{
  const rt = await import('../app/services/music-semantics/providers/semanticRuntime')

  ok('the mel front-end requirement is now satisfied',
    rt.RUNTIME_REQUIREMENTS.find(r => r.id === 'mel-frontend')?.done === true)
  ok('the embedding weights are still outstanding',
    rt.RUNTIME_REQUIREMENTS.find(r => r.id === 'embedding-weights')?.done === false)
  ok('head conversion is still outstanding',
    rt.RUNTIME_REQUIREMENTS.find(r => r.id === 'head-conversion')?.done === false)
  // Phase 29.x: the EMBEDDING bridge now exists end to end.
  ok('the native bridge for the embedding is wired',
    rt.RUNTIME_REQUIREMENTS.find(r => r.id === 'native-bridge')?.done === true)
  ok('the tags label list is tracked as outstanding',
    rt.RUNTIME_REQUIREMENTS.find(r => r.id === 'head-labels-top50tags')?.done === false)

  // The critical one: partial progress must NOT read as ready.
  ok('the runtime is still NOT ready', rt.isRuntimeReady() === false)
  ok('outstanding work is still listed', rt.outstandingRequirements().length >= 3)
  ok('the not-ready message reflects that mel is done',
    /mel front-end is implemented/.test(rt.RUNTIME_NOT_READY_MESSAGE))
  ok('it still names what is missing',
    /side-loaded/.test(rt.RUNTIME_NOT_READY_MESSAGE))

  // Off-device, inference must refuse rather than simulate. This test
  // runs in Node, where Capacitor reports a non-native platform.
  const emb = await rt.runEmbedding({ trackId: 't', uri: 'content://x' })
  ok('runEmbedding refuses to return data off-device', emb.ok === false)
  ok('with PROVIDER_UNAVAILABLE, naming the platform as the reason',
    !emb.ok && emb.code === 'PROVIDER_UNAVAILABLE')
  ok('and never a simulated vector',
    !emb.ok && !('value' in emb))

  // A missing URI is a DIFFERENT failure from a missing platform.
  const noUri = await rt.runEmbedding({ trackId: 't' })
  ok('a track with no URI fails distinctly', noUri.ok === false)
}

// =====================================================================
section('12. Documentation records the verified spec')
{
  const doc = read('docs/phase-29-semantic-model.md')
  ok('the addendum exists', /Addendum — verified preprocessing spec/.test(doc))
  ok('it cites tensorflowinputmusicnn.cpp', /tensorflowinputmusicnn\.cpp/.test(doc))
  ok('it records frame 512 / hop 256', /512/.test(doc) && /256/.test(doc))
  ok('it records unit_tri', /unit_tri/.test(doc))
  ok('it records the compression formula',
    /log10\(1 \+ 10000 \* melBands\)/.test(doc))
  const docText = doc.replace(/\s+/g, ' ')
  ok('it warns CLAP\'s front end must not be reused',
    /ClapMelFrontEnd` must not be reused for this model/i.test(docText))
  ok('it notes magnitude vs power', /magnitude, \*\*not power\*\*|not power/.test(doc))
  ok('it records the 3-D vs 4-D shape caveat',
    /channel axis is absent/.test(doc))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`EFFNET DISCOGS — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All Discogs-EffNet tests passed.')
