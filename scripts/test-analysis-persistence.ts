// ============================================================
// SYSTEMA — Phase 13: analysis persistence against real SQLite
// ============================================================
// Idempotency and structural uniqueness of `song_analysis`, executed
// rather than asserted.
//
// How this avoids being a source grep
// -----------------------------------
// The DDL below is not written by hand in this file. It is EXTRACTED
// from MusicLibraryDatabase.kt — the real MIGRATION_1_2 that ships in
// the app — and executed against a real SQLite database via
// node:sqlite. So these tests exercise the actual production schema:
// the actual primary key, the actual foreign key, the actual indices.
// If someone changes the migration so trackId is no longer unique, or
// drops the cascade, these fail.
//
// The DAO queries are extracted the same way, from AudioAnalysisDao.kt.
//
// What this cannot cover: Room's own code generation and its runtime
// schema validation. Those need the Android toolchain and are exercised
// by ./gradlew testDebugUnitTest and by running the app. What IS
// covered here is the schema contract itself, which is where the
// duplicate-row risk actually lives.
// ============================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let passed = 0
let failed = 0

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(name, a === b, a === b ? '' : `expected ${b}, got ${a}`)
}

const root = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

console.log('\n\x1b[1mSYSTEMA — Phase 13 analysis persistence (real SQLite)\x1b[0m\n')

// ============================================================
// Extract the shipping DDL from the shipping migration
// ============================================================

const dbSrc = read('android/app/src/main/java/com/systema/music/library/db/MusicLibraryDatabase.kt')

/**
 * Pulls every db.execSQL("""...""") / db.execSQL("..." + "...") body
 * out of MIGRATION_1_2, reassembling Kotlin string concatenation into
 * plain SQL.
 */
function extractMigrationSql(src: string): string[] {
  const statements: string[] = []

  // Triple-quoted blocks.
  for (const match of src.matchAll(/execSQL\(\s*"""([\s\S]*?)"""/g)) {
    statements.push(match[1]!.trim())
  }

  // Single-line / concatenated string blocks. Kotlin's trailing-comma
  // style means the closing paren may be preceded by `,` and newlines.
  for (const match of src.matchAll(/execSQL\(\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),?\s*\)/g)) {
    const literal = match[1]!
    if (literal.includes('"""')) continue
    const joined = [...literal.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map(m => m[1]!)
      .join('')
    if (joined.trim()) statements.push(joined.trim())
  }

  return statements
}

const migrationSql = extractMigrationSql(dbSrc)

ok('the shipping migration SQL was extracted from the Kotlin source',
  migrationSql.length >= 4, `found ${migrationSql.length} statements`)
ok('the migration creates the song_analysis table',
  migrationSql.some(s => /CREATE TABLE.*song_analysis/is.test(s)))
ok('the migration creates three indices',
  migrationSql.filter(s => /CREATE INDEX/i.test(s)).length === 3,
  `found ${migrationSql.filter(s => /CREATE INDEX/i.test(s)).length}`)

// ============================================================
console.log('\nMigration 1 -> 2 applies to a real v1 database')
// ============================================================

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON')

// The v1 schema: `tracks` only, matching TrackEntity's primary key.
// This is the state a user upgrading from Phase 1 is actually in.
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT NOT NULL,
    mediaStoreId INTEGER NOT NULL,
    volumeName TEXT NOT NULL,
    uri TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    duration INTEGER NOT NULL,
    dateAdded INTEGER NOT NULL,
    PRIMARY KEY(id)
  )
`)

// Pre-existing library data, to prove the migration is non-destructive.
const seedTracks = [
  ['track-a', 1, 'external', 'content://media/external/audio/media/1', 'Alpha', 300000, 500],
  ['track-b', 2, 'external', 'content://media/external/audio/media/2', 'Beta', 240000, 400],
  ['track-c', 3, 'external', 'content://media/external/audio/media/3', 'Gamma', 180000, 300],
  // Two copies of the SAME FILE imported twice: distinct MediaStore
  // ids, therefore distinct track ids. See the identity section below.
  ['track-dup1', 10, 'external', 'content://media/external/audio/media/10', 'Same Song', 200000, 200],
  ['track-dup2', 11, 'external', 'content://media/external/audio/media/11', 'Same Song', 200000, 100],
]
for (const t of seedTracks) {
  db.prepare(
    'INSERT INTO tracks (id, mediaStoreId, volumeName, uri, title, duration, dateAdded) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(...(t as [string, number, string, string, string, number, number]))
}

const tracksBefore = db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }

// Apply the REAL migration.
for (const statement of migrationSql) {
  db.exec(statement)
}

const tracksAfter = db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }
check('the migration preserves every existing track row', tracksAfter.n, tracksBefore.n)
ok('the migration is non-destructive (no track data lost)', tracksAfter.n === 5)

const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='song_analysis'").all()
ok('song_analysis exists after the migration', tableInfo.length === 1)

// ============================================================
console.log('\nStructural uniqueness of trackId')
// ============================================================

const schema = (db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='song_analysis'",
).get() as { sql: string }).sql

ok('trackId is the PRIMARY KEY', /PRIMARY KEY\s*\(\s*`?trackId`?\s*\)/i.test(schema))
ok('the foreign key targets tracks(id)', /FOREIGN KEY\s*\(\s*`?trackId`?\s*\)\s*REFERENCES\s*`?tracks`?\s*\(\s*`?id`?\s*\)/i.test(schema))
ok('the foreign key cascades on delete', /ON DELETE CASCADE/i.test(schema))

const pkInfo = db.prepare('PRAGMA table_info(song_analysis)').all() as Array<{ name: string, pk: number }>
const pkColumns = pkInfo.filter(c => c.pk > 0).map(c => c.name)
check('exactly one primary-key column, and it is trackId', pkColumns, ['trackId'])

const indices = (db.prepare('PRAGMA index_list(song_analysis)').all() as Array<{ name: string }>)
  .map(i => i.name)
ok('the analyzerVersion index exists', indices.some(i => i.includes('analyzerVersion')))
ok('the status index exists', indices.some(i => i.includes('status')))
ok('the bpm index exists', indices.some(i => i.includes('bpm')))

// ============================================================
console.log('\nRepeated analysis is idempotent')
// ============================================================

// The DAO's upsert is @Insert(onConflict = REPLACE), which Room emits
// as INSERT OR REPLACE. Verify that is really what the DAO declares,
// then execute the equivalent statement repeatedly.
const daoSrc = read('android/app/src/main/java/com/systema/music/library/db/AudioAnalysisDao.kt')
ok('the DAO upsert really uses OnConflictStrategy.REPLACE',
  /@Insert\(onConflict\s*=\s*OnConflictStrategy\.REPLACE\)\s*suspend fun upsert/.test(daoSrc))

const COLUMNS = [
  'trackId', 'analyzerVersion', 'status', 'analyzedAt', 'durationMs', 'sampleRate',
  'channels', 'analyzedSampleCount', 'rms', 'peak', 'dynamicRangeDb', 'silenceRatio',
  'spectralCentroid', 'spectralCentroidMin', 'spectralCentroidMax', 'spectralBandwidth',
  'spectralRolloff', 'zeroCrossingRate', 'bpm', 'bpmConfidence', 'loudnessDbfs',
  'decodeTimeMs', 'dspTimeMs', 'totalAnalysisTimeMs', 'errorCode', 'attemptCount',
]

/** Exactly what Room generates for @Insert(onConflict = REPLACE). */
const upsertSql = `INSERT OR REPLACE INTO song_analysis (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`

interface Row { [k: string]: string | number | null }

function analysisRow(trackId: string, overrides: Row = {}): unknown[] {
  const base: Row = {
    trackId,
    analyzerVersion: 1,
    status: 'COMPLETED',
    analyzedAt: 1_700_000_000_000,
    durationMs: 300000,
    sampleRate: 22050,
    channels: 2,
    analyzedSampleCount: 6615000,
    rms: 0.17,
    peak: 0.81,
    dynamicRangeDb: 8.4,
    silenceRatio: 0.06,
    spectralCentroid: 1893.5,
    spectralCentroidMin: 400.1,
    spectralCentroidMax: 4200.9,
    spectralBandwidth: 1500.2,
    spectralRolloff: 3800.7,
    zeroCrossingRate: 0.0164,
    bpm: 128.4,
    bpmConfidence: 0.59,
    loudnessDbfs: -15.5,
    decodeTimeMs: 800,
    dspTimeMs: 400,
    totalAnalysisTimeMs: 1200,
    errorCode: null,
    attemptCount: 0,
    ...overrides,
  }
  return COLUMNS.map(c => base[c] ?? null)
}

const upsert = db.prepare(upsertSql)

// Analyse the same track ten times, exactly as pressing RE-ANALYSE
// ten times would.
for (let i = 0; i < 10; i++) {
  upsert.run(...(analysisRow('track-a', { analyzedAt: 1_700_000_000_000 + i }) as never[]))
}

const countA = db.prepare('SELECT COUNT(*) AS n FROM song_analysis WHERE trackId = ?').get('track-a') as { n: number }
check('ten repeated analyses produce exactly one row', countA.n, 1)

const rowA = db.prepare('SELECT analyzedAt FROM song_analysis WHERE trackId = ?').get('track-a') as { analyzedAt: number }
check('the surviving row is the most recent analysis', rowA.analyzedAt, 1_700_000_000_009)

// A direct duplicate INSERT must be rejected outright — proving the
// uniqueness is enforced by the schema, not merely by the DAO.
let duplicateRejected = false
try {
  db.prepare(
    `INSERT INTO song_analysis (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
  ).run(...(analysisRow('track-a') as never[]))
} catch {
  duplicateRejected = true
}
ok('a plain duplicate INSERT is rejected by the primary key', duplicateRejected)
check('the rejected insert left the row count at one',
  (db.prepare('SELECT COUNT(*) AS n FROM song_analysis WHERE trackId = ?').get('track-a') as { n: number }).n, 1)

// Re-analysing at a NEWER analyzer version must still replace, not
// accumulate — the key is trackId alone, deliberately not (trackId,
// analyzerVersion).
upsert.run(...(analysisRow('track-a', { analyzerVersion: 2, bpm: 130.0 }) as never[]))
const afterVersionBump = db.prepare('SELECT COUNT(*) AS n FROM song_analysis WHERE trackId = ?').get('track-a') as { n: number }
check('re-analysing at a new analyzer version still yields one row', afterVersionBump.n, 1)
const bumped = db.prepare('SELECT analyzerVersion, bpm FROM song_analysis WHERE trackId = ?').get('track-a') as { analyzerVersion: number, bpm: number }
check('the row carries the new analyzer version', bumped.analyzerVersion, 2)
ok('no analysis history accumulates per version',
  (db.prepare('SELECT COUNT(*) AS n FROM song_analysis').get() as { n: number }).n === 1)

// Restore track-a to version 1 for the queue tests below.
upsert.run(...(analysisRow('track-a') as never[]))

// ============================================================
console.log('\nTrack identity is id-based, never path-based')
// ============================================================

// Two copies of the same audio file: same title, same duration, same
// bytes — but two MediaStore ids, therefore two track ids, therefore
// two independent analysis rows with near-identical DSP values.
upsert.run(...(analysisRow('track-dup1', { rms: 0.1700, bpm: 120.0 }) as never[]))
upsert.run(...(analysisRow('track-dup2', { rms: 0.1701, bpm: 120.0 }) as never[]))

const dupRows = db.prepare(
  "SELECT trackId, rms, bpm FROM song_analysis WHERE trackId IN ('track-dup1','track-dup2') ORDER BY trackId",
).all() as Array<{ trackId: string, rms: number, bpm: number }>

check('two copies of the same file produce two analysis rows', dupRows.length, 2)
ok('the two rows have distinct track ids',
  dupRows[0]!.trackId !== dupRows[1]!.trackId)
ok('the two rows carry near-identical DSP values (same audio)',
  Math.abs(dupRows[0]!.rms - dupRows[1]!.rms) < 0.001 && dupRows[0]!.bpm === dupRows[1]!.bpm)
ok('neither copy overwrote the other (identity is not path-based)',
  dupRows.map(r => r.trackId).join(',') === 'track-dup1,track-dup2')

// ============================================================
console.log('\nForeign key cascade removes orphans')
// ============================================================

db.prepare('DELETE FROM tracks WHERE id = ?').run('track-dup2')
const orphan = db.prepare('SELECT COUNT(*) AS n FROM song_analysis WHERE trackId = ?').get('track-dup2') as { n: number }
check('deleting a track cascades away its analysis', orphan.n, 0)
const survivor = db.prepare('SELECT COUNT(*) AS n FROM song_analysis WHERE trackId = ?').get('track-dup1') as { n: number }
check('the other copy\'s analysis is untouched', survivor.n, 1)

let orphanRejected = false
try {
  upsert.run(...(analysisRow('no-such-track') as never[]))
} catch {
  orphanRejected = true
}
ok('an analysis for a non-existent track is rejected by the foreign key', orphanRejected)

// ============================================================
console.log('\nQueue selection and failure bookkeeping')
// ============================================================

// The real DAO query, extracted from the DAO source rather than
// rewritten here.
function extractQuery(src: string, functionName: string): string {
  const fnIndex = src.indexOf(`fun ${functionName}(`)
  if (fnIndex < 0) throw new Error(`function ${functionName} not found`)
  const before = src.slice(0, fnIndex)
  const queryStart = before.lastIndexOf('@Query(')
  const body = src.slice(queryStart, fnIndex)
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]!).join('')
}

const needingAnalysisSql = extractQuery(daoSrc, 'findTracksNeedingAnalysis')
ok('the queue query was extracted from the DAO',
  needingAnalysisSql.includes('LEFT JOIN song_analysis'))

const queueSql = needingAnalysisSql
  .replace(/:currentVersion/g, '?')
  .replace(/:limit/g, '?')
const needing = db.prepare(queueSql).all(1, 50) as Array<{ id: string }>
const needingIds = needing.map(r => r.id).sort()

// track-a and track-dup1 are analysed at v1; b and c are not.
// track-dup2 was deleted.
check('only unanalysed tracks are queued', needingIds, ['track-b', 'track-c'])

// After bumping the analyzer version, previously-analysed tracks
// become stale and re-enter the queue.
const staleIds = (db.prepare(queueSql).all(2, 50) as Array<{ id: string }>).map(r => r.id).sort()
check('a version bump re-queues previously analysed tracks', staleIds,
  ['track-a', 'track-b', 'track-c', 'track-dup1'])

// markFailure: increments attemptCount without creating a second row.
const markFailureSql = extractQuery(daoSrc, 'markFailure')
  .replace(/:status/g, '?').replace(/:errorCode/g, '?')
  .replace(/:timestamp/g, '?').replace(/:trackId/g, '?')

upsert.run(...(analysisRow('track-b', { status: 'FAILED', errorCode: 'DECODER_ERROR', attemptCount: 1 }) as never[]))
for (let i = 0; i < 2; i++) {
  db.prepare(markFailureSql).run('FAILED', 'DECODER_ERROR', 1_700_000_100_000 + i, 'track-b')
}

const failedRow = db.prepare('SELECT COUNT(*) AS n, MAX(attemptCount) AS attempts FROM song_analysis WHERE trackId = ?')
  .get('track-b') as { n: number, attempts: number }
check('repeated failures still produce one row', failedRow.n, 1)
check('retryCount increments correctly across attempts', failedRow.attempts, 3)

// A track that failed is NOT re-queued at the same analyzer version:
// that is what stops the worker retrying a broken file forever.
const afterFailure = (db.prepare(queueSql).all(1, 50) as Array<{ id: string }>).map(r => r.id)
ok('a FAILED track is not re-queued at the same analyzer version',
  !afterFailure.includes('track-b'), `queue was ${JSON.stringify(afterFailure)}`)

// Status counters.
const completedCount = db.prepare(
  "SELECT COUNT(*) AS n FROM song_analysis WHERE analyzerVersion = ? AND status = 'COMPLETED'",
).get(1) as { n: number }
check('completed-at-version counts only completed rows', completedCount.n, 2)

const failedCount = db.prepare('SELECT COUNT(*) AS n FROM song_analysis WHERE status = ?').get('FAILED') as { n: number }
check('failed rows are counted separately', failedCount.n, 1)

// ============================================================
console.log('\nNo PROCESSING state can get stuck')
// ============================================================

const entitySrc = read('android/app/src/main/java/com/systema/music/library/db/AudioAnalysisEntity.kt')
const statusBlock = entitySrc.slice(entitySrc.indexOf('object AnalysisStatus'))
ok('the status vocabulary is PENDING / COMPLETED / FAILED only',
  statusBlock.includes('PENDING') && statusBlock.includes('COMPLETED')
  && statusBlock.includes('FAILED') && !statusBlock.includes('PROCESSING'))
ok('there is therefore no PROCESSING state that could be left stuck',
  !/\bPROCESSING\b/.test(entitySrc))

// A row is only ever written as COMPLETED (on success) or FAILED (on
// error). An interrupted analysis writes nothing at all, so a
// cancelled track simply stays absent and is re-queued next time.
const repoSrc = read('android/app/src/main/java/com/systema/music/analysis/AudioAnalysisRepository.kt')
ok('a cancelled analysis is not recorded as a failure',
  /if \(e\.code != AudioAnalysisException\.Code\.CANCELLED\)/.test(repoSrc))
ok('the result row is only written after a successful analysis',
  repoSrc.indexOf('analyzer.analyze(') < repoSrc.indexOf('analysisDao.upsert(result.toEntity())'))

db.close()

// ============================================================
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m\n`)
if (failed > 0) process.exit(1)
