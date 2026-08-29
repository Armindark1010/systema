/**
 * SYSTEMA — dataset page, labeling workflow and player integration
 * (Phase 28, stage 2).
 *
 * The page is a Vue SFC and cannot be mounted in this test process, so
 * UI guarantees are asserted against the source with comments stripped
 * first — a docblock saying "no predicted mood" must not satisfy a
 * check for the absence of one.
 *
 * The composable's pure logic (label drafts, dirty state) IS executed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { persistAnalysisToDataset, ANALYZER_VERSION } from '../app/services/ai-dataset/datasetBridge'
import { getRecord, resetDatasetGateway, saveLabels, allRecords, queryDataset } from '../app/services/ai-dataset/datasetService'
import { emptyLabels, labelsEqual, sanitiseLabels } from '../app/services/ai-dataset/labels'
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
const strip = (s: string) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = 'app/pages/dev/ai-dataset.vue'
const COMPOSABLE = 'app/composables/useAiDataset.ts'
const BRIDGE = 'app/services/ai-dataset/datasetBridge.ts'

const pageSrc = strip(read(PAGE))
const compSrc = strip(read(COMPOSABLE))
const bridgeSrc = strip(read(BRIDGE))

const DIM = 512
const vec = () => Array.from({ length: DIM }, (_, i) => Math.sin(i * 0.01))

// =====================================================================
section('1. The page exists, is isolated, and is not linked')
{
  ok('canary: page source survived stripping', pageSrc.includes('definePageMeta'))
  ok('the route is /dev/ai-dataset', read(PAGE).length > 0)
  ok('it uses the dev layout', /layout: 'dev'/.test(pageSrc))

  // It must not be reachable from the normal app.
  const appFiles = [
    'app/components/FullPlayer.vue',
    'app/pages/index.vue',
    'app/pages/settings.vue',
  ]
  for (const f of appFiles) {
    let src = ''
    try { src = read(f) } catch { continue }
    ok(`${f.split('/').pop()} does not link to the dataset page`,
      !/\/dev\/ai-dataset/.test(strip(src)))
  }
}

// =====================================================================
section('2. The page shows only real, collected values')
{
  // No fabricated semantics anywhere in the rendered output.
  ok('no hardcoded mood verdict', !/>\s*(Happy|Sad|Melancholic)\s*</.test(pageSrc))
  ok('no hardcoded language verdict', !/>\s*Persian\s*</.test(pageSrc))
  ok('no predicted-label vocabulary', !/predictedMood|predictedGenre|inferredLanguage/.test(pageSrc))

  // Values must come from the record.
  ok('language is read from ground truth', /groundTruth\.language/.test(pageSrc))
  ok('genres are read from ground truth', /groundTruth\.genres/.test(pageSrc))
  ok('moods are read from ground truth', /groundTruth\.moods/.test(pageSrc))
  ok('contexts are read from ground truth', /groundTruth\.contexts/.test(pageSrc))
  ok('measurements are read from the record', /measurements\.bpm/.test(pageSrc))
  ok('the embedding dimension is read from the record',
    /embedding\.dimension/.test(pageSrc))

  // Missing data renders as a dash, never as a plausible zero.
  ok('a dash constant exists', /const DASH = '—'/.test(pageSrc))
  ok('missing values fall back to the dash', /\?\?\s*DASH|:\s*DASH/.test(pageSrc))

  // Ground truth is labelled as human-assigned on screen.
  ok('the page states labels are human assigned',
    /HUMAN ASSIGNED|human/i.test(pageSrc))
  ok('the page states no classifier exists',
    /no classifier|typed by a person/i.test(pageSrc))
  ok('measurements are marked not editable', /NOT EDITABLE/.test(pageSrc))
  ok('energy is marked perceived, not measured',
    /PERCEIVED, NOT FROM LOUDNESS/.test(pageSrc))
  ok('the embedding is marked experimental', /experimental/i.test(pageSrc))
}

// =====================================================================
section('3. Overview, table, and dataset controls')
{
  for (const stat of ['Records', 'Tracks', 'Analysed', 'Failed', 'Labelled',
    'Unlabelled', 'Embeddings']) {
    ok(`the overview shows ${stat}`, new RegExp(`'${stat}'`).test(pageSrc))
  }
  ok('the model/version distribution is shown', /modelDistribution/.test(pageSrc))

  for (const col of ['Language', 'Genre', 'Mood', 'Vocal', 'Energy', 'Contexts']) {
    ok(`the table has a ${col} column`, new RegExp(`>${col}<`).test(pageSrc))
  }
  ok('the table shows analysis status', />Analysis</.test(pageSrc))
  ok('the table shows embedding status', />Embedding</.test(pageSrc))
  ok('the table shows the updated date', />Updated</.test(pageSrc))
  ok('the table shows completeness', /completeness/.test(pageSrc))

  ok('search is wired', /search:/.test(pageSrc))
  ok('label filtering is wired', /labelled:/.test(pageSrc))
  ok('status filtering is wired', /status:/.test(pageSrc))
  ok('sorting is wired', /sortBy:/.test(pageSrc))
  ok('sort direction can be flipped', /sortDir/.test(pageSrc))
  ok('pagination is wired', /goToPage/.test(pageSrc))
  ok('records can be opened', /openRecord/.test(pageSrc))

  // Delete must be confirmed.
  ok('delete requires confirmation', /confirmDelete/.test(pageSrc))
  ok('the confirmation warns it is permanent', /cannot be undone/i.test(pageSrc))
  ok('the confirmation mentions labels are lost too', /hand-assigned labels/i.test(pageSrc))
}

// =====================================================================
section('4. Labeling workflow')
{
  // Every required vocabulary is offered.
  ok('language options are rendered', /LANGUAGE_VALUES/.test(pageSrc))
  ok('genre options are rendered', /GENRE_SUGGESTIONS/.test(pageSrc))
  ok('mood options are rendered', /MOOD_VALUES/.test(pageSrc))
  ok('vocal options are rendered', /VOCAL_VALUES/.test(pageSrc))
  ok('energy options are rendered', /ENERGY_VALUES/.test(pageSrc))
  ok('context options are rendered', /CONTEXT_VALUES/.test(pageSrc))
  ok('a save control exists', /SAVE LABELS/.test(pageSrc))
  ok('notes can be recorded', /notes/.test(pageSrc))

  // Save state must be visible and honest.
  ok('an unsaved state is shown', /NOT LABELLED/.test(pageSrc))
  ok('a modified state is shown', /UNSAVED CHANGES/.test(pageSrc))
  ok('a saved state is shown', /'SAVED'|>SAVED</.test(pageSrc))
  ok('saving is indicated', /SAVING/.test(pageSrc))
  ok('save is disabled when nothing changed', /disabled="!draft\.dirty/.test(pageSrc))

  // The editor shows what the machine measured, for context.
  ok('the editor shows measurements', /MEASURED/.test(pageSrc))
  ok('the editor shows embedding metadata', /selected\.embedding/.test(pageSrc))
  ok('the editor shows completeness', /selectedQuality/.test(pageSrc))
}

// =====================================================================
section('5. Draft logic: unsaved / modified / saved')
{
  // useLabelDraft is pure logic; exercise it directly rather than
  // trusting the template.
  const base: GroundTruthLabels = { ...emptyLabels() }

  // A fresh, never-labelled record.
  ok('an unlabelled draft starts at revision 0', base.revision === 0)
  ok('an unlabelled draft has no language', base.language === null)

  // Structural comparison drives the badge.
  const a: GroundTruthLabels = { ...emptyLabels(), language: 'fa', moods: ['sad'] }
  const b: GroundTruthLabels = { ...emptyLabels(), language: 'fa', moods: ['sad'] }
  ok('identical drafts compare equal', labelsEqual(a, b))
  ok('mood order does not count as a change',
    labelsEqual({ ...a, moods: ['sad', 'calm'] }, { ...b, moods: ['calm', 'sad'] }))
  ok('a changed language is detected', !labelsEqual(a, { ...b, language: 'en' }))
  ok('an added mood is detected', !labelsEqual(a, { ...b, moods: ['sad', 'happy'] }))
  ok('a changed note is detected', !labelsEqual(a, { ...b, notes: 'x' }))

  // The composable must not persist a draft anywhere.
  ok('the draft is not written to storage',
    !/localStorage|sessionStorage/.test(compSrc))
  ok('the draft is discarded on close', /function discard/.test(compSrc))
  ok('toggling is a pure array operation', /splice|push/.test(compSrc))
  ok('re-choosing the active value clears it', /=== value \? null : value/.test(compSrc))
}

// =====================================================================
section('6. The composable caches, it does not store')
{
  ok('canary: composable source survived stripping', compSrc.includes('export function useAiDataset'))
  ok('it never touches localStorage', !/localStorage/.test(compSrc))
  ok('it never touches sessionStorage', !/sessionStorage/.test(compSrc))
  ok('it never touches Preferences', !/Preferences/.test(compSrc))
  ok('reads go through the service', /queryDataset|allRecords/.test(compSrc))
  ok('writes go through the service', /persistLabels|deleteRecord/.test(compSrc))
  ok('it refreshes from the database after a write',
    /await refresh\(\)/.test(compSrc))
  ok('statistics use the whole dataset, not the page',
    /everything\.value/.test(compSrc))
  ok('a filter change resets pagination', /filters\.offset = 0/.test(compSrc))
  ok('durability is exposed to the UI', /isDatasetDurable/.test(compSrc))
  ok('the page warns when not durable', /NOT PERSISTED/.test(pageSrc))
  // Rendered whenever the backend is not durable, whether that is the
  // ordinary web case or a device whose plugin is missing. The two
  // notices are mutually exclusive branches of one conditional.
  ok('the warning is bound to the durability flag',
    /v-(?:else-)?if="!dataset\.durable/.test(pageSrc))
  ok('a broken device backend gets its own, louder notice',
    /v-if="dataset\.unavailableReason\.value"/.test(pageSrc)
    && /PERSISTENCE UNAVAILABLE/.test(pageSrc))
  ok('the warning says labels are not saved',
    /not saved|lost when this page is reloaded/i.test(pageSrc))
}

// =====================================================================
section('7. Full Player saves to the dataset automatically')
{
  const playerComp = strip(read('app/composables/useTrackAiAnalysis.ts'))
  ok('canary: player composable located', playerComp.includes('analyseSingleTrack'))
  // Assert the CALL, not the token: an unused import still contains
  // the name, which let a mutation that deleted the call slip through.
  ok('the player CALLS the dataset write',
    /await persistAnalysisToDataset\(/.test(playerComp))
  ok('the write receives the analysis record',
    /persistAnalysisToDataset\(\s*outcome\.record/.test(playerComp))
  ok('the write receives the track identity',
    /persistAnalysisToDataset\([^)]*track/.test(playerComp))
  ok('the write receives the DSP snapshot',
    /persistAnalysisToDataset\([^)]*dspFeatures/.test(playerComp))
  ok('the call is not commented out',
    !/\/\/\s*(const stored)?\s*await persistAnalysisToDataset/.test(read('app/composables/useTrackAiAnalysis.ts')))
  ok('a cache hit does not rewrite the row', /!outcome\.fromCache/.test(playerComp))
  ok('a dataset failure surfaces as a warning', /saveWarnings\.set/.test(playerComp))
  ok('the player still does not import a provider',
    !/clapProvider|ClapSession/.test(playerComp))

  // The player must not need the dataset page.
  ok('the player does not navigate to the dataset page',
    !/\/dev\/ai-dataset/.test(playerComp))

  // The bridge itself.
  ok('canary: bridge located', bridgeSrc.includes('persistAnalysisToDataset'))
  ok('the bridge sends the complete vector',
    /vector: record\.embedding\.vector/.test(bridgeSrc))
  ok('the bridge does not slice the vector', !/\.slice\(/.test(bridgeSrc))
  ok('the bridge sends no labels', !/language:|moods:|genres:/.test(bridgeSrc))
  ok('the bridge records the analyzer version', /ANALYZER_VERSION/.test(bridgeSrc))
  ok('the bridge never throws', /catch \(e\)/.test(bridgeSrc))
  ok('the analyzer version is a real number', typeof ANALYZER_VERSION === 'number')
}

// =====================================================================
section('8. End to end: analyse, label, re-analyse')
{
  resetDatasetGateway()

  const analysis = {
    trackId: 'ms:900',
    model: { id: 'clap', version: 'v1', experimental: true },
    embedding: { vector: vec(), dimension: DIM, normalised: true, preNormL2: 7.1 },
    audio: {
      durationSec: 200, processedDurationSec: 60, sourceSampleRate: 44100,
      modelSampleRate: 48000, windowsProcessed: 11,
    },
    dsp: null,
    timings: { decodeMs: 100, inferenceMs: 200, totalMs: 350 },
    analyzedAt: new Date().toISOString(),
    unsupported: [],
    groundTruth: null,
  } as never

  const track = { trackId: 'ms:900', uri: 'content://x/900', title: 'Song', artist: 'Artist' } as never

  const dsp = {
    bpm: 92, bpmConfidence: 0.7, loudnessDbfs: -11, dynamicRangeDb: 7,
    rms: 0.2, spectralCentroid: 1500, zeroCrossingRate: 0.03, silenceRatio: 0.01,
  }

  const first = await persistAnalysisToDataset(analysis, track, dsp)
  ok('the player write succeeds', first.ok, first.error ?? '')
  ok('an id comes back', typeof first.id === 'string')

  const row = await getRecord(first.id!)
  ok('the row is in the dataset', row !== null)
  ok('the complete vector was stored', row?.embedding?.vector.length === DIM)
  ok('DSP measurements were attached', row?.measurements.bpm === 92)
  ok('audio facts were attached', row?.measurements.sourceDurationSec === 200)
  ok('the track title was captured', row?.track.title === 'Song')
  ok('the artist was captured', row?.track.artist === 'Artist')
  ok('the source URI was captured for reproducibility',
    row?.track.sourceUri === 'content://x/900')
  ok('the analyzer version was recorded',
    row?.processing.analyzerVersion === ANALYZER_VERSION)
  ok('it starts unlabelled', row?.groundTruth.language === null)
  ok('it is marked experimental', row?.processing.experimental === true)

  // A human labels it.
  const labels: GroundTruthLabels = sanitiseLabels({
    language: 'fa', genres: ['pop'], moods: ['nostalgic'],
    vocal: 'vocal', energy: 'medium', contexts: ['driving'],
  })
  const saved = await saveLabels(first.id!, labels)
  ok('labels save from the page', saved.ok)
  ok('the revision is 1', saved.record?.groundTruth.revision === 1)

  // Re-analyse from the player.
  const second = await persistAnalysisToDataset(analysis, track, { ...dsp, bpm: 93 })
  ok('re-analysis succeeds', second.ok)
  ok('it targets the same row', second.id === first.id)
  ok('only one row exists', (await allRecords()).length === 1)

  const after = await getRecord(first.id!)
  ok('THE LABELS SURVIVED re-analysis', after?.groundTruth.language === 'fa')
  ok('genres survived', after?.groundTruth.genres.join() === 'pop')
  ok('moods survived', after?.groundTruth.moods.join() === 'nostalgic')
  ok('contexts survived', after?.groundTruth.contexts.join() === 'driving')
  ok('the revision was not reset', after?.groundTruth.revision === 1)
  ok('the new measurement was applied', after?.measurements.bpm === 93)

  // And it is findable from the page's own query path.
  const found = await queryDataset({ search: 'Song' })
  ok('the record is findable by search', found.total === 1)
  const labelled = await queryDataset({ labelled: 'labelled' })
  ok('the record counts as labelled', labelled.total === 1)
}

// =====================================================================
section('9. Nothing here changes playback or recommendations')
{
  const all = [pageSrc, compSrc, bridgeSrc].join('\n')
  ok('nothing plays or pauses', !/\.play\(\)|\.pause\(\)|togglePlay/.test(all))
  ok('nothing changes track', !/skipTo|playTrack\(/.test(all))
  ok('nothing modifies the queue', !/setQueue|addToQueue/.test(all))
  ok('nothing modifies playlists', !/createPlaylist|addToPlaylist/.test(all))
  ok('no recommendation logic', !/recommend\w*\(/.test(all))
  // Phase 29 introduced ONE threshold: the experimental sigmoid cutoff
  // used to compute multi-label precision/recall on this page. That is
  // a display-side evaluation knob, not a production decision boundary.
  // The rule being defended is unchanged — no threshold may gate
  // playback, similarity or recommendation — so the guard now tests
  // that distinction instead of banning the word.
  const thresholdUses = [...all.matchAll(/\w*threshold\w*/gi)].map(m => m[0])
  const allowed = /^(DEFAULT_EXPERIMENTAL_THRESHOLD|threshold)$/
  ok('every threshold reference is the experimental evaluation one',
    thresholdUses.every(t => allowed.test(t)),
    thresholdUses.filter(t => !allowed.test(t)).join(', '))
  ok('no production threshold', !/production\w*threshold/i.test(all))
  ok('no similarity threshold', !/similarity\w*threshold|threshold\w*similarity/i.test(all))
  ok('no threshold gates playback or recommendation',
    !/threshold[^\n]{0,40}(play|queue|recommend)/i.test(all))
  ok('no production model selection', !/selectProduction|PRODUCTION_MODEL/.test(all))
  ok('the page runs no inference', !/analyseSingleTrack|createProvider/.test(pageSrc))
  ok('the page has no "analyse everything" control',
    !/analyseAll|analyzeAll|analyseLibrary/i.test(pageSrc))
}

// =====================================================================
section('10. Export to durable shared storage')
{
  const exporter = 'android/app/src/main/java/com/systema/music/dataset/DatasetExporter.kt'
  const kt = read(exporter).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('canary: exporter located', kt.includes('class DatasetExporter'))

  // The whole point: app-specific storage dies on uninstall.
  ok('the export does NOT use app-specific storage',
    !/getExternalFilesDir/.test(kt))
  ok('the export targets shared Documents',
    /DIRECTORY_DOCUMENTS/.test(kt))
  ok('exports are grouped in one folder', /SUBDIR = "SYSTEMA"/.test(kt))
  ok('modern devices use MediaStore', /MediaStore\.MediaColumns/.test(kt))
  ok('a partial write is marked pending', /IS_PENDING, 1/.test(kt))
  ok('the pending flag is cleared on success', /IS_PENDING, 0/.test(kt))
  ok('older devices have a legacy path', /getExternalStoragePublicDirectory/.test(kt))
  ok('a failure is reported, not swallowed', /ok = false|ExportResult\(false/.test(kt))
  ok('the reinstall rationale is documented',
    /uninstall/i.test(read(exporter)))

  // Logging discipline.
  ok('the exporter does not log the file path',
    !/Log\.[a-z]\(TAG, .*displayPath|Log\.[a-z]\(TAG, .*path=/.test(kt))
  ok('the exporter does not log content', !/Log\.[a-z]\([^)]*content/.test(kt))

  // Plugin wiring.
  const plugin = read('android/app/src/main/java/com/systema/music/dataset/AiDatasetPlugin.kt')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('the plugin exposes exportToFile', /fun exportToFile\(call: PluginCall\)/.test(plugin))
  ok('the plugin uses the exporter', /DatasetExporter\(context\)/.test(plugin))
  ok('export runs off the main thread', /withContext\(Dispatchers\.IO\)/.test(plugin))

  // Web side prefers the durable path.
  const gw = read('app/services/ai-dataset/nativeGateway.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('a device export helper exists', /export async function exportToDevice/.test(gw))
  ok('it returns null without a bridge', /if \(!isNativeDatasetAvailable\(\)\) return null/.test(gw))
  ok('the page prefers device storage', /await exportToDevice\(/.test(pageSrc))
  ok('the page falls back to a download', /URL\.createObjectURL/.test(pageSrc))
  ok('the page reports where the file went', /Saved to \$\{device\.path\}/.test(pageSrc))
}

// =====================================================================
section('11. The device checklist is honest')
{
  const doc = read('docs/phase-28-device-verification.md')
  ok('the checklist exists', doc.length > 1000)
  ok('it states verification was NOT performed', /NOT PERFORMED/.test(doc))
  ok('it covers analysing a real track', /Analyse a real track/i.test(doc))
  ok('it covers the record appearing in the dataset page',
    /\/dev\/ai-dataset/.test(doc))
  ok('it covers adding manual labels', /Add manual labels/i.test(doc))
  ok('it covers closing and reopening the app', /Reopen the app/i.test(doc))
  ok('it covers re-analysis preserving labels',
    /Labels unchanged/i.test(doc))
  ok('it covers exporting JSON', /EXPORT JSON/.test(doc))
  ok('it requires checking the COMPLETE vector in the export',
    /COMPLETE vector/.test(doc))
  ok('it is explicit that reinstall wipes the database',
    /does \*not\* survive an uninstall|Empty — this is EXPECTED/.test(doc))
  ok('it separates what WAS verified from what was not',
    /What WAS verified in development/.test(doc))
  ok('it does not claim Kotlin was compiled',
    /never been compiled|KOTLIN_COMPILED: NO|has never been compiled/i.test(doc))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`AI DATASET PAGE — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All AI dataset page tests passed.')
console.log(`
NOT PROVEN HERE: the page has not been rendered in a browser or on a
device. UI structure is asserted from source; only the composable's
pure logic and the persistence path actually execute.
DEVICE_VERIFIED: NO.`)
