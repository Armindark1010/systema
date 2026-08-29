/**
 * SYSTEMA — persistent AI dataset tests (Phase 28).
 *
 * The integrity guarantees under test:
 *   · human labels are never overwritten by re-analysis
 *   · the complete embedding survives every round trip
 *   · re-analysis does not create uncontrolled duplicates
 *   · nothing derives a semantic label from a measurement
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DATASET_SCHEMA_VERSION,
  assessRecord,
  coerceDatasetRecord,
  datasetRecordId,
  emptyMeasurements,
  isDatasetRecord,
} from '../app/services/ai-dataset/datasetRecord'
import type { DatasetRecord } from '../app/services/ai-dataset/datasetRecord'
import {
  exportCsv,
  exportJson,
  importJson,
} from '../app/services/ai-dataset/datasetExport'
import {
  allRecords,
  deleteRecord,
  getCurrentRecord,
  getRecord,
  getRecordsForTrack,
  queryDataset,
  resetDatasetGateway,
  saveAnalysis,
  saveLabels,
  setDatasetGateway,
} from '../app/services/ai-dataset/datasetService'
import {
  buildLabelDistributions,
  buildOverview,
  findDuplicateTracks,
} from '../app/services/ai-dataset/datasetStats'
import { MemoryDatasetGateway } from '../app/services/ai-dataset/memoryGateway'
import { fromBridge, toBridge } from '../app/services/ai-dataset/bridgeMapping'
import {
  emptyLabels,
  hasAnyLabel,
  labelsEqual,
  sanitiseLabels,
} from '../app/services/ai-dataset/labels'
import type { GroundTruthLabels } from '../app/services/ai-dataset/labels'

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
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')

const DIM = 512
function vec(seed = 1): number[] {
  return Array.from({ length: DIM }, (_, i) => Math.sin((i + seed) * 0.017))
}

function analysisInput(over: Record<string, unknown> = {}) {
  return {
    track: {
      trackId: 'ms:1234',
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      sourceUri: 'content://media/external/audio/media/1234',
    },
    measurements: {
      bpm: 78.4, bpmConfidence: 0.81, loudnessDbfs: -13.7, dynamicRangeDb: 8.4,
      peak: 0.98, rms: 0.121, spectralCentroid: 1842.3, spectralBandwidth: 2100.5,
      spectralRolloff: 5400.2, zeroCrossingRate: 0.0413, silenceRatio: 0.021,
      sourceDurationSec: 214.6, analysedDurationSec: 60, sourceSampleRate: 44100,
      modelSampleRate: 48000, windowsProcessed: 11,
    },
    embedding: {
      vector: vec(), dimension: DIM, model: 'clap',
      modelVersion: 'clap-htsat@a1b2c3', normalized: true, preNormalizationL2: 7.2413,
    },
    analyzerVersion: 1,
    analysisDurationMs: 4102,
    decodeDurationMs: 1180,
    inferenceDurationMs: 2841,
    ...over,
  } as Parameters<typeof saveAnalysis>[0]
}

const HUMAN_LABELS: GroundTruthLabels = {
  ...emptyLabels(),
  language: 'fa',
  genres: ['pop', 'traditional'],
  moods: ['sad', 'nostalgic'],
  vocal: 'vocal',
  energy: 'medium',
  contexts: ['driving', 'relaxing'],
  notes: 'reviewed by hand',
}

// =====================================================================
section('1. Insert, read, update, delete')
{
  resetDatasetGateway()
  const r = await saveAnalysis(analysisInput())
  ok('an analysis is inserted', r.ok && r.record !== null)
  ok('the action is "created"', r.action === 'created')
  ok('the id is the identity tuple',
    r.record?.id === datasetRecordId('ms:1234', 'clap', 'clap-htsat@a1b2c3', 1))
  ok('the schema version is stamped', r.record?.schemaVersion === DATASET_SCHEMA_VERSION)
  ok('the record is marked experimental', r.record?.processing.experimental === true)

  const read1 = await getRecord(r.record!.id)
  ok('the record reads back', read1 !== null)
  ok('the title is stored', read1?.track.title === 'Test Song')
  ok('the artist is stored', read1?.track.artist === 'Test Artist')
  ok('measurements are stored', read1?.measurements.bpm === 78.4)
  ok('spectral bandwidth is stored', read1?.measurements.spectralBandwidth === 2100.5)
  ok('peak is stored', read1?.measurements.peak === 0.98)
  ok('timings are stored', read1?.processing.inferenceDurationMs === 2841)

  // Update in place: same identity tuple.
  const r2 = await saveAnalysis(analysisInput({ measurements: { bpm: 79.1 } }))
  ok('the same tuple updates in place', r2.action === 'updated')
  ok('there is still exactly one row', (await allRecords()).length === 1)
  ok('the update applied', (await getRecord(r2.record!.id))?.measurements.bpm === 79.1)
  ok('createdAt is preserved across updates',
    r2.record?.createdAt === r.record?.createdAt)

  ok('delete removes the row', await deleteRecord(r2.record!.id))
  ok('the row is gone', (await getRecord(r2.record!.id)) === null)
  ok('deleting a missing row is false', (await deleteRecord('nope')) === false)
}

// =====================================================================
section('2. The COMPLETE 512-d embedding persists')
{
  resetDatasetGateway()
  const r = await saveAnalysis(analysisInput())
  const stored = await getRecord(r.record!.id)

  ok('the vector is stored', Array.isArray(stored?.embedding?.vector))
  ok('all 512 components are present', stored?.embedding?.vector.length === DIM)
  ok('the dimension matches', stored?.embedding?.dimension === DIM)
  ok('values are unchanged', stored?.embedding?.vector[100] === vec()[100])
  ok('the last component survives', stored?.embedding?.vector[511] === vec()[511])
  ok('preNormalizationL2 is kept', stored?.embedding?.preNormalizationL2 === 7.2413)
  ok('normalized is kept', stored?.embedding?.normalized === true)

  // A truncated vector must be rejected structurally.
  const bad = { ...stored!, embedding: { ...stored!.embedding!, vector: vec().slice(0, 64) } }
  ok('a truncated vector fails validation', !isDatasetRecord(bad))
}

// =====================================================================
section('3. Labels are NEVER overwritten by re-analysis')
{
  resetDatasetGateway()
  const first = await saveAnalysis(analysisInput())
  const id = first.record!.id

  const labelled = await saveLabels(id, HUMAN_LABELS)
  ok('labels save', labelled.ok)
  ok('language is stored', labelled.record?.groundTruth.language === 'fa')
  ok('genres are stored', labelled.record?.groundTruth.genres.join() === 'pop,traditional')
  ok('moods are stored', labelled.record?.groundTruth.moods.join() === 'sad,nostalgic')
  ok('contexts are stored', labelled.record?.groundTruth.contexts.join() === 'driving,relaxing')
  ok('the source is human', labelled.record?.groundTruth.source === 'human')
  ok('revision is bumped', labelled.record?.groundTruth.revision === 1)
  ok('labelledAt is stamped', typeof labelled.record?.groundTruth.labelledAt === 'string')

  // Re-analyse the SAME model build.
  const re = await saveAnalysis(analysisInput({ measurements: { bpm: 80 } }))
  ok('re-analysis succeeds', re.ok)
  ok('labels survive re-analysis', re.record?.groundTruth.language === 'fa')
  ok('genres survive', re.record?.groundTruth.genres.join() === 'pop,traditional')
  ok('moods survive', re.record?.groundTruth.moods.join() === 'sad,nostalgic')
  ok('energy survives', re.record?.groundTruth.energy === 'medium')
  ok('the revision is not reset', re.record?.groundTruth.revision === 1)
  ok('labelsPreserved is reported', re.labelsPreserved === true)
  ok('the new measurement applied', re.record?.measurements.bpm === 80)

  // Re-analyse with a NEW model version: labels must carry forward.
  const v2 = await saveAnalysis(analysisInput({
    embedding: {
      vector: vec(9), dimension: DIM, model: 'clap',
      modelVersion: 'clap-htsat@NEWBUILD', normalized: true, preNormalizationL2: 6.1,
    },
  }))
  ok('a new model version creates a new row', v2.action === 'versioned')
  ok('labels carry forward across model versions',
    v2.record?.groundTruth.language === 'fa')
  ok('moods carry forward', v2.record?.groundTruth.moods.join() === 'sad,nostalgic')
  ok('carry-forward is reported', v2.labelsPreserved === true)
}

// =====================================================================
section('4. Stable identity, no uncontrolled duplicates')
{
  resetDatasetGateway()
  for (let i = 0; i < 5; i++) await saveAnalysis(analysisInput())
  ok('five identical analyses produce ONE row', (await allRecords()).length === 1)

  // Different analyzer version = a distinct, versioned row.
  await saveAnalysis(analysisInput({ analyzerVersion: 2 }))
  const rows = await getRecordsForTrack('ms:1234')
  ok('a new analyzer version adds a row', rows.length === 2)

  const current = rows.filter(r => r.supersededAt === null)
  ok('exactly one row is current', current.length === 1)
  ok('the current row is the newest analyzer version',
    current[0]?.processing.analyzerVersion === 2)
  ok('the older row is superseded, not deleted',
    rows.some(r => r.supersededAt !== null && r.processing.analyzerVersion === 1))
  ok('getCurrentRecord returns the live row',
    (await getCurrentRecord('ms:1234'))?.processing.analyzerVersion === 2)

  // The identity tuple itself.
  ok('identity includes the track', datasetRecordId('a', 'm', 'v', 1).startsWith('a::'))
  ok('identity includes model, version and analyzer',
    datasetRecordId('a', 'm', 'v', 1) === 'a::m::v::1')
  ok('a different model yields a different id',
    datasetRecordId('a', 'm', 'v', 1) !== datasetRecordId('a', 'm2', 'v', 1))
  ok('a different analyzer yields a different id',
    datasetRecordId('a', 'm', 'v', 1) !== datasetRecordId('a', 'm', 'v', 2))
}

// =====================================================================
section('5. Persistence across an application restart')
{
  // A gateway whose data outlives the service instance, as SQLite does.
  const durable = new MemoryDatasetGateway()
  setDatasetGateway(durable)

  const r = await saveAnalysis(analysisInput())
  await saveLabels(r.record!.id, HUMAN_LABELS)

  // "Restart": a brand-new service binding onto the same store.
  setDatasetGateway(durable)
  const after = await getRecord(r.record!.id)

  ok('the record survives a restart', after !== null)
  ok('the embedding survives a restart', after?.embedding?.vector.length === DIM)
  ok('the labels survive a restart', after?.groundTruth.language === 'fa')
  ok('the measurements survive a restart', after?.measurements.bpm === 78.4)
  ok('the label revision survives', after?.groundTruth.revision === 1)

  // And the service must not be holding state of its own.
  const svc = stripComments(read('app/services/ai-dataset/datasetService.ts'))
  ok('the service keeps no record cache',
    !/new Map<string, DatasetRecord>|const cache/.test(svc))
  ok('the service does not use localStorage', !/localStorage/.test(svc))
  ok('the service does not use sessionStorage', !/sessionStorage/.test(svc))
  ok('the service does not use Preferences', !/Preferences/.test(svc))

  // No layer in the dataset may reach for browser storage.
  for (const f of [
    'app/services/ai-dataset/datasetRecord.ts',
    'app/services/ai-dataset/datasetGateway.ts',
    'app/services/ai-dataset/datasetStats.ts',
    'app/services/ai-dataset/datasetExport.ts',
    'app/services/ai-dataset/labels.ts',
  ]) {
    const src = stripComments(read(f))
    ok(`${f.split('/').pop()} avoids web storage`,
      !/localStorage|sessionStorage/.test(src))
  }
}

// =====================================================================
section('6. Labels are human-only and never derived')
{
  resetDatasetGateway()

  // An analysis alone must never produce a label.
  const r = await saveAnalysis(analysisInput())
  const g = r.record!.groundTruth
  ok('analysis leaves language null', g.language === null)
  ok('analysis leaves genres empty', g.genres.length === 0)
  ok('analysis leaves moods empty', g.moods.length === 0)
  ok('analysis leaves vocal null', g.vocal === null)
  ok('analysis leaves energy null', g.energy === null)
  ok('analysis leaves contexts empty', g.contexts.length === 0)
  ok('revision starts at zero', g.revision === 0)
  ok('an unlabelled record reports no labels', !hasAnyLabel(g))

  // High BPM must not become "energetic"; loudness must not become energy.
  const loud = await saveAnalysis(analysisInput({
    track: { trackId: 'loud', title: 'L', artist: 'A', album: null, sourceUri: null },
    measurements: { bpm: 178, loudnessDbfs: -3.0, rms: 0.9 },
  }))
  ok('a fast, loud track still has no mood', loud.record!.groundTruth.moods.length === 0)
  ok('a fast, loud track still has no energy label', loud.record!.groundTruth.energy === null)

  // The source code must contain no such derivation.
  const all = ['datasetService.ts', 'datasetRecord.ts', 'labels.ts', 'datasetStats.ts']
    .map(f => stripComments(read(`app/services/ai-dataset/${f}`))).join('\n')
  ok('canary: source survived comment stripping', all.includes('export function'))
  ok('no bpm→mood derivation', !/bpm\s*[><=]+[\s\S]{0,60}(mood|energetic|energy\s*=)/i.test(all))
  ok('no loudness→energy derivation', !/loudness[\s\S]{0,60}energy\s*=/i.test(all))
  ok('no language guessing', !/detectLanguage|guessLanguage|inferLanguage/i.test(all))
  ok('no genre inference', !/inferGenre|predictGenre|classifyGenre/i.test(all))
  ok('no mood inference', !/inferMood|predictMood|classifyMood/i.test(all))

  // A non-human source must be rejected at the boundary.
  const faked = { ...r.record!, groundTruth: { ...HUMAN_LABELS, source: 'model' } }
  ok('a model-sourced label set is rejected', !isDatasetRecord(faked))
}

// =====================================================================
section('7. Label vocabulary and sanitisation')
{
  // Unknown values are dropped, never coerced to a neighbour.
  const dirty = sanitiseLabels({
    language: 'FA',
    genres: ['Pop', 'pop', ' shoegaze '],
    moods: ['sad', 'not-a-mood', 'HAPPY'],
    vocal: 'vocal',
    energy: 'medium',
    contexts: ['driving', 'teleporting'],
    revision: 3,
  })
  ok('language is normalised to lowercase', dirty.language === 'fa')
  ok('duplicate genres collapse', dirty.genres.filter(g => g === 'pop').length === 1)
  ok('genres accept an open vocabulary', dirty.genres.includes('shoegaze'))
  ok('an invalid mood is dropped, not coerced',
    !dirty.moods.includes('not-a-mood' as never) && dirty.moods.length === 2)
  ok('mood case is normalised', dirty.moods.includes('happy'))

  // Isolation test: an invalid value must add NOTHING. The fixture
  // above hid a fabricating sanitiser, because the invented value
  // collided with a legitimate one already in the list.
  const onlyBad = sanitiseLabels({ moods: ['not-a-mood'], contexts: ['teleporting'] })
  ok('an invalid mood yields an EMPTY list, not a substitute',
    onlyBad.moods.length === 0)
  ok('an invalid context yields an EMPTY list, not a substitute',
    onlyBad.contexts.length === 0)
  const oneGood = sanitiseLabels({ moods: ['sad', 'bogus', 'also-bogus'] })
  ok('only the valid mood survives', oneGood.moods.join() === 'sad')
  ok('invalid moods add no entries', oneGood.moods.length === 1)
  ok('an invalid context is dropped', !dirty.contexts.includes('teleporting' as never))
  ok('a valid context survives', dirty.contexts.includes('driving'))
  ok('source is forced to human', dirty.source === 'human')
  ok('revision is carried', dirty.revision === 3)

  // Garbage in must not throw.
  ok('null input yields empty labels', sanitiseLabels(null).language === null)
  ok('a string input yields empty labels', sanitiseLabels('x').genres.length === 0)

  ok('labelsEqual detects sameness', labelsEqual(HUMAN_LABELS, { ...HUMAN_LABELS }))
  ok('labelsEqual ignores order',
    labelsEqual(HUMAN_LABELS, { ...HUMAN_LABELS, moods: ['nostalgic', 'sad'] }))
  ok('labelsEqual detects a change',
    !labelsEqual(HUMAN_LABELS, { ...HUMAN_LABELS, language: 'en' }))
}

// =====================================================================
section('8. Null and missing values stay null')
{
  resetDatasetGateway()
  const sparse = await saveAnalysis({
    track: { trackId: 'sparse', title: null, artist: null, album: null, sourceUri: null },
    analyzerVersion: 1,
  } as Parameters<typeof saveAnalysis>[0])

  ok('a record with no measurements saves', sparse.ok)
  ok('missing bpm is null, not 0', sparse.record?.measurements.bpm === null)
  ok('missing loudness is null, not 0', sparse.record?.measurements.loudnessDbfs === null)
  ok('missing duration is null, not 0', sparse.record?.measurements.sourceDurationSec === null)
  ok('a missing embedding is null', sparse.record?.embedding === null)
  ok('missing timings are null', sparse.record?.processing.decodeDurationMs === null)

  const m = emptyMeasurements()
  ok('every empty measurement is null',
    Object.values(m).every(v => v === null))

  // A failed analysis stores its error rather than fake data.
  const bad = await saveAnalysis({
    track: { trackId: 'bad', title: 'B', artist: null, album: null, sourceUri: null },
    analyzerVersion: 1,
    status: 'FAILED',
    errorCode: 'DECODER_ERROR',
    errorMessage: 'Could not decode the selected track',
  } as Parameters<typeof saveAnalysis>[0])
  ok('a failed analysis is recorded', bad.record?.status === 'FAILED')
  ok('the error code is kept', bad.record?.errorCode === 'DECODER_ERROR')
  ok('a failure has no embedding', bad.record?.embedding === null)
  ok('a failure has no fabricated labels', bad.record?.groundTruth.language === null)

  ok('a save without a trackId fails',
    !(await saveAnalysis({ track: { trackId: '' } } as never)).ok)
}

// =====================================================================
section('9. Query: search, filter, sort, paginate')
{
  resetDatasetGateway()
  const mk = async (id: string, title: string, artist: string, labelled: boolean, status: 'COMPLETED' | 'FAILED' = 'COMPLETED') => {
    const r = await saveAnalysis(analysisInput({
      track: { trackId: id, title, artist, album: null, sourceUri: null },
      status,
      embedding: status === 'FAILED'
        ? null
        : { vector: vec(), dimension: DIM, model: 'clap', modelVersion: 'v1', normalized: true, preNormalizationL2: 1 },
    }))
    if (labelled) await saveLabels(r.record!.id, HUMAN_LABELS)
    return r.record!
  }

  await mk('t1', 'Alpha', 'Zed', true)
  await mk('t2', 'Beta', 'Yan', false)
  await mk('t3', 'Gamma', 'Xu', true)
  await mk('t4', 'Delta', 'Wu', false, 'FAILED')

  ok('all rows are returned by default', (await queryDataset({})).total === 4)
  ok('search matches a title', (await queryDataset({ search: 'alph' })).total === 1)
  ok('search matches an artist', (await queryDataset({ search: 'yan' })).total === 1)
  ok('search is case-insensitive', (await queryDataset({ search: 'BETA' })).total === 1)
  ok('search with no match returns none', (await queryDataset({ search: 'zzz' })).total === 0)

  ok('filter by labelled', (await queryDataset({ labelled: 'labelled' })).total === 2)
  ok('filter by unlabelled', (await queryDataset({ labelled: 'unlabelled' })).total === 2)
  ok('filter by failed status', (await queryDataset({ status: 'FAILED' })).total === 1)
  ok('filter by completed status', (await queryDataset({ status: 'COMPLETED' })).total === 3)
  ok('filter by model', (await queryDataset({ model: 'clap' })).total === 3)
  ok('filter by a missing model returns none', (await queryDataset({ model: 'nope' })).total === 0)

  const byTitle = await queryDataset({ sortBy: 'title', sortDir: 'asc' })
  ok('sort by title ascending', byTitle.rows[0]?.track.title === 'Alpha')
  const byTitleDesc = await queryDataset({ sortBy: 'title', sortDir: 'desc' })
  ok('sort by title descending', byTitleDesc.rows[0]?.track.title === 'Gamma')
  const byArtist = await queryDataset({ sortBy: 'artist', sortDir: 'asc' })
  ok('sort by artist ascending', byArtist.rows[0]?.track.artist === 'Wu')

  const p1 = await queryDataset({ sortBy: 'title', sortDir: 'asc', limit: 2, offset: 0 })
  const p2 = await queryDataset({ sortBy: 'title', sortDir: 'asc', limit: 2, offset: 2 })
  ok('page one has two rows', p1.rows.length === 2)
  ok('page two has two rows', p2.rows.length === 2)
  ok('total ignores pagination', p1.total === 4)
  ok('pages do not overlap',
    !p1.rows.some(a => p2.rows.some(b => a.id === b.id)))
  ok('pagination covers every row',
    new Set([...p1.rows, ...p2.rows].map(r => r.id)).size === 4)
}

// =====================================================================
section('10. Statistics and quality')
{
  resetDatasetGateway()
  const a = await saveAnalysis(analysisInput({
    track: { trackId: 's1', title: 'A', artist: 'A', album: null, sourceUri: null },
  }))
  await saveLabels(a.record!.id, HUMAN_LABELS)
  const b = await saveAnalysis(analysisInput({
    track: { trackId: 's2', title: 'B', artist: 'B', album: null, sourceUri: null },
  }))
  await saveLabels(b.record!.id, { ...emptyLabels(), language: 'en', genres: ['rock'], moods: ['happy'], vocal: 'vocal', energy: 'high', contexts: ['workout'] })
  await saveAnalysis(analysisInput({
    track: { trackId: 's3', title: 'C', artist: 'C', album: null, sourceUri: null },
    status: 'FAILED', embedding: null, errorCode: 'DECODER_ERROR',
  }))

  const rows = await allRecords()
  const o = buildOverview(rows)
  ok('total is counted', o.totalRecords === 3)
  ok('analysed is counted', o.analysedRecords === 2)
  ok('failed is counted', o.failedRecords === 1)
  ok('labelled is counted', o.labelledRecords === 2)
  ok('unlabelled is counted', o.unlabelledRecords === 1)
  ok('embeddings are counted', o.embeddingCount === 2)
  ok('distinct tracks are counted', o.distinctTracks === 3)
  ok('the model distribution is reported',
    o.modelDistribution['clap@clap-htsat@a1b2c3'] === 2)
  ok('failed analyses are flagged', o.issueCounts.FAILED_ANALYSIS === 1)
  ok('missing embeddings are flagged', o.issueCounts.MISSING_EMBEDDING === 1)

  const d = buildLabelDistributions(rows)
  ok('language distribution counts fa', d.language.counts.fa === 1)
  ok('language distribution counts en', d.language.counts.en === 1)
  ok('unlabelled languages are separate, not "unknown"', d.language.unlabelled === 1)
  ok('genre distribution is multi-label', d.genre.counts.pop === 1 && d.genre.counts.traditional === 1)
  ok('mood distribution is multi-label', d.mood.counts.sad === 1 && d.mood.counts.happy === 1)
  ok('context distribution counts driving', d.context.counts.driving === 1)
  ok('imbalance ratio is computed', d.mood.imbalanceRatio === 1)

  // Completeness. Re-read: a.record predates the labels.
  const labelledA = (await getRecord(a.record!.id))!
  const full = assessRecord(labelledA)
  ok('a fully labelled record scores 100', full.completeness === 100)
  ok('a complete record has no missing-label issues',
    !full.issues.includes('MISSING_LANGUAGE') && !full.issues.includes('MISSING_MOOD'))

  const empty = await saveAnalysis(analysisInput({
    track: { trackId: 's4', title: 'D', artist: 'D', album: null, sourceUri: null },
  }))
  const partial = assessRecord(empty.record!)
  ok('an unlabelled record scores below 100', partial.completeness < 100)
  ok('missing language is flagged', partial.issues.includes('MISSING_LANGUAGE'))
  ok('missing genre is flagged', partial.issues.includes('MISSING_GENRE'))
  ok('missing mood is flagged', partial.issues.includes('MISSING_MOOD'))
  ok('missing vocal is flagged', partial.issues.includes('MISSING_VOCAL'))
  ok('incomplete contexts are flagged', partial.issues.includes('INCOMPLETE_CONTEXTS'))
  ok('a present embedding is NOT flagged missing',
    !partial.issues.includes('MISSING_EMBEDDING'))

  // Model version mismatch.
  const mismatch = assessRecord(labelledA, 'some-other-version')
  ok('a model version mismatch is flagged',
    mismatch.issues.includes('MODEL_VERSION_MISMATCH'))
  ok('a matching version is not flagged',
    !assessRecord(labelledA, 'clap-htsat@a1b2c3').issues.includes('MODEL_VERSION_MISMATCH'))

  ok('duplicate tracks are detectable', findDuplicateTracks(rows).length === 0)
}

// =====================================================================
section('11. Export and import')
{
  resetDatasetGateway()
  const r = await saveAnalysis(analysisInput())
  await saveLabels(r.record!.id, HUMAN_LABELS)
  const rows = await allRecords()

  const json = exportJson(rows)
  const parsed = JSON.parse(json)
  ok('the export is self-identifying', parsed.format === 'systema-ai-dataset')
  ok('the export is versioned', typeof parsed.version === 'number')
  ok('the export states label provenance', /HUMAN-assigned/i.test(parsed.notice))
  // Phase 29: the export now DOES carry model predictions, so the old
  // "holds no predictions" assertion would be a lie. The invariant that
  // actually matters is unchanged and is what is asserted instead: the
  // notice must tell a reader the two kinds of value are not the same.
  ok('the export distinguishes model output from labels',
    /RAW MODEL OUTPUT/.test(parsed.notice))
  ok('the export states predictions are never ground truth',
    /never ground truth/i.test(parsed.notice))
  ok('the export states the two stay separate',
    /separate/i.test(parsed.notice))
  ok('the record count is right', parsed.recordCount === 1)

  const rec = parsed.records[0]
  ok('the export keeps the COMPLETE vector', rec.embedding.vector.length === DIM)
  ok('the exported vector is unmodified', rec.embedding.vector[300] === vec()[300])
  ok('the export carries the dimension', rec.embedding.dimension === DIM)
  ok('the export carries the model', rec.embedding.model === 'clap')
  ok('the export carries ground truth', rec.groundTruth.language === 'fa')
  ok('exported genre is a list', Array.isArray(rec.groundTruth.genre))
  ok('exported ground truth is marked human', rec.groundTruth.source === 'human')
  ok('the export carries audio measurements', rec.audio.bpm === 78.4)
  ok('the export carries completeness', typeof rec.completeness === 'number')

  // Round trip.
  const back = importJson(json)
  ok('the export re-imports', back.ok)
  ok('one record comes back', back.records.length === 1)
  ok('nothing was skipped', back.skipped === 0)
  ok('the vector survives a round trip', back.records[0]?.embedding?.vector.length === DIM)
  ok('vector values survive a round trip',
    back.records[0]?.embedding?.vector[300] === vec()[300])
  ok('labels survive a round trip', back.records[0]?.groundTruth.language === 'fa')
  ok('moods survive a round trip', back.records[0]?.groundTruth.moods.join() === 'sad,nostalgic')

  // Bad input.
  ok('invalid JSON is rejected', !importJson('{oops').ok)
  ok('a foreign file is rejected', !importJson('{"format":"other"}').ok)
  ok('a newer export version is refused',
    !importJson(JSON.stringify({ format: 'systema-ai-dataset', version: 999, records: [] })).ok)
  const corrupt = importJson(JSON.stringify({
    format: 'systema-ai-dataset', version: 1,
    records: [{ id: 'x', schemaVersion: 1, status: 'COMPLETED', track: { trackId: 't' },
      processing: { analyzerVersion: 1 },
      embedding: { vector: [1, 2, 3], dimension: 512, model: 'm', modelVersion: 'v' },
      groundTruth: { source: 'human' } }],
  }))
  ok('a truncated vector is skipped, not repaired',
    corrupt.ok && corrupt.records.length === 0 && corrupt.skipped === 1)

  // CSV.
  const csv = exportCsv(rows)
  const lines = csv.split('\n')
  ok('the CSV has a header', lines[0]?.startsWith('id,trackId,title'))
  ok('the CSV has one row per record', lines.length === 2)
  ok('the CSV carries measurements', lines[1]?.includes('78.4'))
  ok('the CSV carries the language label', lines[1]?.includes('fa'))
  ok('the CSV joins multi-labels', lines[1]?.includes('pop|traditional'))
  ok('the CSV omits the raw vector', !csv.includes(String(vec()[300])))
  ok('the CSV marks labels human', lines[1]?.includes('human'))

  // Quoting.
  resetDatasetGateway()
  await saveAnalysis(analysisInput({
    track: { trackId: 'q', title: 'Song, with "quotes"', artist: 'A\nB', album: null, sourceUri: null },
  }))
  const csv2 = exportCsv(await allRecords())
  ok('commas in a title are quoted', csv2.includes('"Song, with ""quotes"""'))
  ok('the CSV still has one data row', csv2.split('\n').length === 3 || csv2.includes('"A\nB"'))
}

// =====================================================================
section('12. Model replacement compatibility')
{
  resetDatasetGateway()
  // A different model entirely, with a different dimension.
  const other = await saveAnalysis(analysisInput({
    track: { trackId: 'mx', title: 'M', artist: 'M', album: null, sourceUri: null },
    embedding: {
      vector: Array.from({ length: 1024 }, (_, i) => i / 1024),
      dimension: 1024, model: 'yamnet', modelVersion: 'y1',
      normalized: false, preNormalizationL2: null,
    },
  }))
  ok('a non-CLAP model stores fine', other.ok)
  ok('a 1024-d vector is kept whole', other.record?.embedding?.vector.length === 1024)
  ok('the other model is recorded', other.record?.embedding?.model === 'yamnet')
  ok('an unnormalised embedding is allowed', other.record?.embedding?.normalized === false)
  ok('a null preNormalizationL2 is allowed',
    other.record?.embedding?.preNormalizationL2 === null)

  // The dataset layer must not name CLAP anywhere.
  const layer = ['datasetService.ts', 'datasetRecord.ts', 'datasetGateway.ts',
    'datasetStats.ts', 'datasetExport.ts', 'memoryGateway.ts', 'labels.ts']
    .map(f => stripComments(read(`app/services/ai-dataset/${f}`))).join('\n')
  ok('canary: dataset source survived stripping', layer.includes('export'))
  ok('the dataset layer never hardcodes CLAP', !/clap/i.test(layer))
  ok('the dataset layer hardcodes no dimension', !/\b512\b/.test(layer))
  ok('the dataset layer imports no provider', !/ai-similarity\/providers/.test(layer))
  ok('the dataset layer has no threshold', !/threshold/i.test(layer))
}

// =====================================================================
section('13. Architecture: UI never persists directly')
{
  const gw = stripComments(read('app/services/ai-dataset/datasetGateway.ts'))
  ok('the gateway is an interface, not an implementation',
    /export interface DatasetGateway/.test(gw))
  ok('the gateway declares durability', /readonly durable: boolean/.test(gw))
  ok('the memory gateway admits it is volatile',
    /readonly durable = false/.test(read('app/services/ai-dataset/memoryGateway.ts')))

  const svc = stripComments(read('app/services/ai-dataset/datasetService.ts'))
  ok('the service talks to the gateway', /gateway\./.test(svc))
  ok('the service does not import Capacitor', !/@capacitor/.test(svc))
  ok('only saveLabels writes groundTruth',
    (svc.match(/groundTruth:/g) ?? []).length <= 2)
}

// =====================================================================
section('14. Native bridge mapping (round trip)')
{
  // Bridge JSON is flat; the domain record is nested. A mapping bug
  // here would silently drop measurements on a real device, where
  // nothing else in this suite runs.
  const bridge = toBridge({
    id: 'ms:1::clap::v1::1',
    schemaVersion: 1,
    track: { trackId: 'ms:1', title: 'T', artist: 'A', album: 'Al', sourceUri: 'content://x' },
    measurements: { ...emptyMeasurements(), bpm: 90, loudnessDbfs: -12, peak: 0.9, spectralBandwidth: 1200 },
    embedding: {
      vector: vec(), dimension: DIM, model: 'clap', modelVersion: 'v1',
      normalized: true, preNormalizationL2: 5.5,
    },
    processing: {
      analyzerVersion: 1, analysisDurationMs: 100, decodeDurationMs: 40,
      inferenceDurationMs: 55, experimental: true,
    },
    groundTruth: { ...HUMAN_LABELS, revision: 2 },
    status: 'COMPLETED', errorCode: null, errorMessage: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    supersededAt: null,
  })

  ok('the bridge payload is flat', typeof bridge.bpm === 'number')
  ok('the bridge carries the complete vector',
    (bridge.embeddingVector as number[]).length === DIM)
  ok('the bridge carries the dimension', bridge.embeddingDimension === DIM)
  ok('the bridge carries spectral bandwidth', bridge.spectralBandwidth === 1200)

  // THE CRITICAL ONE: an analysis payload must carry no labels.
  for (const k of ['labelLanguage', 'labelGenres', 'labelMoods', 'labelVocal',
    'labelEnergy', 'labelContexts', 'language', 'genres', 'moods']) {
    ok(`the analysis payload omits ${k}`, !(k in bridge))
  }

  // And back again, as the plugin returns it.
  const back = fromBridge({
    ...bridge,
    labelLanguage: 'fa',
    labelGenres: ['pop'],
    labelMoods: ['sad'],
    labelVocal: 'vocal',
    labelEnergy: 'medium',
    labelContexts: ['driving'],
    labelRevision: 2,
    labelledAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  ok('the record maps back', back !== null)
  ok('the vector survives the bridge', back?.embedding?.vector.length === DIM)
  ok('vector values survive the bridge', back?.embedding?.vector[7] === vec()[7])
  ok('measurements survive the bridge', back?.measurements.bpm === 90)
  ok('spectral bandwidth survives', back?.measurements.spectralBandwidth === 1200)
  ok('labels map back', back?.groundTruth.language === 'fa')
  ok('the label revision maps back', back?.groundTruth.revision === 2)
  ok('timestamps become ISO strings', typeof back?.createdAt === 'string')

  // A corrupt vector must not be presented as a valid embedding.
  const corrupt = fromBridge({
    ...bridge, embeddingVector: [1, 2, 3], embeddingDimension: 512,
    createdAt: Date.now(), updatedAt: Date.now(),
  })
  ok('a length/dimension mismatch yields no embedding', corrupt?.embedding === null)

  ok('a record with no id is rejected', fromBridge({ trackId: 'x' }) === null)
  ok('a record with no trackId is rejected', fromBridge({ id: 'x' }) === null)

  // Missing numbers must stay null, not become 0.
  const sparse = fromBridge({ id: 'a', trackId: 'b', createdAt: Date.now(), updatedAt: Date.now() })
  ok('a missing bpm maps to null, not 0', sparse?.measurements.bpm === null)
  ok('a missing embedding maps to null', sparse?.embedding === null)
  ok('a missing label stays null', sparse?.groundTruth.language === null)
  ok('an unlabelled row has revision 0', sparse?.groundTruth.revision === 0)

  // The native gateway cannot be imported here: it pulls in
  // @capacitor/core, which does not resolve in a plain Node process.
  // Asserted as source text instead, the same way the other native
  // plugin suites in this repo do it.
  const nativeSrc = stripComments(read('app/services/ai-dataset/nativeGateway.ts'))
  ok('canary: native gateway source located', nativeSrc.includes('class NativeDatasetGateway'))
  ok('the native gateway declares itself durable', /readonly durable = true/.test(nativeSrc))
  ok('the memory gateway is not durable', new MemoryDatasetGateway().durable === false)
  ok('the native gateway reuses the shared query logic',
    /applyQuery/.test(nativeSrc) && !/sortBy === /.test(nativeSrc))
  ok('the native gateway reports a failed write',
    /did not persist/.test(nativeSrc))
  // Comments stripped first: the file's docblock legitimately explains
  // WHY it avoids @capacitor/core, and that must not read as an import.
  const mapSrc = stripComments(read('app/services/ai-dataset/bridgeMapping.ts'))
  ok('canary: mapping source located', mapSrc.includes('export function fromBridge'))
  ok('the mapping module has no Capacitor import', !/@capacitor/.test(mapSrc))
  ok('the mapping module imports nothing native', !/registerPlugin/.test(mapSrc))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`AI DATASET — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All AI dataset tests passed.')
console.log(`
NOT PROVEN HERE: no Room database and no device. These tests run
against the in-memory gateway, so they prove the CONTRACT and the
integrity rules, NOT that SQLite persists anything on a phone.
DEVICE_VERIFIED: NO.`)
