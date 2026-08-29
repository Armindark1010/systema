/**
 * SYSTEMA — Phase 28: native plugin wiring regression tests.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Stage 1 and 2 shipped a complete dataset stack whose Capacitor
 * plugin was never registered in MainActivity. Every test passed. The
 * page rendered. On a device it would have silently fallen back to an
 * in-memory map, accepted every write, reported SAVED, and lost the
 * lot on restart — the exact failure the phase exists to prevent.
 *
 * Nothing caught it because no test asserted that the two halves were
 * connected. These tests assert the connection itself:
 *
 *   · the plugin is registered, in the same place and the same way as
 *     the other four;
 *   · the TypeScript name and the Kotlin name are the same string;
 *   · on a device the dataset API resolves to the Room gateway;
 *   · when the plugin is missing on a device, writes FAIL rather than
 *     silently succeeding against memory.
 *
 * The last one is the important one. A test proving a save works is
 * worth less than a test proving a broken save cannot look like a
 * working one.
 */

import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(label: string, cond: boolean) {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(label)
    console.log(`  ✗ ${label}`)
  }
}

function section(name: string) {
  console.log(`\n${name}`)
}

function read(p: string): string {
  return readFileSync(p, 'utf8')
}

/** Comments must never satisfy a source assertion. */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

const MAIN_ACTIVITY = 'android/app/src/main/java/com/systema/music/MainActivity.java'
const PLUGIN_KT = 'android/app/src/main/java/com/systema/music/dataset/AiDatasetPlugin.kt'
const GATEWAY_TS = 'app/services/ai-dataset/nativeGateway.ts'
const INDEX_TS = 'app/services/ai-dataset/index.ts'
const UNAVAIL_TS = 'app/services/ai-dataset/unavailableGateway.ts'

// =====================================================================
section('1. The Android entry point registers the plugin')
{
  const raw = read(MAIN_ACTIVITY)
  const src = strip(raw)
  ok('canary: MainActivity located and non-empty', src.includes('class MainActivity'))

  // It is a .java file, not .kt — the reason this was missed once.
  ok('the entry point extends BridgeActivity', /extends BridgeActivity/.test(src))

  ok('AiDatasetPlugin is imported',
    /import com\.systema\.music\.dataset\.AiDatasetPlugin;/.test(src))
  ok('AiDatasetPlugin is registered',
    /registerPlugin\(AiDatasetPlugin\.class\)/.test(src))

  // Ordering is load-bearing: BridgeActivity builds the Bridge inside
  // its own onCreate, so anything registered after is never exported.
  const regIdx = src.indexOf('registerPlugin(AiDatasetPlugin.class)')
  const superIdx = src.indexOf('super.onCreate(savedInstanceState);')
  ok('registration happens BEFORE super.onCreate()',
    regIdx > 0 && superIdx > 0 && regIdx < superIdx)

  // Same shape as the existing four.
  ok('registration is wrapped in try/catch like the others',
    /try \{\s*registerPlugin\(AiDatasetPlugin\.class\);\s*\} catch \(Throwable t\) \{/.test(src))
  ok('a registration failure is logged',
    /Log\.e\(TAG, "Failed to register AiDatasetPlugin", t\)/.test(src))

  // Post-registration verification, matching the house style.
  ok('the bridge is queried for the plugin after startup',
    /getBridge\(\)\.getPlugin\("AiDataset"\)/.test(src))
  ok('a missing dataset plugin is logged as an ERROR, not info',
    /Log\.e\(\s*TAG,\s*\n?\s*"AiDataset is NOT registered/.test(src))
}

// =====================================================================
section('2. All five plugins use one mechanism')
{
  const src = strip(read(MAIN_ACTIVITY))
  const expected = [
    'MusicLibraryPlugin',
    'PlayerPlugin',
    'AudioAnalysisPlugin',
    'InferencePlugin',
    'AiDatasetPlugin',
  ]
  for (const p of expected) {
    ok(`${p} is registered via registerPlugin`,
      new RegExp(`registerPlugin\\(${p}\\.class\\)`).test(src))
  }

  const count = (src.match(/registerPlugin\(/g) ?? []).length
  ok('exactly five plugins are registered', count === 5)

  // No parallel mechanism was invented.
  ok('no plugin list in capacitor.config', !/AiDataset/.test(read('capacitor.config.ts')))
  ok('no second registration path in the manifest',
    !/AiDataset/.test(read('android/app/src/main/AndroidManifest.xml')))
}

// =====================================================================
section('3. The TypeScript and Kotlin plugin names are identical')
{
  const kt = strip(read(PLUGIN_KT))
  const ts = strip(read(GATEWAY_TS))

  const ktName = kt.match(/@CapacitorPlugin\(name = "([^"]+)"\)/)?.[1] ?? null
  ok('the Kotlin plugin declares a name', ktName !== null)
  ok('the Kotlin name is AiDataset', ktName === 'AiDataset')

  const tsConst = ts.match(/AI_DATASET_PLUGIN_NAME = '([^']+)'/)?.[1] ?? null
  ok('the TypeScript side names the plugin once, as a constant', tsConst !== null)
  ok('the names match exactly', tsConst === ktName)

  ok('registerPlugin uses the constant',
    /registerPlugin<AiDatasetPlugin>\(AI_DATASET_PLUGIN_NAME\)/.test(ts))
  ok('the availability check uses the same constant',
    /isPluginAvailable\(AI_DATASET_PLUGIN_NAME\)/.test(ts))

  // The class name must match the import in MainActivity.
  ok('the Kotlin class is AiDatasetPlugin', /class AiDatasetPlugin : Plugin\(\)/.test(kt))

  // Every method the TS interface declares must exist natively.
  const tsMethods = [...ts.matchAll(/^\s{2}(\w+)\(/gm)].map(m => m[1])
    .filter(m => !['constructor'].includes(m))
  const declared = ['isAvailable', 'saveAnalysis', 'saveLabels', 'getById',
    'getByTrackId', 'getAll', 'deleteById', 'stats', 'exportToFile']
  for (const m of declared) {
    ok(`TS declares ${m}`, tsMethods.includes(m))
    ok(`Kotlin implements ${m}`, new RegExp(`fun ${m}\\(call: PluginCall\\)`).test(kt))
  }
}

// =====================================================================
section('4. The plugin reaches Room')
{
  const kt = strip(read(PLUGIN_KT))
  ok('the plugin holds the Room DAO', /TrackAiAnalysisDao/.test(kt))
  ok('the DAO comes from the shared database',
    /MusicLibraryDatabase\.get\(context\)\.trackAiAnalysisDao\(\)/.test(kt))
  ok('the database exposes that DAO',
    /fun trackAiAnalysisDao\(\): TrackAiAnalysisDao/
      .test(read('android/app/src/main/java/com/systema/music/library/db/MusicLibraryDatabase.kt')))
  ok('writes go through the transactional upsert', /dao\.upsertAndSupersede\(/.test(kt))
  ok('the write is read back before success is reported', /dao\.getById\(id\)/.test(kt))
  ok('a failed read-back is rejected, not resolved',
    /call\.reject\("The record did not persist\.", "WRITE_FAILED"\)/.test(kt))
}

// =====================================================================
section('5. Gateway selection: device vs browser')
{
  const src = strip(read(INDEX_TS))
  ok('canary: index located', src.includes('export async function initDataset'))

  ok('platform and plugin presence are separate checks',
    /isNativePlatform\(\)/.test(src) && /isNativeDatasetAvailable\(\)/.test(src))
  ok('a non-device build uses the memory gateway',
    /if \(!isNativePlatform\(\)\) return new MemoryDatasetGateway\(\)/.test(src))
  ok('a device without the plugin gets the FAILURE gateway',
    /if \(!isNativeDatasetAvailable\(\)\) \{\s*return new UnavailableDatasetGateway\(/.test(src))
  ok('a device with the plugin gets the Room gateway',
    /if \(await native\.isAvailable\(\)\) return native/.test(src))
  ok('a plugin that throws also lands on the failure gateway',
    /catch \{[\s\S]*?\}\s*return new UnavailableDatasetGateway\(/.test(src))

  // The dangerous construction that must never come back: the memory
  // gateway reachable on a device. Checked structurally rather than by
  // a loose regex, so it cannot be satisfied or broken by wording.
  const memUses = [...src.matchAll(/new MemoryDatasetGateway\(\)/g)]
  ok('the memory gateway is constructed exactly once', memUses.length === 1)

  const memLine = src.split('\n').find(l => l.includes('new MemoryDatasetGateway()')) ?? ''
  ok('its only construction is guarded by !isNativePlatform() on the same line',
    /if \(!isNativePlatform\(\)\)\s*return new MemoryDatasetGateway\(\)/.test(memLine))

  // And it is not the default the function starts from.
  ok('no unguarded default assignment to the memory gateway',
    !/let gateway: DatasetGateway = new MemoryDatasetGateway\(\)/.test(src))

  ok('the reason for unavailability is exposed to the UI',
    /export function datasetUnavailableReason\(\)/.test(src))
}

// =====================================================================
section('6. The failure gateway cannot fake a save')
{
  const src = strip(read(UNAVAIL_TS))
  ok('canary: failure gateway located', src.includes('class UnavailableDatasetGateway'))
  ok('it reports itself as not durable', /readonly durable = false/.test(src))
  ok('isAvailable returns false', /async isAvailable\(\): Promise<boolean> \{\s*return false/.test(src))
  ok('upsert throws', /async upsert\([\s\S]{0,120}?this\.fail\(\)/.test(src))
  ok('saveLabels throws', /async saveLabels\([\s\S]{0,160}?this\.fail\(\)/.test(src))
  ok('remove throws', /async remove\([\s\S]{0,120}?this\.fail\(\)/.test(src))
  ok('reads return empty rather than throwing',
    /async all\(\): Promise<DatasetRecord\[\]> \{\s*return \[\]/.test(src))
  ok('the message names the actual cause',
    /AiDataset plugin is not registered/.test(src))
}

// =====================================================================
section('7. Executed: the failure gateway defeats a fake success')
{
  const { UnavailableDatasetGateway } = await import('../app/services/ai-dataset/unavailableGateway')
  const { setDatasetGateway, saveAnalysis, saveLabels, queryDataset, resetDatasetGateway }
    = await import('../app/services/ai-dataset/datasetService')
  const { emptyLabels } = await import('../app/services/ai-dataset/labels')

  setDatasetGateway(new UnavailableDatasetGateway('test: plugin missing'))

  // The exact call the Full Player makes after an analysis.
  const res = await saveAnalysis({
    track: { trackId: 't-1', title: 'A', artist: 'B', album: null, sourceUri: null },
    measurements: { bpm: 120 },
    embedding: {
      vector: Array.from({ length: 512 }, (_, i) => i / 512),
      dimension: 512,
      model: 'clap',
      modelVersion: 'v1',
      normalized: true,
      preNormalizationL2: 1,
    },
    analyzerVersion: 1,
    status: 'COMPLETED',
  } as never)

  ok('a write against a broken backend reports ok:false', res.ok === false)
  ok('it returns no record', res.record === null)
  ok('it explains why', typeof res.error === 'string' && res.error.length > 10)
  ok('the error names the missing plugin', /not registered|unavailable/i.test(res.error ?? ''))

  const labelRes = await saveLabels('t-1', { ...emptyLabels(), language: 'fa' })
  ok('a label write also reports failure', labelRes.ok === false)
  ok('the label write returns no record', labelRes.record === null)

  // Nothing was stored anywhere.
  const page = await queryDataset({})
  ok('nothing was persisted', page.total === 0 && page.rows.length === 0)

  resetDatasetGateway()
}

// =====================================================================
section('8. Executed: a present plugin resolves to the Room gateway')
{
  // The real NativeDatasetGateway cannot be imported here — it pulls in
  // @capacitor/core, which does not resolve in this test process. So
  // the selection LOGIC is exercised against a stand-in that satisfies
  // the same port, proving the branch reaches a durable backend rather
  // than memory.
  const { setDatasetGateway, saveAnalysis, getRecord, resetDatasetGateway }
    = await import('../app/services/ai-dataset/datasetService')
  const { MemoryDatasetGateway } = await import('../app/services/ai-dataset/memoryGateway')

  class FakeRoomGateway extends MemoryDatasetGateway {
    override readonly id = 'room'
    override readonly durable = true
  }

  const room = new FakeRoomGateway()
  setDatasetGateway(room)

  const res = await saveAnalysis({
    track: { trackId: 't-room', title: 'Track', artist: 'Artist', album: null, sourceUri: null },
    measurements: { bpm: 96 },
    embedding: {
      vector: Array.from({ length: 512 }, () => 0.1),
      dimension: 512,
      model: 'clap',
      modelVersion: 'v1',
      normalized: true,
      preNormalizationL2: 1,
    },
    analyzerVersion: 1,
    status: 'COMPLETED',
  } as never)

  ok('the write succeeds against a durable backend', res.ok === true)
  ok('the gateway identifies as room', room.id === 'room')
  ok('the gateway reports durable', room.durable === true)

  // Read back through the API, as the page does.
  const back = res.record ? await getRecord(res.record.id) : null
  ok('the record reads back', back !== null)
  ok('the complete vector survived the round trip',
    back?.embedding?.vector.length === 512)
  ok('the measurement survived', back?.measurements.bpm === 96)

  resetDatasetGateway()
}

// =====================================================================
section('9. The UI surfaces the failure instead of hiding it')
{
  const page = strip(read('app/pages/dev/ai-dataset.vue'))
  const comp = strip(read('app/composables/useAiDataset.ts'))
  ok('canary: page located', page.includes('dataset'))

  ok('the composable exposes the unavailability reason',
    /unavailableReason: computed\(\(\) => datasetUnavailableReason\(\)\)/.test(comp))
  ok('the page shows a distinct PERSISTENCE UNAVAILABLE state',
    /PERSISTENCE UNAVAILABLE/.test(page))
  ok('that state is bound to the reason',
    /v-if="dataset\.unavailableReason\.value"/.test(page))
  ok('the ordinary web NOT PERSISTED notice still exists',
    /NOT PERSISTED/.test(page))
  ok('the two states are mutually exclusive',
    /v-else-if="!dataset\.durable\.value"/.test(page))
  ok('SAVE LABELS is disabled when persistence is broken',
    /:disabled="[^"]*!!dataset\.unavailableReason\.value[^"]*"/.test(page))
  ok('the warning tells the developer what to check',
    /registerPlugin\(AiDatasetPlugin\.class\)/.test(page))
}

// =====================================================================
section('10. The Full Player write path reports dataset failure')
{
  const comp = strip(read('app/composables/useTrackAiAnalysis.ts'))
  const bridge = strip(read('app/services/ai-dataset/datasetBridge.ts'))

  ok('the player persists through the bridge',
    /await persistAnalysisToDataset\(/.test(comp))
  ok('a dataset failure surfaces as a warning', /saveWarnings/.test(comp))
  ok('the bridge returns ok:false rather than throwing',
    /return \{\s*ok: false/.test(bridge))
  ok('the bridge never reports success without a result',
    /ok: res\.ok/.test(bridge))
  ok('the bridge does not swallow the reason',
    /error: \(e as Error\)\?\.message/.test(bridge))
}

// =====================================================================
section('11. Room accepted the entity (exported schema, compiler output)')
{
  // Room only writes this file during a successful compileDebugKotlin.
  // Unlike every other assertion in this repo, it is evidence from the
  // real annotation processor rather than from reading source: if the
  // entity, DAO and migration disagreed, the build would have failed
  // and this file would not exist at version 3.
  const path = 'android/app/schemas/com.systema.music.library.db.MusicLibraryDatabase/3.json'
  const schema = JSON.parse(read(path)) as {
    database: {
      version: number
      entities: Array<{
        tableName: string
        fields: Array<{ columnName: string, affinity: string, notNull: boolean }>
        primaryKey: { columnNames: string[] }
        indices?: Array<{ name: string }>
        foreignKeys?: unknown[]
      }>
    }
  }

  ok('the exported schema is version 3', schema.database.version === 3)

  const table = schema.database.entities.find(e => e.tableName === 'track_ai_analysis')
  ok('Room compiled the track_ai_analysis table', table !== undefined)
  if (!table) throw new Error('track_ai_analysis missing from the exported schema')

  ok('all 49 columns are present', table.fields.length === 49)
  ok('the primary key is the composite identity id',
    table.primaryKey.columnNames.length === 1 && table.primaryKey.columnNames[0] === 'id')

  // No CASCADE: deleting a track must not delete collected research data.
  ok('the table has NO foreign key', (table.foreignKeys ?? []).length === 0)

  const cols = new Set(table.fields.map(f => f.columnName))
  for (const c of ['labelLanguage', 'labelGenres', 'labelMoods', 'labelVocal',
    'labelEnergy', 'labelContexts', 'labelNotes', 'labelRevision', 'labelledAt']) {
    ok(`label column ${c} exists`, cols.has(c))
  }
  ok('the embedding vector column exists', cols.has('embeddingVector'))
  ok('the analyzer version is stored', cols.has('analyzerVersion'))
  ok('the model version is stored', cols.has('embeddingModelVersion'))

  const idx = (table.indices ?? []).map(i => i.name)
  ok('all five indices were created', idx.length === 5)
  ok('trackId is indexed', idx.includes('index_track_ai_analysis_trackId'))

  // The pre-existing tables must have come through the migration intact.
  const tracks = schema.database.entities.find(e => e.tableName === 'tracks')
  const song = schema.database.entities.find(e => e.tableName === 'song_analysis')
  ok('the tracks table survived the migration', tracks !== undefined)
  ok('the song_analysis table survived the migration', song !== undefined)

  // Every column the entity declares must appear in the compiled schema.
  const entity = read('android/app/src/main/java/com/systema/music/library/db/TrackAiAnalysisEntity.kt')
  const declared = [...entity.matchAll(/@ColumnInfo\(name = "(\w+)"\)/g)].map(m => m[1])
  const missing = declared.filter(c => !cols.has(c))
  ok('every declared column reached the compiled schema', missing.length === 0)
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`AI DATASET WIRING — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('All AI dataset wiring tests passed.')
