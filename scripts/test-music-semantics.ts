/**
 * SYSTEMA — Phase 29 semantic analysis test suite.
 *
 * WHAT THIS SUITE IS ACTUALLY DEFENDING
 * -------------------------------------
 * The failure mode for this phase is not a crash. It is a UI full of
 * confident mood labels that came from nowhere — a hardcoded example, a
 * BPM heuristic, a random number, or real scores zipped onto the wrong
 * label list. Every one of those looks completely correct on screen and
 * silently destroys the dataset's value.
 *
 * So most of these assertions are about provenance, not behaviour:
 * where a number came from, whether a label is the model's or the
 * human's, and whether "we cannot do this" survives contact with the
 * UI instead of being smoothed into a plausible answer.
 */

import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(label: string, cond: boolean) {
  if (cond) passed++
  else {
    failed++
    failures.push(label)
    console.log(`  ✗ ${label}`)
  }
}

function section(name: string) {
  console.log(`\n${name}`)
}

const read = (p: string) => readFileSync(p, 'utf8')

/** Comments must never satisfy a source assertion. */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

// =====================================================================
section('1. Contracts name no model')
{
  const types = strip(read('app/services/music-semantics/types.ts'))
  ok('canary: contracts located', types.includes('MusicSemanticAnalysisProvider'))

  // The whole point of the abstraction.
  for (const banned of ['essentia', 'jamendo', 'effnet', 'discogs', 'Essentia', 'Jamendo']) {
    ok(`contracts do not mention "${banned}"`, !types.includes(banned))
  }

  ok('the provider contract exists', /interface MusicSemanticAnalysisProvider/.test(types))
  ok('it declares analyze', /analyze\(input: SemanticAudioInput\)/.test(types))
  ok('it declares status', /status\(\): Promise<SemanticProviderStatus>/.test(types))
  ok('it declares release', /release\(\): Promise<void>/.test(types))
  ok('a prediction carries label and score',
    /interface SemanticPrediction \{[\s\S]*?label: string[\s\S]*?score: number/.test(types))
  ok('experimental is the literal true, not boolean',
    /experimental: true/.test(types) && !/experimental: boolean/.test(types))
  ok('activation is modelled explicitly',
    /type SemanticActivation = 'sigmoid' \| 'softmax'/.test(types))
  ok('multi-label is tracked per head', /multiLabel: boolean/.test(types))
  ok('class count is tracked so truncation is detectable',
    /classCount: number/.test(types))
}

// =====================================================================
section('2. Taxonomies are real, verbatim, and order-critical')
{
  const tax = await import('../app/services/music-semantics/providers/jamendoTaxonomy')

  ok('mood head has exactly 56 classes', tax.MOODTHEME_TAXONOMY.labels.length === 56)
  ok('mood head is sigmoid', tax.MOODTHEME_TAXONOMY.activation === 'sigmoid')
  ok('mood head is multi-label', tax.MOODTHEME_TAXONOMY.multiLabel === true)
  ok('mood labels include melancholic', tax.MOODTHEME_TAXONOMY.labels.includes('melancholic'))
  ok('mood labels include the theme tags too (advertising)',
    tax.MOODTHEME_TAXONOMY.labels.includes('advertising'))
  ok('mood label order starts at "action"', tax.MOODTHEME_TAXONOMY.labels[0] === 'action')
  ok('mood label order ends at "uplifting"',
    tax.MOODTHEME_TAXONOMY.labels[55] === 'uplifting')
  ok('the published weak PR-AUC is recorded, not hidden',
    tax.MOODTHEME_TAXONOMY.metrics?.testPrAuc === 0.14)

  ok('genre head has 87 classes', tax.GENRE_TAXONOMY.labels.length === 87)
  ok('genre head is multi-label', tax.GENRE_TAXONOMY.multiLabel === true)

  ok('voice head has 2 classes', tax.VOICE_INSTRUMENTAL_TAXONOMY.labels.length === 2)
  ok('voice head is softmax, not sigmoid',
    tax.VOICE_INSTRUMENTAL_TAXONOMY.activation === 'softmax')
  ok('voice head is single-label', tax.VOICE_INSTRUMENTAL_TAXONOMY.multiLabel === false)
  // Index order is the contract; reversing it inverts every prediction.
  ok('voice index 0 is instrumental',
    tax.VOICE_INSTRUMENTAL_TAXONOMY.labels[0] === 'instrumental')
  ok('voice index 1 is voice', tax.VOICE_INSTRUMENTAL_TAXONOMY.labels[1] === 'voice')

  // The head whose labels could not be obtained must stay unusable.
  ok('top50tags is flagged unavailable', tax.TOP50TAGS_TAXONOMY.labelsUnavailable === true)
  ok('top50tags has NO invented labels', tax.TOP50TAGS_TAXONOMY.labels.length === 0)
  ok('usableTaxonomies excludes it',
    !tax.usableTaxonomies().some(t => t.head.includes('top50tags')))

  ok('the embedding model expects 16 kHz', tax.EMBEDDING_MODEL.sampleRate === 16000)
  ok('the embedding is 1280-d', tax.EMBEDDING_MODEL.embeddingDim === 1280)
  ok('the licence is recorded in code', tax.MODEL_LICENSE.spdx === 'CC-BY-NC-SA-4.0')
  ok('non-commercial restriction is explicit',
    tax.MODEL_LICENSE.commercialUseAllowed === false)
}

// =====================================================================
section('3. zipPredictions refuses to mislabel')
{
  const { MOODTHEME_TAXONOMY, TOP50TAGS_TAXONOMY, VOICE_INSTRUMENTAL_TAXONOMY, zipPredictions }
    = await import('../app/services/music-semantics/providers/jamendoTaxonomy')

  const good = Array.from({ length: 56 }, (_, i) => i / 56)
  const zipped = zipPredictions(MOODTHEME_TAXONOMY, good)
  ok('a correct-length array zips', zipped !== null && zipped.length === 56)
  ok('label 0 maps to score 0', zipped?.[0]?.label === 'action')
  ok('the last label maps to the last score',
    zipped?.[55]?.label === 'uplifting' && zipped?.[55]?.score === 55 / 56)

  // The assertion that stops 56 scores landing on 87 labels.
  ok('a short array is REJECTED, not padded',
    zipPredictions(MOODTHEME_TAXONOMY, [0.1, 0.2]) === null)
  ok('a long array is REJECTED, not truncated',
    zipPredictions(MOODTHEME_TAXONOMY, Array(87).fill(0.5)) === null)
  ok('NaN scores are rejected',
    zipPredictions(VOICE_INSTRUMENTAL_TAXONOMY, [Number.NaN, 1]) === null)
  ok('a head with no label list is rejected',
    zipPredictions(TOP50TAGS_TAXONOMY, [0.5]) === null)
}

// =====================================================================
section('4. The runtime never fabricates')
{
  const src = strip(read('app/services/music-semantics/providers/semanticRuntime.ts'))
  ok('canary: runtime located', src.includes('runEmbedding'))

  // The forbidden shortcuts.
  ok('no Math.random', !/Math\.random/.test(src))
  ok('no hardcoded example predictions', !/melancholic|energetic|'happy'/.test(src))
  ok('no zero-vector stand-in', !/fill\(0\)|new Array\([0-9]+\)\.fill/.test(src))
  ok('unready runtime reports PROVIDER_NOT_READY',
    /code: 'PROVIDER_NOT_READY'/.test(src))
  ok('the requirements are enumerated, not vague',
    /RUNTIME_REQUIREMENTS/.test(src) && /mel-frontend/.test(src))

  const rt = await import('../app/services/music-semantics/providers/semanticRuntime')
  ok('the runtime honestly reports itself as not ready', rt.isRuntimeReady() === false)
  ok('outstanding work is listed', rt.outstandingRequirements().length >= 3)

  const emb = await rt.runEmbedding({ trackId: 't', uri: 'content://x' })
  ok('runEmbedding fails rather than returning data', emb.ok === false)
  // Off-device (this test runs in Node) the honest answer is
  // PROVIDER_UNAVAILABLE: there is no native runtime here at all, which
  // is a different situation from a device that simply lacks the model.
  // Both are refusals; neither returns a vector.
  ok('and says why', !emb.ok
    && (emb.code === 'PROVIDER_UNAVAILABLE' || emb.code === 'PROVIDER_NOT_READY'))
  ok('a refusal never carries a value', !emb.ok && !('value' in emb))

  const head = await rt.runHead('any', [0.1])
  ok('runHead fails rather than returning scores', head.ok === false)
}

// =====================================================================
section('5. Provider contract: injectable, replaceable, honest')
{
  const reg = await import('../app/services/music-semantics/index')

  const real = reg.createMusicSemanticProvider()
  ok('the default provider builds', real !== null)
  ok('an unknown id returns null, not a throw',
    reg.createMusicSemanticProvider('nope') === null)

  const status = await real!.status()
  ok('status reports not-ready today', status.ready === false)
  ok('status still names the model', status.model !== null)
  ok('status explains why', typeof status.detail === 'string' && status.detail!.length > 20)

  // Failure propagation: no audio source must not become a fake result.
  const noUri = await real!.analyze({ trackId: 't1' })
  ok('a track with no URI is refused', noUri.ok === false)
  ok('with NO_AUDIO_SOURCE', !noUri.ok && noUri.code === 'NO_AUDIO_SOURCE')

  const notReady = await real!.analyze({ trackId: 't1', uri: 'content://media/1' })
  ok('an unready provider fails', notReady.ok === false)
  ok('with an honest not-ready code, not a fabricated result',
    !notReady.ok
    && (notReady.code === 'PROVIDER_NOT_READY'
      || notReady.code === 'PROVIDER_UNAVAILABLE'))
  ok('the failure names no fabricated prediction',
    !notReady.ok && !JSON.stringify(notReady).includes('melancholic'))

  // Replaceability — the reason the abstraction exists.
  const fake = {
    id: 'fake',
    async status() {
      return {
        available: true, ready: true, model: 'fake', modelVersion: '9',
        supports: ['mood' as const], detail: null,
      }
    },
    async analyze() {
      return {
        ok: true as const,
        result: {
          trackId: 't', model: 'fake', modelVersion: '9', heads: [], unsupported: [],
          sourceDurationSec: 1, processedDurationSec: 1, sampleRate: 16000,
          decodeMs: 1, inferenceMs: 1, analyzedAt: new Date().toISOString(),
          experimental: true as const,
        },
      }
    },
    async release() {},
  }
  reg.setSemanticProviderOverride(fake)
  ok('a substitute provider is used', reg.createMusicSemanticProvider()!.id === 'fake')
  reg.setSemanticProviderOverride(null)
  ok('the override clears', reg.createMusicSemanticProvider()!.id !== 'fake')
}

// =====================================================================
section('6. Generic layers leak no model detail')
{
  // The index re-exports provider specifics deliberately; the CONTRACTS
  // and every consumer must stay clean.
  for (const f of [
    'app/services/ai-dataset/semanticRecord.ts',
    'app/services/ai-dataset/semanticEvaluation.ts',
    'app/services/ai-dataset/semanticBridge.ts',
  ]) {
    const src = strip(read(f))
    ok(`${f.split('/').pop()} names no model vendor`,
      !/essentia|effnet|discogs/i.test(src))
  }

  const bridge = strip(read('app/services/ai-dataset/semanticBridge.ts'))
  ok('the bridge depends on the generic result type',
    /SemanticAnalysisResult/.test(bridge))
  ok('the bridge does not import a provider',
    !/providers\//.test(bridge))
}

// =====================================================================
section('7. Prediction and ground truth never merge')
{
  const rec = await import('../app/services/ai-dataset/semanticRecord')

  const valid = {
    model: 'm', modelVersion: '1', analyzerVersion: 1,
    heads: [{
      field: 'mood' as const, head: 'h', headVersion: '1',
      activation: 'sigmoid' as const, multiLabel: true, classCount: 2,
      predictions: [{ label: 'sad', score: 0.9 }, { label: 'happy', score: 0.1 }],
    }],
    unsupported: [], sourceDurationSec: 1, processedDurationSec: 1,
    sampleRate: 16000, decodeMs: 1, inferenceMs: 2,
    analyzedAt: new Date().toISOString(),
    experimental: true as const, source: 'model' as const,
  }
  ok('a well-formed semantic region validates', rec.isSemanticAnalysis(valid))

  // The central integrity rule, both directions.
  ok('source must be "model" — "human" is rejected',
    !rec.isSemanticAnalysis({ ...valid, source: 'human' }))
  ok('experimental:false is rejected',
    !rec.isSemanticAnalysis({ ...valid, experimental: false }))

  // Truncation must not survive a round trip.
  ok('a truncated prediction list is rejected',
    !rec.isSemanticAnalysis({
      ...valid,
      heads: [{ ...valid.heads[0]!, predictions: [{ label: 'sad', score: 0.9 }] }],
    }))
  ok('an out-of-range score is rejected (logits, not activations)',
    !rec.isSemanticAnalysis({
      ...valid,
      heads: [{
        ...valid.heads[0]!,
        predictions: [{ label: 'sad', score: 4.2 }, { label: 'happy', score: 0.1 }],
      }],
    }))
  ok('a missing model version is rejected',
    !rec.isSemanticAnalysis({ ...valid, modelVersion: undefined }))
  ok('coerce returns null for corrupt input',
    rec.coerceSemanticAnalysis({ ...valid, source: 'human' }) === null)

  ok('topFor picks the highest score',
    rec.topFor(valid, 'mood')?.label === 'sad')
  ok('topFor returns null for an absent field',
    rec.topFor(valid, 'genre') === null)

  // Cache identity.
  ok('same build matches', rec.isSameSemanticBuild(valid, 'm', '1', 1))
  ok('a different model version does NOT match',
    !rec.isSameSemanticBuild(valid, 'm', '2', 1))
  ok('a different analyzer version does NOT match',
    !rec.isSameSemanticBuild(valid, 'm', '1', 2))
}

// =====================================================================
section('8. Persistence: predictions save, reload, and never eat labels')
{
  const { setDatasetGateway, saveAnalysis, saveLabels, saveSemanticAnalysis, getRecord, resetDatasetGateway }
    = await import('../app/services/ai-dataset/datasetService')
  const { MemoryDatasetGateway } = await import('../app/services/ai-dataset/memoryGateway')
  const { emptyLabels } = await import('../app/services/ai-dataset/labels')

  class Room extends MemoryDatasetGateway {
    override readonly id = 'room'
    override readonly durable = true
  }
  const room = new Room()
  setDatasetGateway(room)

  const w = await saveAnalysis({
    track: { trackId: 'tr-1', title: 'Raze Penhoon', artist: 'X', album: null, sourceUri: null },
    measurements: { bpm: 90 },
    embedding: {
      vector: Array.from({ length: 512 }, () => 0.1), dimension: 512,
      model: 'clap', modelVersion: 'v1', normalized: true, preNormalizationL2: 1,
    },
    analyzerVersion: 1, status: 'COMPLETED',
  } as never)
  ok('base analysis row created', w.ok === true)
  const id = w.record!.id
  ok('a fresh row has no prediction', w.record!.semantic === null)

  const semantic = {
    model: 'discogs-effnet-bs64', modelVersion: '1', analyzerVersion: 1,
    heads: [{
      field: 'mood' as const, head: 'moodtheme', headVersion: '1',
      activation: 'sigmoid' as const, multiLabel: true, classCount: 3,
      predictions: [
        { label: 'melancholic', score: 0.82 },
        { label: 'sad', score: 0.71 },
        { label: 'calm', score: 0.63 },
      ],
    }],
    unsupported: [], sourceDurationSec: 200, processedDurationSec: 60,
    sampleRate: 16000, decodeMs: 300, inferenceMs: 900,
    analyzedAt: new Date().toISOString(),
    experimental: true as const, source: 'model' as const,
  }

  const sw = await saveSemanticAnalysis(id, semantic)
  ok('the semantic write succeeds', sw.ok === true)

  const back = await getRecord(id)
  ok('the prediction reloads', back?.semantic !== null)
  ok('the model is persisted', back?.semantic?.model === 'discogs-effnet-bs64')
  ok('the model version is persisted', back?.semantic?.modelVersion === '1')
  ok('the COMPLETE ranked list survives', back?.semantic?.heads[0]?.predictions.length === 3)
  ok('scores survive exactly', back?.semantic?.heads[0]?.predictions[0]?.score === 0.82)
  ok('the trackId is unchanged', back?.track.trackId === 'tr-1')
  ok('experimental is preserved', back?.semantic?.experimental === true)
  ok('ground truth is still empty — a prediction is not a label',
    back?.groundTruth.moods.length === 0 && back?.groundTruth.revision === 0)

  // Human labels, then a re-analysis.
  const l = await saveLabels(id, { ...emptyLabels(), moods: ['sad'], vocal: 'vocal' })
  ok('human labels save alongside the prediction', l.ok === true)
  ok('label revision is 1', l.record!.groundTruth.revision === 1)
  ok('the prediction survived labelling', l.record!.semantic !== null)

  const re = await saveAnalysis({
    track: { trackId: 'tr-1', title: 'Raze Penhoon', artist: 'X', album: null, sourceUri: null },
    measurements: { bpm: 93 },
    embedding: {
      vector: Array.from({ length: 512 }, () => 0.2), dimension: 512,
      model: 'clap', modelVersion: 'v1', normalized: true, preNormalizationL2: 1,
    },
    analyzerVersion: 1, status: 'COMPLETED',
  } as never)
  ok('re-analysis targets the same row', re.record!.id === id)
  ok('re-analysis PRESERVES human labels', re.record!.groundTruth.moods[0] === 'sad')
  ok('re-analysis does not bump label revision',
    re.record!.groundTruth.revision === 1)
  ok('re-analysis carries the prediction forward rather than wiping it',
    re.record!.semantic?.heads[0]?.predictions.length === 3)

  // A malformed prediction must not be stored as if it were fine.
  const bad = await saveSemanticAnalysis(id, { ...semantic, source: 'human' } as never)
  ok('a prediction claiming human source is refused', bad.ok === false)
  const stillGood = await getRecord(id)
  ok('the refused write changed nothing',
    stillGood?.semantic?.source === 'model')

  // The write that must not touch the human region. Asserted field by
  // field, because a partial copy is the realistic bug: someone spreads
  // a fresh emptyLabels() and only the moods array goes missing.
  const before = await getRecord(id)
  const sw2 = await saveSemanticAnalysis(id, {
    ...semantic, inferenceMs: 1234,
  })
  ok('a second semantic write succeeds', sw2.ok === true)
  const after = await getRecord(id)
  ok('the new prediction landed', after?.semantic?.inferenceMs === 1234)
  ok('groundTruth.moods survived the semantic write',
    JSON.stringify(after?.groundTruth.moods) === JSON.stringify(before?.groundTruth.moods))
  ok('groundTruth.vocal survived', after?.groundTruth.vocal === before?.groundTruth.vocal)
  ok('groundTruth.revision was NOT bumped by a model write',
    after?.groundTruth.revision === before?.groundTruth.revision)
  ok('the entire groundTruth object is byte-identical',
    JSON.stringify(after?.groundTruth) === JSON.stringify(before?.groundTruth))

  const missing = await saveSemanticAnalysis('no-such-id', semantic)
  ok('writing to a nonexistent row fails', missing.ok === false)

  resetDatasetGateway()
}

// =====================================================================
section('9. Evaluation uses multi-label metrics correctly')
{
  const ev = await import('../app/services/ai-dataset/semanticEvaluation')
  const { emptyLabels } = await import('../app/services/ai-dataset/labels')

  function row(moods: string[], predicted: [string, number][]) {
    return {
      id: Math.random().toString(), schemaVersion: 2,
      track: { trackId: 't', title: null, artist: null, album: null, sourceUri: null },
      measurements: {} as never, embedding: null,
      processing: { analyzerVersion: 1, analysisDurationMs: null, decodeDurationMs: null, inferenceDurationMs: null, experimental: true },
      semantic: {
        model: 'm', modelVersion: '1', analyzerVersion: 1,
        heads: [{
          field: 'mood' as const, head: 'h', headVersion: '1',
          activation: 'sigmoid' as const, multiLabel: true,
          classCount: predicted.length,
          predictions: predicted.map(([label, score]) => ({ label, score })),
        }],
        unsupported: [], sourceDurationSec: null, processedDurationSec: null,
        sampleRate: null, decodeMs: null, inferenceMs: null,
        analyzedAt: '', experimental: true as const, source: 'model' as const,
      },
      groundTruth: { ...emptyLabels(), moods: moods as never },
      status: 'COMPLETED' as const, errorCode: null, errorMessage: null,
      createdAt: '', updatedAt: '', supersededAt: null,
    }
  }
  const semanticOf = (r: { semantic: unknown }) => r.semantic as never

  // Too little data must refuse to produce a number.
  const few = [row(['sad'], [['sad', 0.9]])]
  const r1 = ev.evaluateField(few as never, semanticOf, ev.MOOD_LABEL_MAPPING)
  ok('below the minimum, no metric is computed', r1.kind === 'insufficient')
  ok('and it says so plainly',
    r1.kind === 'insufficient' && r1.message === 'Not enough labelled data')
  ok('it reports how many are needed',
    r1.kind === 'insufficient' && r1.required === ev.MIN_LABELLED_FOR_METRICS)

  // A model that predicts NOTHING must not score well.
  const silent = Array.from({ length: 12 }, () =>
    row(['sad'], [['sad', 0.001], ['happy', 0.001]]))
  const r2 = ev.evaluateField(silent as never, semanticOf, ev.MOOD_LABEL_MAPPING)
  ok('a silent model is evaluated', r2.kind === 'multi-label')
  ok('a silent model scores ZERO recall — not 95% accuracy',
    r2.kind === 'multi-label' && r2.recall === 0)
  ok('and zero precision, not 1.0 on an empty set',
    r2.kind === 'multi-label' && r2.precision === 0)
  ok('and zero F1', r2.kind === 'multi-label' && r2.f1 === 0)

  // A correct model scores well.
  const good = Array.from({ length: 12 }, () =>
    row(['sad'], [['sad', 0.95], ['happy', 0.01]]))
  const r3 = ev.evaluateField(good as never, semanticOf, ev.MOOD_LABEL_MAPPING)
  ok('a correct model scores full recall',
    r3.kind === 'multi-label' && r3.recall === 1)
  ok('and full top-1 hit', r3.kind === 'multi-label' && r3.topOneHit === 1)

  // Single-label fields use accuracy — and only those.
  ok('the mood mapping documents unmappable human labels',
    ev.MOOD_LABEL_MAPPING.unmappable.includes('nostalgic'))
  ok('nostalgic is NOT silently mapped to retro',
    !Object.values(ev.MOOD_LABEL_MAPPING.humanToModel).flat().includes('retro'))
  ok('the vocal mapping exists', ev.VOCAL_LABEL_MAPPING.field === 'vocalInstrumental')
  ok('mixed is unmappable for a binary head',
    ev.VOCAL_LABEL_MAPPING.unmappable.includes('mixed'))

  // Coverage.
  const cov = ev.computeCoverage(good as never, semanticOf, ev.MOOD_LABEL_MAPPING)
  ok('coverage counts analysed rows', cov.analysed === 12)
  ok('coverage counts labelled rows', cov.labelled === 12)
  ok('coverage is a ratio', cov.coverage === 1)

  ok('the threshold is named experimental, never production',
    'DEFAULT_EXPERIMENTAL_THRESHOLD' in ev)
  const src = strip(read('app/services/ai-dataset/semanticEvaluation.ts'))
  ok('no productionThreshold anywhere', !/productionThreshold/.test(src))
}

// =====================================================================
section('10. Export keeps prediction and ground truth separate')
{
  const { exportJson, exportCsv } = await import('../app/services/ai-dataset/datasetExport')
  const { emptyLabels } = await import('../app/services/ai-dataset/labels')

  const record = {
    id: 'r1', schemaVersion: 2,
    track: { trackId: 't1', title: 'T', artist: 'A', album: null, sourceUri: null },
    measurements: {} as never,
    embedding: { vector: [0.1, 0.2], dimension: 2, model: 'clap', modelVersion: '1', normalized: true, preNormalizationL2: 1 },
    processing: { analyzerVersion: 1, analysisDurationMs: 1, decodeDurationMs: 1, inferenceDurationMs: 1, experimental: true },
    semantic: {
      model: 'discogs-effnet-bs64', modelVersion: '1', analyzerVersion: 1,
      heads: [{
        field: 'mood' as const, head: 'moodtheme', headVersion: '1',
        activation: 'sigmoid' as const, multiLabel: true, classCount: 2,
        predictions: [{ label: 'melancholic', score: 0.82 }, { label: 'sad', score: 0.71 }],
      }],
      unsupported: [], sourceDurationSec: 10, processedDurationSec: 10,
      sampleRate: 16000, decodeMs: 5, inferenceMs: 9,
      analyzedAt: '2026-01-01T00:00:00.000Z',
      experimental: true as const, source: 'model' as const,
    },
    groundTruth: { ...emptyLabels(), moods: ['happy'] as never, revision: 1 },
    status: 'COMPLETED' as const, errorCode: null, errorMessage: null,
    createdAt: '', updatedAt: '', supersededAt: null,
  }

  const json = JSON.parse(exportJson([record as never], true))
  const r = json.records[0]

  ok('prediction is exported', r.prediction !== null)
  ok('groundTruth is exported', r.groundTruth !== null)
  // The critical separation.
  ok('they are DIFFERENT keys', 'prediction' in r && 'groundTruth' in r)
  ok('prediction is marked model-sourced', r.prediction.source === 'model')
  ok('groundTruth is marked human-sourced', r.groundTruth.source === 'human')
  ok('the human mood is happy', r.groundTruth.mood[0] === 'happy')
  ok('the model mood is melancholic — not copied from the human',
    r.prediction.heads[0].predictions[0].label === 'melancholic')
  ok('the COMPLETE prediction list is exported',
    r.prediction.heads[0].predictions.length === 2)
  ok('the model version is exported', r.prediction.version === '1')
  ok('inference metadata is exported', r.prediction.inferenceMs === 9)
  ok('the notice warns the two are distinct',
    /never ground truth/i.test(json.notice))
  ok('the embedding is still complete', r.embedding.vector.length === 2)

  // Exhaustive: no THIRD key may carry labels. A "merged" or
  // "combined" convenience field is precisely how the separation
  // erodes — it looks helpful and destroys the distinction.
  const labelBearing = Object.keys(r).filter(k =>
    /truth|label|prediction|semantic|merged|combined/i.test(k))
  ok('exactly two label-bearing keys exist, no merged third',
    labelBearing.length === 2, )
  ok('and they are exactly prediction and groundTruth',
    labelBearing.sort().join(',') === 'groundTruth,prediction')
  ok('no key mixes the two names',
    !Object.keys(r).some(k => /groundTruth/i.test(k) && /pred/i.test(k)))
  // The model's top label must never appear inside the human region.
  ok('the human region contains no model label',
    !JSON.stringify(r.groundTruth).includes('melancholic'))

  const csv = exportCsv([record as never])
  const header = csv.split('\n')[0] ?? ''
  ok('CSV distinguishes predicted columns by name',
    header.includes('predictedMoodTop'))
  ok('CSV keeps the human mood column', header.includes('moods'))
  ok('CSV records the prediction source', header.includes('predictionSource'))
  ok('CSV row carries the model top-1', csv.includes('melancholic'))
  ok('CSV row carries the human label', csv.includes('happy'))
}

// =====================================================================
section('11. Full Player: same sheet, cached, no fabrication')
{
  const comp = strip(read('app/composables/useTrackAiAnalysis.ts'))
  const sheet = strip(read('app/components/player/PlayerAiAnalysis.vue'))
  const player = strip(read('app/components/FullPlayer.vue'))

  ok('the composable runs semantics in the same analyze call',
    /await runSemantic\(/.test(comp))
  ok('it uses the generic factory, not a provider import',
    /createMusicSemanticProvider\(\)/.test(comp)
    && !/jamendoProvider/.test(comp))
  ok('a cache hit is reused', /cachedSemanticFor\(/.test(comp))
  ok('RE-RUN bypasses the cache', /if \(!force && status\.model/.test(comp))
  ok('results are persisted', /persistSemanticToDataset\(/.test(comp))
  ok('the unready reason is surfaced, not swallowed',
    /semanticNotes\.set\(id, status\.detail/.test(comp))

  ok('the sheet renders mood predictions', /moodPredictions/.test(sheet))
  ok('the sheet renders genre predictions', /genrePredictions/.test(sheet))
  ok('the sheet renders vocal predictions', /vocalPredictions/.test(sheet))
  ok('every prediction shows its score', /pct\(p\.score\)/.test(sheet))
  ok('the sheet marks semantics EXPERIMENTAL',
    /ai-semantic-head[\s\S]{0,200}EXPERIMENTAL/.test(sheet))
  ok('the sheet states predictions are not the user\'s labels',
    /not your labels/i.test(sheet))
  ok('the sheet shows the model identity', /semantic\?\.model/.test(sheet))
  ok('unsupported fields are shown, not hidden', /semanticUnsupported/.test(sheet))
  ok('a missing model explains itself', /semanticNote/.test(sheet))

  // No hardcoded semantics anywhere in the UI.
  for (const bad of ['melancholic', 'energetic', 'Persian', 'good for driving']) {
    ok(`the sheet hardcodes no "${bad}"`, !sheet.includes(bad))
  }

  ok('FullPlayer passes semantics into the existing sheet',
    /:semantic="aiSemantic"/.test(player))
  ok('no new route was created for analysis',
    !/router\.push\(.*semantic/i.test(player))
}

// =====================================================================
section('11b. UI states are all reachable and distinct')
{
  const sheet = strip(read('app/components/player/PlayerAiAnalysis.vue'))
  const comp = strip(read('app/composables/useTrackAiAnalysis.ts'))
  const player = strip(read('app/components/FullPlayer.vue'))

  // LOADING. Must be driven by real in-flight state, not a timer.
  ok('a loading state exists', /isAnalyzing/.test(comp))
  ok('loading is backed by an in-flight set, not a timeout',
    /inFlight\.add\(id\)/.test(comp) && /inFlight\.delete\(id\)/.test(comp))
  ok('the in-flight entry is released in a finally — a crash cannot wedge the spinner',
    /finally \{[\s\S]{0,200}inFlight\.delete\(id\)/.test(comp))
  ok('a second press while running is ignored', /if \(inFlight\.has\(id\)\) return/.test(comp))

  // SUCCESS.
  ok('a success state renders predictions', /hasSemantic/.test(sheet))
  ok('success requires an actual head, not merely a non-null object',
    /heads\.length/.test(sheet) || /heads\?\.length/.test(sheet))

  // ERROR / NOT-READY — must be distinct from each other and from empty.
  ok('a note channel exists for explanations', /semanticNotes/.test(comp))
  ok('the not-ready reason comes from the provider, not a constant',
    /status\.detail/.test(comp))
  ok('an inference failure records its own message', /outcome\.message/.test(comp))
  ok('a persistence failure is reported separately from an inference failure',
    /stored\.ok && stored\.error|!stored\.ok && stored\.error/.test(comp))
  ok('a missing provider is its own message',
    /No semantic model provider is configured/.test(comp))
  ok('the sheet renders the note when there is no result',
    /v-else-if="semanticNote"/.test(sheet))

  // The critical negative: semantics failing must NOT fail the analysis.
  // Scoped to the function body. A fixed-width window ran past the end
  // of runSemantic into analyze(), where failures.set is correct.
  const bodyStart = comp.indexOf('async function runSemantic')
  // runSemantic is the last async function in the file, so also stop at
  // the next top-level `function` — otherwise the slice runs to EOF and
  // picks up reset(), where clearing state is correct.
  const ends = ['\n  async function', '\n  function']
    .map(t => comp.indexOf(t, bodyStart + 10))
    .filter(i => i !== -1)
  const bodyEnd = ends.length ? Math.min(...ends) : -1
  const runSemanticBody = comp.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd)
  ok('canary: runSemantic body was isolated',
    bodyStart !== -1 && runSemanticBody.includes('semanticNotes'))
  ok('runSemantic never sets an embedding failure state',
    !/failures\.set/.test(runSemanticBody))
  ok('runSemantic never clears the embedding result',
    !/results\.delete/.test(runSemanticBody))

  // UNSUPPORTED.
  ok('unsupported fields have a dedicated block', /semanticUnsupported/.test(sheet))
  ok('unsupported is rendered as a reason, not a blank', /u\.reason/.test(sheet))

  // PERSISTED vs LIVE.
  ok('a persisted result is labelled as saved', /saved result/i.test(sheet))
  ok('the saved marker is driven by cache provenance, not assumed',
    /semanticFromCache/.test(sheet))

  // RE-RUN.
  ok('re-run forces a bypass', /force/.test(comp))
  ok('the force flag reaches runSemantic', /runSemantic\([^)]*force/.test(comp))

  // NAVIGATION. The sheet must stay in the Full Player.
  ok('the sheet triggers no route change',
    !/router\.push|navigateTo|useRouter/.test(sheet))
  ok('the sheet is a child of the Full Player, not a page',
    /<PlayerAiAnalysis/.test(player))
  ok('analysis does not close the player', !/closePlayer|minimi[sz]e\(\)/.test(sheet))
}

// =====================================================================
section('11c. Failed analyses are never stored as successes')
{
  const svc = strip(read('app/services/ai-dataset/datasetService.ts'))
  const bridge = strip(read('app/services/ai-dataset/semanticBridge.ts'))

  // The bridge takes an already-unwrapped result, so its guarantee is
  // that a caller cannot hand it a failure: it accepts only the success
  // type and stamps provenance itself.
  ok('the bridge accepts only a successful result type',
    /result: SemanticAnalysisResult/.test(bridge))
  ok('the bridge stamps provenance itself rather than trusting input',
    /source: 'model'/.test(bridge))
  ok('the bridge never throws into the analyze path',
    /catch/.test(bridge))
  ok('a malformed prediction is rejected, not repaired',
    /isSemanticAnalysis/.test(svc))
  ok('saveSemanticAnalysis will not create a row for an unanalysed track',
    /return \{ ok: false/.test(svc))

  // Live check: a not-ready provider must leave the dataset untouched.
  const { setDatasetGateway, saveAnalysis, allRecords, resetDatasetGateway }
    = await import('../app/services/ai-dataset/datasetService')
  const { MemoryDatasetGateway } = await import('../app/services/ai-dataset/memoryGateway')
  const { persistSemanticToDataset } = await import('../app/services/ai-dataset/semanticBridge')

  setDatasetGateway(new MemoryDatasetGateway())
  await saveAnalysis({
    track: { trackId: 'fail-1', title: 'T', artist: null, album: null, sourceUri: null },
    measurements: {}, embedding: null, analyzerVersion: 1, status: 'COMPLETED',
  } as never)

  const provider = (await import('../app/services/music-semantics/index'))
    .createMusicSemanticProvider()
  const outcome = await provider!.analyze({ trackId: 'fail-1', uri: 'content://x' })
  ok('the provider failed as expected', outcome.ok === false)

  if (!outcome.ok) {
    const rows = await allRecords()
    const row = rows.find(r => r.track.trackId === 'fail-1')
    ok('a failed analysis leaves semantic null — not an empty success',
      row?.semantic === null)
    ok('the row itself still exists, unharmed', row !== undefined)
  }
  resetDatasetGateway()
}

// =====================================================================
section('12. No heuristic semantics anywhere')
{
  const files = [
    'app/services/music-semantics/types.ts',
    'app/services/music-semantics/index.ts',
    'app/services/music-semantics/providers/jamendoProvider.ts',
    'app/services/music-semantics/providers/semanticRuntime.ts',
    'app/services/ai-dataset/semanticRecord.ts',
    'app/services/ai-dataset/semanticBridge.ts',
    'app/services/ai-dataset/semanticEvaluation.ts',
    'app/composables/useTrackAiAnalysis.ts',
  ]
  for (const f of files) {
    const src = strip(read(f))
    const name = f.split('/').pop()
    // The forbidden inferences, spelled out in the brief.
    ok(`${name}: no BPM-derived mood`,
      !/bpm\s*[<>]/i.test(src) && !/tempo\s*[<>]/i.test(src))
    ok(`${name}: no loudness-derived mood`,
      !/loudness[\s\S]{0,40}(happy|sad|energetic)/i.test(src))
    ok(`${name}: no filename/artist-derived language`,
      !/filename[\s\S]{0,40}lang/i.test(src) && !/artist[\s\S]{0,30}(persian|farsi)/i.test(src))
    ok(`${name}: no CLAP-derived genre`,
      !/cosine[\s\S]{0,40}genre/i.test(src))
  }

  // Predictions must never reach playback or recommendation code.
  const player = strip(read('app/stores/player.ts'))
  ok('the player store knows nothing about semantics',
    !/semantic|SemanticAnalysis/i.test(player))
}

// =====================================================================
section('13. Dataset page exposes predictions and evaluation')
{
  const page = strip(read('app/pages/dev/ai-dataset.vue'))
  ok('canary: page located', page.includes('dataset'))

  // §9 asks for these as separate columns, not one merged cell.
  ok('the model region is banded and labelled',
    /MODEL PREDICTION · EXPERIMENTAL/.test(page))
  ok('the human region is labelled', /HUMAN LABELS/.test(page))
  for (const col of ['Model', 'Mood', 'Genre', 'Tags', 'Vocal', 'Confidence']) {
    ok(`the "${col}" prediction column exists`,
      new RegExp(`>${col}</th>`).test(page))
  }
  ok('prediction columns are driven by a field list, not hardcoded cells',
    /SEMANTIC_COLUMNS/.test(page))
  ok('a field the model cannot produce shows n/a, not a dash',
    /n\/a/.test(page))
  ok('the detail view is labelled model output',
    /SEMANTIC PREDICTION · MODEL OUTPUT/.test(page))
  ok('the detail view says it is not ground truth',
    /never\s+treated\s+as\s+ground\s+truth/i.test(page))
  ok('the RAW complete output is exposed',
    /Raw output — all \{\{ h\.predictions\.length \}\} classes/.test(page))
  ok('head metadata is shown (activation, class count)',
    /h\.activation/.test(page) && /h\.classCount/.test(page))
  ok('evaluation metrics are shown', /MODEL EVALUATION/.test(page))
  ok('the page explains why accuracy is wrong for multi-label',
    /would score about 95%/.test(page))
  ok('insufficient data is displayed as such',
    /'insufficient'/.test(page))
  ok('the label mapping caveat is visible',
    /Unmappable labels/.test(page))
  ok('coverage is reported', /coverage/.test(page))

  // Confusion must be RENDERED, not merely computed. Assert each
  // column, since dropping one silently halves the table's value.
  ok('the confusion breakdown is rendered', /ev\.e\.confusion/.test(page))
  for (const col of ['actual', 'predicted', 'correct']) {
    ok(`the confusion table shows "${col}"`,
      new RegExp(`c\\.${col}`).test(page))
  }
  ok('the confusion table is explained, not just dumped',
    /over-applies/.test(page))
}

// =====================================================================
section('14. Kotlin storage is additive and label-safe')
{
  const entity = read('android/app/src/main/java/com/systema/music/library/db/TrackAiAnalysisEntity.kt')
  const dao = read('android/app/src/main/java/com/systema/music/library/db/TrackAiAnalysisDao.kt')
  const db = read('android/app/src/main/java/com/systema/music/library/db/MusicLibraryDatabase.kt')
  const plugin = read('android/app/src/main/java/com/systema/music/dataset/AiDatasetPlugin.kt')

  ok('the entity has a semanticJson column',
    /@ColumnInfo\(name = "semanticJson"\) val semanticJson: String\?/.test(entity))
  ok('the database is version 4', /version = 4,/.test(db))
  ok('a 3->4 migration exists', /Migration\(3, 4\)/.test(db))
  ok('the migration is a single additive ALTER',
    /ALTER TABLE `track_ai_analysis` ADD COLUMN `semanticJson` TEXT/.test(db))
  ok('the migration does NOT drop or recreate the table',
    !/DROP TABLE[\s\S]{0,200}track_ai_analysis[\s\S]{0,200}MIGRATION_3_4/.test(db))
  ok('the migration is registered', /MIGRATION_3_4,/.test(db))

  ok('the DAO writes the column', /semanticJson = excluded\.semanticJson/.test(dao))
  ok('the DAO binds it on insert', /:semanticJson/.test(dao))

  // The rule that must never break: the analysis upsert cannot touch labels.
  const setClause = dao.slice(
    dao.indexOf('ON CONFLICT(id) DO UPDATE SET'),
    dao.indexOf('suspend fun upsertAnalysis'),
  ).replace(/--.*$/gm, '')
  ok('the ON CONFLICT clause still touches NO label column',
    !/\blabel\w*\s*=/.test(setClause))
  ok('the ON CONFLICT clause preserves createdAt',
    !/createdAt\s*=/.test(setClause))

  ok('the plugin reads semanticJson', /getString\("semanticJson"\)/.test(plugin))
  ok('the plugin returns semanticJson', /put\("semanticJson", semanticJson\)/.test(plugin))
}

// =====================================================================
section('14b. Conversion tooling stays outside the application')
{
  const sh = read('scripts/phase29/fetch-and-convert-models.sh')

  ok('the acquisition script exists', sh.length > 1000)
  ok('it states plainly that it is not part of the app',
    /NOT PART OF THE ANDROID APP/.test(sh))
  ok('it fetches the embedding model', /discogs-effnet-bs64-1\.onnx/.test(sh))
  ok('it fetches the mood head', /mtg_jamendo_moodtheme-discogs-effnet-1/.test(sh))
  ok('it fetches the voice head', /voice_instrumental-discogs-effnet-1/.test(sh))
  ok('it converts with tf2onnx', /tf2onnx\.convert/.test(sh))
  ok('it pins the opset', /--opset 13/.test(sh))
  ok('it verifies output shapes against the declared taxonomy',
    /MISMATCH/.test(sh) && /56/.test(sh) && /87/.test(sh))
  ok('it refuses to ship a mismatched model',
    /do NOT ship this/i.test(sh))
  ok('it says to fix the taxonomy, never the model',
    /never the reverse/i.test(sh))
  ok('it skips the head with no verified labels',
    /top50tags head skipped on purpose/.test(sh))
  ok('it surfaces the non-commercial licence', /NON-COMMERCIAL/.test(sh))
  ok('it installs Python into a throwaway venv, not globally',
    /venv/.test(sh) && /never global/i.test(sh))
  ok('it fails loudly when the host is unreachable',
    /Cannot reach/.test(sh))

  // Python must never become an app runtime dependency.
  const appFiles = [
    'app/services/music-semantics/providers/semanticRuntime.ts',
    'app/services/music-semantics/index.ts',
    'app/composables/useTrackAiAnalysis.ts',
  ]
  for (const f of appFiles) {
    const src = strip(read(f))
    // Naming tf2onnx in a human-readable requirements string is fine
    // and useful — it tells the developer what is missing. EXECUTING
    // it, or shelling out at all, is what must never happen.
    ok(`${f.split('/').pop()} never shells out`,
      !/child_process|execSync|spawn\(|exec\(/.test(src))
    ok(`${f.split('/').pop()} declares no Python dependency`,
      !/import .*python|require\(.*python/i.test(src))
    ok(`${f.split('/').pop()} does not run pip`, !/pip install/i.test(src))
    ok(`${f.split('/').pop()} does not reference the tooling directory`,
      !/scripts\/phase29/.test(src))
  }

  // Weights must not be committed.
  const ignore = read('.gitignore')
  // A commented-out ignore rule still matches a naive regex, which is
  // precisely how this protection would silently disappear.
  const activeIgnores = ignore.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
  ok('model weights are gitignored by an ACTIVE rule',
    activeIgnores.some(l => l.includes('build/phase29-models')))
  ok('the ignore rule explains itself', /non-commercial/i.test(ignore))

  // Android must not gain a Python or TensorFlow dependency.
  const gradle = read('android/app/build.gradle')
  ok('no TensorFlow dependency was added to Android',
    !/tensorflow/i.test(gradle))
  ok('ONNX Runtime remains the inference dependency',
    /onnxruntime-android/.test(gradle))
}

// =====================================================================
section('15. Documentation is specific and honest')
{
  const doc = read('docs/phase-29-semantic-model.md')
  ok('the doc exists', doc.length > 2000)
  ok('it names the exact mood model',
    /mtg_jamendo_moodtheme-discogs-effnet-1/.test(doc))
  ok('it records the embedding model', /discogs-effnet-bs64-1/.test(doc))
  ok('it records the sample rate', /16000 Hz|16 kHz/.test(doc))
  ok('it records the input shape', /\[64, 128, 96\]/.test(doc))
  ok('it records the 1280-d embedding', /1280/.test(doc))
  ok('it records the 56 mood classes', /56/.test(doc))
  ok('it records the weak PR-AUC honestly', /PR-AUC 0\.14/.test(doc))
  ok('it states the CC BY-NC-SA licence', /CC BY-NC-SA 4\.0/.test(doc))
  ok('it flags the non-commercial blocker', /cannot ship in a commercial/.test(doc))
  ok('it justifies the ONNX Runtime choice', /ONNX Runtime Android/.test(doc))
  ok('it documents required conversion', /tf2onnx/.test(doc))
  ok('it keeps conversion tooling out of the app', /outside the app|not.*part of the application/i.test(doc))
  ok('it does NOT claim device verification',
    /NOT PROVEN|not been executed on a device/i.test(doc))
  ok('it explains the mel front-end gap', /mel front-end/i.test(doc))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`MUSIC SEMANTICS — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All music semantics tests passed.')
