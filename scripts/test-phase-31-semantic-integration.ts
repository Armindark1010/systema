/**
 * Phase 31: EffNet 400 styles + 1280 embedding → Room → Full Player.
 */

import { readFileSync } from 'node:fs'

import {
  DISCOGS_400_LABELS,
  DISCOGS_EMBEDDING_DIM,
  meanPoolFrames,
  zipDiscogsStyles,
} from '../app/services/music-semantics/providers/discogsStyleContract'

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

function section(name: string) { console.log(`\n${name}`) }
const read = (p: string) => readFileSync(p, 'utf8')
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

section('1. Extraction: 400 activations + 1280 embedding, mean pool')
{
  const frames = 8
  const dim = 400
  const flat = new Array(frames * dim).fill(0.1)
  for (let f = 0; f < frames; f++) flat[f * dim] = 0.8
  const pooled = meanPoolFrames(flat, frames, dim)
  ok('mean pool is 400', pooled !== null && pooled.length === 400)
  ok('does not flatten frames×400', pooled !== null && pooled.length !== frames * dim)
  ok('class 0 is mean of 0.8', pooled !== null && Math.abs(pooled[0]! - 0.8) < 1e-9)
  const zip = zipDiscogsStyles(pooled!)
  ok('zip is 400 official labels', zip !== null && zip.length === 400)
  ok('index 0 is Blues---Boogie Woogie', zip?.[0]?.label === DISCOGS_400_LABELS[0])
  ok('logits rejected (score > 1)', zipDiscogsStyles(new Array(400).fill(4.2)) === null)
  ok('embedding dim remains 1280', DISCOGS_EMBEDDING_DIM === 1280)
}

section('2. Provider zips STYLE_ACTIVATIONS, no softmax')
{
  const src = strip(read('app/services/music-semantics/providers/jamendoProvider.ts'))
  ok('provider zips style activations', /zipDiscogsStyles\(styleScores\)/.test(src))
  ok('style head field is style', /field: 'style'/.test(src))
  ok('no softmax on style scores', !/softmax/.test(src))
}

section('3. Persistence: 400 scores, identity, never human GT')
{
  const {
    setDatasetGateway, saveAnalysis, saveLabels, saveSemanticAnalysis,
    getRecord, getCurrentRecord, resetDatasetGateway,
  } = await import('../app/services/ai-dataset/datasetService')
  const { MemoryDatasetGateway } = await import('../app/services/ai-dataset/memoryGateway')
  const { emptyLabels } = await import('../app/services/ai-dataset/labels')
  const { toStoredSemantic } = await import('../app/services/ai-dataset/semanticBridge')
  const rec = await import('../app/services/ai-dataset/semanticRecord')

  class Room extends MemoryDatasetGateway {
    override readonly id = 'room'
    override readonly durable = true
  }
  setDatasetGateway(new Room())

  const predictions = DISCOGS_400_LABELS.map((label, i) => ({
    label,
    score: i === 0 ? 0.82 : i === 1 ? 0.71 : 0.001,
  }))
  const embedding = Array.from({ length: 1280 }, (_, i) => (i + 1) / 1280)

  const result = {
    trackId: 'tr-31',
    model: 'discogs-effnet-bsdynamic-1',
    modelVersion: '1',
    heads: [{
      field: 'style' as const,
      head: 'discogs-effnet-styles',
      headVersion: '1',
      activation: 'sigmoid' as const,
      multiLabel: true,
      classCount: 400,
      predictions,
    }],
    unsupported: [],
    embedding,
    embeddingDim: 1280,
    styleAggregation: 'mean' as const,
    styleFrameCount: 289,
    styleTaxonomy: 'Discogs-400',
    styleContractVersion: 1,
    sourceDurationSec: 180,
    processedDurationSec: 60,
    sampleRate: 16000,
    decodeMs: 10,
    inferenceMs: 40,
    analyzedAt: new Date().toISOString(),
    experimental: true as const,
  }

  const storedShape = toStoredSemantic(result)
  ok('taxonomyVersion persisted', storedShape.taxonomyVersion === 1)
  ok('styleTopK is a display slice', storedShape.styleTopK?.length === 5)
  ok('complete 400 remain on the head', storedShape.heads[0]!.predictions.length === 400)
  ok('1280 embedding copied', storedShape.embedding?.length === 1280)

  const w = await saveAnalysis({
    track: { trackId: 'tr-31', title: 'T', artist: 'A', album: null, sourceUri: null },
    measurements: {},
    embedding: {
      vector: embedding, dimension: 1280,
      model: 'discogs-effnet-bsdynamic-1', modelVersion: '1',
      normalized: true, preNormalizationL2: 1,
    },
    analyzerVersion: 1, status: 'COMPLETED',
  } as never)
  ok('EffNet embedding row created', w.ok === true)

  const sw = await saveSemanticAnalysis(w.record!.id, storedShape)
  ok('semantic write ok', sw.ok === true)
  const back = await getRecord(w.record!.id)
  ok('400 scores round-trip', back?.semantic?.heads[0]?.predictions.length === 400)
  ok('model id persisted', back?.semantic?.model === 'discogs-effnet-bsdynamic-1')
  ok('aggregation persisted', back?.semantic?.styleAggregation === 'mean')
  ok('frameCount persisted', back?.semantic?.styleFrameCount === 289)
  ok('human GT empty', back?.groundTruth.moods.length === 0)

  const labelled = await saveLabels(w.record!.id, { ...emptyLabels(), moods: ['sad'] })
  ok('human labels saved', labelled.ok === true)

  const re = await saveSemanticAnalysis(w.record!.id, {
    ...storedShape, inferenceMs: 99,
  })
  ok('re-run semantic ok', re.ok === true)
  const after = await getRecord(w.record!.id)
  ok('human labels untouched', after?.groundTruth.moods[0] === 'sad')
  ok('revision not bumped by model write', after?.groundTruth.revision === labelled.record!.groundTruth.revision)

  const current = await getCurrentRecord('tr-31')
  ok('getCurrentRecord restores semantic', current?.semantic?.heads[0]?.predictions.length === 400)
  ok('version mismatch invalidates cache',
    !rec.isSameSemanticBuild(current!.semantic, 'discogs-effnet-bsdynamic-1', '2'))

  resetDatasetGateway()
}

section('4. Full Player rendering')
{
  const sheet = strip(read('app/components/player/PlayerAiAnalysis.vue'))
  const comp = strip(read('app/composables/useTrackAiAnalysis.ts'))
  ok('MUSIC STYLES heading', /MUSIC STYLES/.test(sheet))
  ok('style predictions rendered', /stylePredictions/.test(sheet))
  ok('display uses Name — score', /styleDisplay\(p\.label\)/.test(sheet) && /pct\(p\.score\)/.test(sheet))
  ok('does not call 400 genre in the style block heading',
    !/ai-semantic-label">GENRE/.test(sheet) || /genrePredictions\.length/.test(sheet))
  ok('hydrate uses current Room row', /cachedSemanticForTrack/.test(comp))
  ok('RE-RUN still force-bypasses cache', /if \(!force && status\.model/.test(comp))
  ok('runSemantic never sets embedding failure', (() => {
    const start = comp.indexOf('async function runSemantic')
    const body = comp.slice(start, comp.indexOf('\n  function reset'))
    return !/failures\.set/.test(body)
  })())
  ok('no hardcoded Electronic demo', !/Electronic — 82%/.test(sheet))
}

section('5. Device remains unverified')
{
  const doc = read('docs/phase-31-device-verification.md')
  ok('NOT VERIFIED documented', /NOT VERIFIED/.test(doc))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`PHASE 31 — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All Phase 31 tests passed.')
