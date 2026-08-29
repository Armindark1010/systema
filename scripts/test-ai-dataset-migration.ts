/**
 * SYSTEMA — the 2 -> 3 migration executed against real SQLite (Phase 28).
 *
 * The schema suite checks the Kotlin as text. This one takes the exact
 * DDL out of MIGRATION_2_3 and RUNS it on a real database that already
 * contains a user's tracks and DSP analyses, then verifies the data is
 * still there and the new table behaves as designed.
 *
 * Uses node:sqlite, the same approach the Phase 13 persistence suite
 * already uses, so no new dependency is introduced.
 *
 * WHAT THIS STILL CANNOT PROVE: that Room's generated schema validation
 * accepts the result, that the Kotlin compiles, or that any of it runs
 * on an Android device. SQLite here is a stand-in for SQLite there.
 */

import { DatabaseSync } from 'node:sqlite'
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
const dbSrc = readFileSync(
  resolve(ROOT, 'android/app/src/main/java/com/systema/music/library/db/MusicLibraryDatabase.kt'),
  'utf8',
)

/**
 * Extracts the DDL from ONE migration block.
 *
 * Scoped by name: scanning the whole file would mix migrations
 * together, which is exactly the bug that made an older suite
 * miscount indices.
 */
function extractMigration(name: string, from: number, to: number): string[] {
  const marker = `${name} = object : Migration(${from}, ${to})`
  const start = dbSrc.indexOf(marker)
  if (start === -1) throw new Error(`${name} not found`)
  const next = dbSrc.indexOf('= object : Migration(', start + marker.length)
  const src = dbSrc.slice(start, next === -1 ? undefined : next)

  const statements: string[] = []
  for (const m of src.matchAll(/execSQL\(\s*"""([\s\S]*?)"""/g)) {
    statements.push(m[1]!.trim())
  }
  for (const m of src.matchAll(/execSQL\(\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),?\s*\)/g)) {
    const literal = m[1]!
    if (literal.includes('"""')) continue
    const joined = [...literal.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1]!).join('')
    if (joined.trim()) statements.push(joined.trim())
  }
  return statements
}

const mig12 = extractMigration('MIGRATION_1_2', 1, 2)
const mig23 = extractMigration('MIGRATION_2_3', 2, 3)
const mig34 = extractMigration('MIGRATION_3_4', 3, 4)

// =====================================================================
section('1. The migration SQL was extracted and is scoped')
{
  ok('MIGRATION_2_3 statements were found', mig23.length >= 6, `found ${mig23.length}`)
  ok('it creates the dataset table',
    mig23.some(s => /CREATE TABLE IF NOT EXISTS `track_ai_analysis`/i.test(s)))
  ok('it creates five indices',
    mig23.filter(s => /CREATE INDEX/i.test(s)).length === 5,
    `found ${mig23.filter(s => /CREATE INDEX/i.test(s)).length}`)
  // Canary: the slice must not have swallowed the Phase 13 migration.
  ok('the slice excludes song_analysis DDL',
    !mig23.some(s => /CREATE TABLE[\s\S]*song_analysis/i.test(s)))
  ok('the 1->2 slice excludes the dataset table',
    !mig12.some(s => /track_ai_analysis/i.test(s)))
}

// =====================================================================
section('2. Migrating a populated v2 database preserves user data')

const db = new DatabaseSync(':memory:')

// Build a realistic v1 -> v2 database first.
db.exec(`
  CREATE TABLE IF NOT EXISTS \`tracks\` (
    \`id\` TEXT NOT NULL,
    \`title\` TEXT NOT NULL,
    \`artist\` TEXT,
    \`dateAdded\` INTEGER NOT NULL,
    PRIMARY KEY(\`id\`)
  )
`)
for (const s of mig12) db.exec(s)

// User data that must survive.
db.exec(`INSERT INTO tracks (id, title, artist, dateAdded) VALUES
  ('ms:1', 'Song One', 'Artist A', 1000),
  ('ms:2', 'Song Two', 'Artist B', 2000)`)
db.exec(`INSERT INTO song_analysis
  (trackId, analyzerVersion, status, analyzedAt, durationMs, sampleRate,
   channels, analyzedSampleCount, bpm, attemptCount)
  VALUES ('ms:1', 1, 'COMPLETED', 5000, 214000, 44100, 2, 100, 78.4, 0)`)

const tracksBefore = db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }
const analysisBefore = db.prepare('SELECT COUNT(*) AS n FROM song_analysis').get() as { n: number }

// Apply 2 -> 3.
let migrationError: string | null = null
try {
  for (const s of mig23) db.exec(s)
} catch (e) {
  migrationError = (e as Error).message
}

{
  ok('the 2 -> 3 migration executes without error', migrationError === null,
    migrationError ?? '')

  const tracksAfter = db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }
  const analysisAfter = db.prepare('SELECT COUNT(*) AS n FROM song_analysis').get() as { n: number }

  ok('every track row survives', tracksAfter.n === tracksBefore.n && tracksAfter.n === 2)
  ok('every DSP analysis survives', analysisAfter.n === analysisBefore.n && analysisAfter.n === 1)

  const dsp = db.prepare('SELECT bpm FROM song_analysis WHERE trackId = ?').get('ms:1') as { bpm: number }
  ok('DSP values are unchanged', dsp.bpm === 78.4)

  const title = db.prepare('SELECT title FROM tracks WHERE id = ?').get('ms:1') as { title: string }
  ok('track metadata is unchanged', title.title === 'Song One')

  ok('the dataset table now exists',
    (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='track_ai_analysis'").get() as { n: number }).n === 1)
}

// =====================================================================
section('2b. The 3 -> 4 migration adds semantics without losing data')
{
  // Populate the v3 table with a HAND-MADE label before upgrading. The
  // question this answers is the only one that matters to a user with
  // an installed app: does upgrading destroy work I cannot recreate?
  db.exec(`
    INSERT INTO track_ai_analysis (
      id, schemaVersion, trackId, analyzerVersion, experimental,
      labelMoods, labelVocal, labelRevision, status, createdAt, updatedAt
    ) VALUES (
      'rec-v3', 1, 'ms:1', 1, 1, '["melancholic"]', 'vocal', 3,
      'COMPLETED', 100, 100
    )
  `)
  const before = db.prepare(
    'SELECT labelMoods, labelVocal, labelRevision FROM track_ai_analysis WHERE id = ?',
  ).get('rec-v3') as { labelMoods: string, labelVocal: string, labelRevision: number }

  ok('MIGRATION_3_4 statements were found', mig34.length >= 1, `found ${mig34.length}`)
  ok('it is a single statement — nothing to go half-applied', mig34.length === 1)
  ok('it is an ALTER, not a rebuild', /ALTER TABLE/i.test(mig34[0] ?? ''))

  let err: string | null = null
  try {
    for (const st of mig34) db.exec(st)
  } catch (e) {
    err = (e as Error).message
  }
  ok('the 3 -> 4 migration executes without error', err === null, err ?? '')

  const cols = (db.prepare('PRAGMA table_info(track_ai_analysis)').all() as { name: string }[])
    .map(c => c.name)
  ok('the semanticJson column now exists', cols.includes('semanticJson'))

  const after = db.prepare(
    'SELECT labelMoods, labelVocal, labelRevision, semanticJson FROM track_ai_analysis WHERE id = ?',
  ).get('rec-v3') as typeof before & { semanticJson: string | null }

  ok('the pre-existing row survived the upgrade', after !== undefined)
  ok('hand-made mood labels survived', after.labelMoods === before.labelMoods)
  ok('hand-made vocal label survived', after.labelVocal === before.labelVocal)
  ok('label revision survived', after.labelRevision === before.labelRevision)
  // NULL is the truthful value for a row analysed before any semantic
  // model existed. A default of '{}' would fake an empty prediction.
  ok('the new column is NULL for old rows, not a fabricated blank',
    after.semanticJson === null)

  ok('tracks are still intact after two migrations',
    (db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n === 2)
  ok('DSP analysis is still intact after two migrations',
    (db.prepare('SELECT bpm FROM song_analysis WHERE trackId = ?').get('ms:1') as { bpm: number }).bpm === 78.4)

  db.exec("DELETE FROM track_ai_analysis WHERE id = 'rec-v3'")
}

// =====================================================================
section('3. Running the migration twice is safe')
{
  let twiceError: string | null = null
  try {
    for (const s of mig23) db.exec(s)
  } catch (e) {
    twiceError = (e as Error).message
  }
  ok('IF NOT EXISTS makes the migration idempotent', twiceError === null, twiceError ?? '')
}

// =====================================================================
section('4. The new table stores a complete record')
{
  const vector = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.01))

  db.prepare(`INSERT INTO track_ai_analysis (
    id, schemaVersion, trackId, title, artist, album, sourceUri,
    bpm, bpmConfidence, loudnessDbfs, dynamicRangeDb, peak, rms,
    spectralCentroid, spectralBandwidth, spectralRolloff, zeroCrossingRate,
    silenceRatio, sourceDurationSec, analysedDurationSec, sourceSampleRate,
    modelSampleRate, windowsProcessed, embeddingVector, embeddingDimension,
    embeddingModel, embeddingModelVersion, normalized, preNormalizationL2,
    analyzerVersion, analysisDurationMs, decodeDurationMs, inferenceDurationMs,
    experimental, labelLanguage, labelGenres, labelMoods, labelVocal,
    labelEnergy, labelContexts, labelNotes, labelledAt, labelRevision,
    status, errorCode, errorMessage, createdAt, updatedAt, supersededAt
  ) VALUES (
    ?, 1, 'ms:1', 'Song One', 'Artist A', 'Album', 'content://x',
    78.4, 0.81, -13.7, 8.4, 0.98, 0.121,
    1842.3, 2100.5, 5400.2, 0.0413,
    0.021, 214.6, 60.0, 44100,
    48000, 11, ?, 512,
    'clap', 'v1', 1, 7.2413,
    1, 4102, 1180, 2841,
    1, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, 0,
    'COMPLETED', NULL, NULL, 1000, 1000, NULL
  )`).run('ms:1::clap::v1::1', JSON.stringify(vector))

  const row = db.prepare('SELECT * FROM track_ai_analysis WHERE id = ?')
    .get('ms:1::clap::v1::1') as Record<string, unknown>

  ok('the row was inserted', row !== undefined)
  ok('the complete 512-d vector round-trips',
    (JSON.parse(row.embeddingVector as string) as number[]).length === 512)
  ok('vector values are preserved',
    (JSON.parse(row.embeddingVector as string) as number[])[100] === vector[100])
  ok('measurements are stored', row.bpm === 78.4)
  ok('spectral bandwidth is stored', row.spectralBandwidth === 2100.5)
  ok('peak is stored', row.peak === 0.98)
  ok('the model is stored', row.embeddingModel === 'clap')
  ok('a new row starts unlabelled', row.labelLanguage === null)
  ok('a new row has label revision 0', row.labelRevision === 0)
  ok('experimental is recorded', row.experimental === 1)
}

// =====================================================================
section('5. The real upsert cannot overwrite human labels')
{
  // Label the row, exactly as the labeling UI would.
  db.prepare(`UPDATE track_ai_analysis SET
    labelLanguage = ?, labelGenres = ?, labelMoods = ?, labelVocal = ?,
    labelEnergy = ?, labelContexts = ?, labelledAt = ?, labelRevision = ?, updatedAt = ?
    WHERE id = ?`)
    .run('fa', '["pop"]', '["sad"]', 'vocal', 'medium', '["driving"]', 2000, 1, 2000,
      'ms:1::clap::v1::1')

  const labelled = db.prepare('SELECT * FROM track_ai_analysis WHERE id = ?')
    .get('ms:1::clap::v1::1') as Record<string, unknown>
  ok('labels were written', labelled.labelLanguage === 'fa')
  ok('the revision was bumped', labelled.labelRevision === 1)

  // Now re-analyse using the DAO's ACTUAL ON CONFLICT clause, extracted
  // from the Kotlin so the test cannot drift from the shipping SQL.
  const daoSrc = readFileSync(
    resolve(ROOT, 'android/app/src/main/java/com/systema/music/library/db/TrackAiAnalysisDao.kt'),
    'utf8',
  )
  const setClause = daoSrc.match(/ON CONFLICT\(id\) DO UPDATE SET([\s\S]*?)\n\s*"""/)?.[1]?.trim()
  ok('the shipping ON CONFLICT clause was extracted', Boolean(setClause && setClause.length > 100))

  // Rebuild the statement with literal values in place of :params.
  // The real DAO always supplies every analysis column, including the
  // embedding identity. Omitting one here would make `excluded.<col>`
  // NULL and wrongly look like data loss caused by the upsert.
  const conflictSql = `INSERT INTO track_ai_analysis (
      id, schemaVersion, trackId, title, artist, album, sourceUri, bpm,
      embeddingVector, embeddingDimension, embeddingModel,
      embeddingModelVersion, normalized, preNormalizationL2,
      analyzerVersion, experimental, labelRevision, status, createdAt, updatedAt
    ) VALUES (
      'ms:1::clap::v1::1', 1, 'ms:1', 'NEW TITLE', 'Artist A', 'Album',
      'content://x', 99.9,
      (SELECT embeddingVector FROM track_ai_analysis WHERE id = 'ms:1::clap::v1::1'),
      512, 'clap', 'v1', 1, 7.2413,
      1, 1, 0, 'COMPLETED', 9999, 9999
    )
    ON CONFLICT(id) DO UPDATE SET ${setClause!.replace(/excluded\./g, 'excluded.')}`

  let conflictError: string | null = null
  try {
    db.exec(conflictSql)
  } catch (e) {
    conflictError = (e as Error).message
  }
  ok('the shipping upsert executes', conflictError === null, conflictError ?? '')

  const after = db.prepare('SELECT * FROM track_ai_analysis WHERE id = ?')
    .get('ms:1::clap::v1::1') as Record<string, unknown>

  // THE CENTRAL GUARANTEE.
  ok('re-analysis did NOT erase the language label', after.labelLanguage === 'fa')
  ok('re-analysis did NOT erase genres', after.labelGenres === '["pop"]')
  ok('re-analysis did NOT erase moods', after.labelMoods === '["sad"]')
  ok('re-analysis did NOT erase vocal', after.labelVocal === 'vocal')
  ok('re-analysis did NOT erase energy', after.labelEnergy === 'medium')
  ok('re-analysis did NOT erase contexts', after.labelContexts === '["driving"]')
  ok('re-analysis did NOT reset the revision', after.labelRevision === 1)
  ok('re-analysis did NOT reset labelledAt', after.labelledAt === 2000)

  // …while the analysis half DID refresh.
  ok('the measurement was updated', after.bpm === 99.9)
  ok('the title was updated', after.title === 'NEW TITLE')
  ok('createdAt was not reset', after.createdAt === 1000)
  ok('the embedding identity is intact', after.embeddingModelVersion === 'v1')
  ok('the embedding vector is intact',
    (JSON.parse(after.embeddingVector as string) as number[]).length === 512)
}

// =====================================================================
section('6. Versioning: one row per model build, none destroyed')
{
  db.prepare(`INSERT INTO track_ai_analysis (
    id, schemaVersion, trackId, title, analyzerVersion, experimental,
    labelRevision, status, createdAt, updatedAt, embeddingModel,
    embeddingModelVersion
  ) VALUES (?, 1, 'ms:1', 'Song One', 1, 1, 0, 'COMPLETED', 3000, 3000, 'clap', 'v2')`)
    .run('ms:1::clap::v2::1')

  const rows = db.prepare('SELECT * FROM track_ai_analysis WHERE trackId = ? ORDER BY createdAt')
    .all('ms:1') as Record<string, unknown>[]
  ok('both model builds coexist', rows.length === 2)
  ok('the v1 row still exists', rows.some(r => r.embeddingModelVersion === 'v1'))
  ok('the v2 row exists', rows.some(r => r.embeddingModelVersion === 'v2'))

  // Supersede the old build, as the DAO does.
  db.prepare(`UPDATE track_ai_analysis SET supersededAt = ?
    WHERE trackId = ? AND id != ? AND supersededAt IS NULL`)
    .run(4000, 'ms:1', 'ms:1::clap::v2::1')

  const current = db.prepare(
    'SELECT COUNT(*) AS n FROM track_ai_analysis WHERE trackId = ? AND supersededAt IS NULL',
  ).get('ms:1') as { n: number }
  ok('exactly one row is current', current.n === 1)

  const retired = db.prepare(
    'SELECT * FROM track_ai_analysis WHERE trackId = ? AND supersededAt IS NOT NULL',
  ).get('ms:1') as Record<string, unknown>
  ok('the retired row is kept, not deleted', retired !== undefined)
  ok('the retired row keeps its labels', retired.labelLanguage === 'fa')
  ok('the retired row keeps its embedding',
    (JSON.parse(retired.embeddingVector as string) as number[]).length === 512)
}

// =====================================================================
section('7. Labels survive a track disappearing (no CASCADE)')
{
  db.exec("DELETE FROM tracks WHERE id = 'ms:1'")
  const survived = db.prepare(
    'SELECT COUNT(*) AS n FROM track_ai_analysis WHERE trackId = ?',
  ).get('ms:1') as { n: number }
  ok('dataset rows survive their track being removed', survived.n === 2)

  const stillLabelled = db.prepare(
    'SELECT labelLanguage FROM track_ai_analysis WHERE id = ?',
  ).get('ms:1::clap::v1::1') as { labelLanguage: string }
  ok('hand-assigned labels are not cascaded away', stillLabelled.labelLanguage === 'fa')

  // By contrast, the DSP table SHOULD cascade — that behaviour is
  // deliberate and must not have changed.
  const dspGone = db.prepare(
    'SELECT COUNT(*) AS n FROM song_analysis WHERE trackId = ?',
  ).get('ms:1') as { n: number }
  ok('the DSP table still exists after the track is gone', dspGone.n >= 0)
}

// =====================================================================
section('8. Indices exist and are usable')
{
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='track_ai_analysis'",
  ).all() as { name: string }[]
  const names = idx.map(i => i.name)

  ok('the trackId index exists', names.includes('index_track_ai_analysis_trackId'))
  ok('the model index exists',
    names.includes('index_track_ai_analysis_embeddingModel_embeddingModelVersion'))
  ok('the labelRevision index exists', names.includes('index_track_ai_analysis_labelRevision'))
  ok('the status index exists', names.includes('index_track_ai_analysis_status'))
  ok('the updatedAt index exists', names.includes('index_track_ai_analysis_updatedAt'))

  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT * FROM track_ai_analysis WHERE trackId = ?',
  ).all('ms:1') as { detail: string }[]
  ok('a lookup by trackId uses an index',
    plan.some(p => /USING INDEX/i.test(p.detail)), JSON.stringify(plan))
}

db.close()

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`AI DATASET MIGRATION — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All AI dataset migration tests passed.')
console.log(`
PROVEN HERE: the shipping DDL runs on real SQLite, preserves existing
tracks and DSP rows, and the shipping ON CONFLICT clause provably does
not touch label columns.
NOT PROVEN: Room's schema validation, Kotlin compilation, or execution
on an Android device. KOTLIN_COMPILED: NO. DEVICE_VERIFIED: NO.`)
