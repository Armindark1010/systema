/**
 * Discogs-EffNet 400-style output contract tests.
 *
 * Vocabulary is the official Essentia classes array, not a guessed list.
 */

import { readFileSync } from 'node:fs'

import contractJson from '../app/services/music-semantics/providers/discogs-effnet-style-contract.json'
import {
  DISCOGS_400_LABELS,
  DISCOGS_EMBEDDING_DIM,
  DISCOGS_STYLE_AGGREGATION,
  DISCOGS_STYLE_CONTRACT,
  DISCOGS_STYLE_DIM,
  meanPoolFrames,
  splitDiscogsLabel,
  topKStyles,
  zipDiscogsStyles,
} from '../app/services/music-semantics/providers/discogsStyleContract'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(label: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`) }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function section(name: string) { console.log(`\n${name}`) }

section('1. ONNX output contract (official metadata)')
{
  ok('style dimension is 400', DISCOGS_STYLE_DIM === 400)
  ok('embedding dimension is 1280', DISCOGS_EMBEDDING_DIM === 1280)
  ok('official schema names PartitionedCall:0 as predictions',
    contractJson.source.schemaOutput === 'PartitionedCall:0')
  ok('official schema names PartitionedCall:1 as embeddings',
    contractJson.source.embeddingOutput === 'PartitionedCall:1')
  ok('activation is sigmoid', contractJson.activation === 'sigmoid')
  ok('output id is STYLE_ACTIVATIONS', DISCOGS_STYLE_CONTRACT.output === 'STYLE_ACTIVATIONS')
  ok('taxonomy is Discogs-400', DISCOGS_STYLE_CONTRACT.taxonomy === 'Discogs-400')
}

section('2. Official vocabulary')
{
  ok('exactly 400 labels', DISCOGS_400_LABELS.length === 400)
  ok('index 0 is Blues---Boogie Woogie', DISCOGS_400_LABELS[0] === 'Blues---Boogie Woogie')
  ok('index 399 is Stage & Screen---Theme',
    DISCOGS_400_LABELS[399] === 'Stage & Screen---Theme')
  ok('no empty labels', DISCOGS_400_LABELS.every(l => typeof l === 'string' && l.length > 0))
  ok('no duplicate labels', new Set(DISCOGS_400_LABELS).size === 400)
  ok('bundled JSON matches TS labels',
    JSON.stringify(contractJson.labels) === JSON.stringify(DISCOGS_400_LABELS))
}

section('3. Index mapping is deterministic')
{
  const scores = DISCOGS_400_LABELS.map((_, i) => i / 400)
  const zipped = zipDiscogsStyles(scores)
  ok('zip length 400', zipped !== null && zipped.length === 400)
  ok('index 0 maps to classes[0]', zipped?.[0]?.label === DISCOGS_400_LABELS[0])
  ok('index 399 maps to classes[399]', zipped?.[399]?.label === DISCOGS_400_LABELS[399])
  ok('wrong length rejected', zipDiscogsStyles(scores.slice(0, 10)) === null)
  ok('289*400 flattened vector rejected', zipDiscogsStyles(new Array(289 * 400).fill(0.1)) === null)
}

section('4. Frame aggregation is mean, never flatten')
{
  ok('aggregation is mean', DISCOGS_STYLE_AGGREGATION === 'mean')
  const frames = 289
  const dim = 400
  const flat = new Array(frames * dim).fill(0)
  for (let f = 0; f < frames; f++) {
    flat[f * dim + 0] = 1
    flat[f * dim + 1] = 0.5
  }
  const pooled = meanPoolFrames(flat, frames, dim)
  ok('pooled length is 400, not 115600', pooled !== null && pooled.length === 400)
  ok('class 0 mean is 1', pooled !== null && Math.abs(pooled[0]! - 1) < 1e-9)
  ok('class 1 mean is 0.5', pooled !== null && Math.abs(pooled[1]! - 0.5) < 1e-9)
  ok('289 frames x 400 never treated as one 115600-d vector',
    meanPoolFrames(flat, 289, 400)?.length === 400
    && meanPoolFrames(flat, 289, 115600) === null)
}

section('5. Top-K ordering')
{
  const scores = new Array(400).fill(0.01)
  scores[0] = 0.87
  scores[1] = 0.64
  scores[4] = 0.41
  const top = topKStyles(scores, 5)
  ok('top-1 is index 0', top[0]?.styleId === 0 && top[0]?.label === 'Blues---Boogie Woogie')
  ok('top-2 is index 1', top[1]?.styleId === 1)
  ok('top-3 is index 4', top[2]?.styleId === 4)
  ok('descending scores', top[0]!.score >= top[1]!.score && top[1]!.score >= top[2]!.score)
}

section('6. Parent---Style split does not invent genre')
{
  const s = splitDiscogsLabel('Blues---Boogie Woogie')
  ok('parent is Blues', s.parentGenre === 'Blues')
  ok('style is Boogie Woogie', s.style === 'Boogie Woogie')
  ok('raw preserved', s.raw === 'Blues---Boogie Woogie')
  const none = splitDiscogsLabel('Ambient')
  ok('no fabricated parent', none.parentGenre === null)
}

section('7. Native session does not flatten 400-way output')
{
  const session = readFileSync(
    'android/app/src/main/java/com/systema/music/inference/effnet/EffnetDiscogsSession.kt',
    'utf8',
  )
  ok('style tensor is mean-pooled at STYLE_CLASS_COUNT',
    /dim = EffnetDiscogsModel\.STYLE_CLASS_COUNT/.test(session))
  ok('styleActivations are emitted', /"styleActivations"/.test(session))
  ok('style aggregation recorded as mean', /put\("styleAggregation", "mean"\)/.test(session))
}

section('8. UI shows styles, not generic genre')
{
  const sheet = readFileSync('app/components/player/PlayerAiAnalysis.vue', 'utf8')
  ok('MUSIC STYLE heading', /MUSIC STYLE/.test(sheet))
  ok('Discogs 400 Styles mentioned', /Discogs 400 Styles/.test(sheet))
  ok('no hardcoded Boogie Woogie demo values', !/Boogie Woogie/.test(
    sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
}

section('9. Persistence keeps predictions off ground truth')
{
  const rec = await import('../app/services/ai-dataset/semanticRecord')
  const predictions = DISCOGS_400_LABELS.map((label, i) => ({
    label,
    score: i === 0 ? 0.5 : 0.001,
  }))
  const semantic = {
    model: 'discogs-effnet-bsdynamic-1',
    modelVersion: '1',
    analyzerVersion: rec.SEMANTIC_ANALYZER_VERSION,
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
    analyzedAt: new Date().toISOString(),
    experimental: true as const,
    source: 'model' as const,
    sourceDurationSec: 1,
    processedDurationSec: 1,
    sampleRate: 16000,
    decodeMs: 1,
    inferenceMs: 1,
  }
  ok('complete 400-class head validates', rec.isSemanticAnalysis(semantic))
  ok('human source rejected', !rec.isSemanticAnalysis({ ...semantic, source: 'human' }))
  ok('stale analyzer version does not match current build',
    !rec.isSameSemanticBuild(semantic, 'discogs-effnet-bsdynamic-1', '1', rec.SEMANTIC_ANALYZER_VERSION + 1))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`DISCOGS-400 STYLES — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All Discogs-400 style tests passed.')
