/**
 * SYSTEMA — Room schema consistency checks for the AI dataset (Phase 28).
 *
 * There is no JVM, Android SDK or Gradle in this environment, so the
 * Kotlin cannot be compiled here. These are STATIC checks: they parse
 * the entity, the DAO and the migration and prove they agree with each
 * other.
 *
 * That matters because Room validates the schema when the database
 * opens. A migration whose CREATE TABLE drifts from the entity does not
 * fail at build time — it throws on the user's device, after the
 * upgrade, with their library already migrated.
 *
 * WHAT THIS CANNOT PROVE: that the Kotlin compiles, that Room's
 * annotation processor is satisfied, or that the migration runs. Only a
 * device build shows that.
 */

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
const DB = 'android/app/src/main/java/com/systema/music/library/db'
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const entity = read(`${DB}/TrackAiAnalysisEntity.kt`)
const dao = read(`${DB}/TrackAiAnalysisDao.kt`)
const database = read(`${DB}/MusicLibraryDatabase.kt`)

/** Strips Kotlin comments so a doc mention cannot satisfy a check. */
function stripKt(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// =====================================================================
section('1. Entity and migration describe the SAME table')
{
  const entityBody = stripKt(entity)
  ok('canary: entity survived comment stripping', entityBody.includes('data class TrackAiAnalysisEntity'))

  // Every @ColumnInfo name in the entity.
  const cols = [...entityBody.matchAll(/@ColumnInfo\(name\s*=\s*"([^"]+)"\)/g)].map(m => m[1]!)
  ok('the entity declares columns', cols.length > 40, `found ${cols.length}`)

  // The CREATE TABLE in the migration.
  const createMatch = database.match(/CREATE TABLE IF NOT EXISTS `track_ai_analysis`([\s\S]*?)\n\s*"""/)
  ok('the migration creates the table', createMatch !== null)
  const create = createMatch?.[1] ?? ''

  // Columns added by a later ALTER TABLE are legitimately absent from
  // the v3 CREATE TABLE — that statement must keep describing v3
  // forever. Collect them so parity is checked against the CURRENT
  // schema (create + alters), not against v3 alone.
  const altered = [...database.matchAll(
    /ALTER TABLE `track_ai_analysis` ADD COLUMN `([a-zA-Z0-9_]+)`/g)].map(m => m[1]!)
  const reachable = (c: string) =>
    new RegExp(`\`${c}\``).test(create) || altered.includes(c)

  const missing = cols.filter(c => !reachable(c))
  ok('every entity column exists in the migration', missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : '')

  // And the reverse: no column in SQL that the entity does not declare.
  const sqlCols = [...create.matchAll(/^\s*`([a-zA-Z0-9_]+)`\s+(TEXT|INTEGER|REAL|BLOB)/gm)].map(m => m[1]!)
  const extra = sqlCols.filter(c => !cols.includes(c))
  ok('the migration adds no unknown column', extra.length === 0,
    extra.length ? `extra: ${extra.join(', ')}` : '')
  ok('column counts agree', sqlCols.length + altered.length === cols.length,
    `sql=${sqlCols.length} entity=${cols.length}`)

  // NOT NULL must match Kotlin nullability exactly, or Room rejects it.
  const notNullSql = new Set(
    [...create.matchAll(/^\s*`([a-zA-Z0-9_]+)`\s+\w+\s+NOT NULL/gm)].map(m => m[1]!),
  )
  const nullableKt = new Set(
    [...entityBody.matchAll(/@ColumnInfo\(name\s*=\s*"([^"]+)"\)\s*(?:@\w+\s*)*val\s+\w+\s*:\s*[A-Za-z<>]+\?/g)]
      .map(m => m[1]!),
  )
  const contradiction = [...notNullSql].filter(c => nullableKt.has(c))
  ok('no NOT NULL column is nullable in Kotlin', contradiction.length === 0,
    contradiction.length ? contradiction.join(', ') : '')

  // Spot-check the ones that matter most.
  ok('id is NOT NULL', notNullSql.has('id'))
  ok('trackId is NOT NULL', notNullSql.has('trackId'))
  ok('analyzerVersion is NOT NULL', notNullSql.has('analyzerVersion'))
  ok('labelRevision is NOT NULL', notNullSql.has('labelRevision'))
  ok('status is NOT NULL', notNullSql.has('status'))
  ok('the embedding vector is nullable', !notNullSql.has('embeddingVector'))
  ok('bpm is nullable — absent is not zero', !notNullSql.has('bpm'))
  ok('the primary key is id', /PRIMARY KEY\(`id`\)/.test(create))
}

// =====================================================================
section('2. Every required field is actually stored')
{
  const required = [
    // identity
    'id', 'trackId', 'title', 'artist', 'album', 'sourceUri',
    // measurements
    'bpm', 'bpmConfidence', 'loudnessDbfs', 'dynamicRangeDb', 'peak', 'rms',
    'spectralCentroid', 'spectralBandwidth', 'spectralRolloff',
    'zeroCrossingRate', 'silenceRatio', 'sourceDurationSec',
    'analysedDurationSec', 'sourceSampleRate', 'modelSampleRate',
    'windowsProcessed',
    // embedding
    'embeddingVector', 'embeddingDimension', 'embeddingModel',
    'embeddingModelVersion', 'normalized', 'preNormalizationL2',
    // processing
    'analyzerVersion', 'analysisDurationMs', 'decodeDurationMs',
    'inferenceDurationMs', 'createdAt', 'updatedAt', 'status',
    'errorCode', 'errorMessage',
    // labels
    'labelLanguage', 'labelGenres', 'labelMoods', 'labelVocal',
    'labelEnergy', 'labelContexts',
  ]
  for (const col of required) {
    ok(`stores ${col}`, new RegExp(`@ColumnInfo\\(name = "${col}"\\)`).test(entity))
  }
}

// =====================================================================
section('3. Re-analysis physically cannot overwrite human labels')
{
  const daoBody = stripKt(dao)
  ok('canary: DAO survived comment stripping', daoBody.includes('interface TrackAiAnalysisDao'))

  // REPLACE would delete the row and lose the label columns.
  ok('there is no INSERT OR REPLACE', !/OnConflictStrategy\.REPLACE/.test(daoBody))
  ok('there is no @Insert at all', !/@Insert/.test(daoBody))
  ok('the upsert uses ON CONFLICT DO UPDATE', /ON CONFLICT\(id\) DO UPDATE SET/.test(daoBody))

  // Isolate the upsert's SET clause and prove no label column is in it.
  const setClause = daoBody.match(/ON CONFLICT\(id\) DO UPDATE SET([\s\S]*?)"""/)?.[1] ?? ''
  ok('the SET clause was located', setClause.length > 100)
  for (const col of [
    'labelLanguage', 'labelGenres', 'labelMoods', 'labelVocal',
    'labelEnergy', 'labelContexts', 'labelNotes', 'labelRevision', 'labelledAt',
  ]) {
    ok(`the upsert never assigns ${col}`, !new RegExp(`${col}\\s*=`).test(setClause))
  }
  ok('the upsert does not reset createdAt', !/createdAt\s*=/.test(setClause))
  ok('the upsert does refresh measurements', /bpm = excluded\.bpm/.test(setClause))
  ok('the upsert does refresh the embedding',
    /embeddingVector = excluded\.embeddingVector/.test(setClause))

  // The label writer touches only labels.
  const labelUpdate = daoBody.match(/UPDATE track_ai_analysis SET\s*\n\s*labelLanguage([\s\S]*?)"""/)?.[1] ?? ''
  ok('the label update was located', labelUpdate.length > 50)
  for (const col of ['bpm', 'embeddingVector', 'status', 'createdAt', 'analyzerVersion']) {
    ok(`the label update never assigns ${col}`, !new RegExp(`\\b${col}\\s*=`).test(labelUpdate))
  }
  ok('the label update writes the revision', /labelRevision = :revision/.test(labelUpdate))

  // A fresh insert must start unlabelled, never with invented values.
  const insertValues = daoBody.match(/\) VALUES \(([\s\S]*?)\)\s*ON CONFLICT/)?.[1] ?? ''
  ok('the insert VALUES list was located', insertValues.length > 100)
  ok('a new row inserts NULL labels', /NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL/.test(insertValues))
  ok('a new row starts at label revision 0', /\n\s*0, :status/.test(insertValues))
}

// =====================================================================
section('4. The migration is additive and safe')
{
  const declaredDbVersion = Number(/version\s*=\s*(\d+)/.exec(database)?.[1] ?? 4)
  ok('the database is at least version 4', declaredDbVersion >= 4)
  ok('the new entity is registered', /TrackAiAnalysisEntity::class/.test(database))
  ok('the DAO is exposed', /abstract fun trackAiAnalysisDao\(\): TrackAiAnalysisDao/.test(database))
  ok('MIGRATION_2_3 exists', /MIGRATION_2_3 = object : Migration\(2, 3\)/.test(database))
  ok('MIGRATION_3_4 exists', /MIGRATION_3_4 = object : Migration\(3, 4\)/.test(database))
  // Every migration must be registered; an unregistered one is a crash
  // on upgrade, not a compile error.
  for (const m of ['MIGRATION_1_2', 'MIGRATION_2_3', 'MIGRATION_3_4']) {
    ok(`${m} is registered`,
      new RegExp(`arrayOf<Migration>\\([\\s\\S]*?${m}[\\s\\S]*?\\)`).test(database))
  }
  // The chain must be unbroken: a gap strands users on the old version.
  const declared = [...database.matchAll(/Migration\((\d+), (\d+)\)/g)]
    .map(m => [Number(m[1]), Number(m[2])] as const)
    .sort((a, b) => a[0] - b[0])
  ok('the migration chain has no gap',
    declared.every((step, i) => i === 0 || step[0] === declared[i - 1]![1]))
  ok('the chain ends at the declared database version',
    declared[declared.length - 1]?.[1] === declaredDbVersion)

  // v4 must be additive: no data-losing statement in the new migration.
  const m34Start = database.indexOf('MIGRATION_3_4 = object')
  const m34End = database.indexOf('= object : Migration(', m34Start + 20)
  const m34 = database.slice(m34Start, m34End === -1 ? undefined : m34End)
  ok('the 3->4 migration only ALTERs', /ALTER TABLE/.test(m34))
  ok('the 3->4 migration drops nothing', !/DROP/i.test(m34))
  ok('the 3->4 migration deletes nothing', !/DELETE|TRUNCATE/i.test(m34))
  ok('the 3->4 migration does not rebuild the table', !/CREATE TABLE/i.test(m34))
  ok('schema export stays on', /exportSchema = true/.test(database))

  // Destructive migration must stay off: it would wipe the library.
  ok('destructive migration is NOT enabled',
    !/fallbackToDestructiveMigration/.test(database))

  // The migration must not touch existing user data.
  const mig = database.match(/MIGRATION_2_3 = object : Migration\(2, 3\) \{([\s\S]*?)\n        \}/)?.[1] ?? ''
  ok('the migration body was located', mig.length > 200)
  ok('the migration never drops a table', !/DROP TABLE/i.test(mig))
  ok('the migration never alters tracks', !/ALTER TABLE `?tracks`?/i.test(mig))
  ok('the migration never alters song_analysis', !/ALTER TABLE `?song_analysis`?/i.test(mig))
  ok('the migration never deletes rows', !/DELETE FROM/i.test(mig))
  ok('the migration only creates', /CREATE TABLE IF NOT EXISTS/.test(mig))
  ok('the migration creates its indices', (mig.match(/CREATE INDEX/g) ?? []).length >= 4)

  // Entity indices must exist in the migration, or Room's validation fails.
  const entityIdx = [...stripKt(entity).matchAll(/Index\(value = \[([^\]]+)\]\)/g)]
    .map(m => m[1]!.replace(/["\s]/g, ''))
  ok('the entity declares indices', entityIdx.length >= 4)
  for (const idx of entityIdx) {
    const cols = idx.split(',')
    const name = `index_track_ai_analysis_${cols.join('_')}`
    ok(`index ${name} is created`, mig.includes(name))
  }
}

// =====================================================================
section('5. No foreign key — labels must survive a rescan')
{
  const e = stripKt(entity)
  ok('there is no foreign key to tracks', !/ForeignKey/.test(e))
  ok('there is no CASCADE delete', !/CASCADE/.test(e))
  ok('the migration adds no foreign key',
    !/FOREIGN KEY[\s\S]{0,80}track_ai_analysis/i.test(database)
    && !(database.match(/CREATE TABLE IF NOT EXISTS `track_ai_analysis`([\s\S]*?)\n\s*"""/)?.[1] ?? '').includes('FOREIGN KEY'))
  // The reasoning must be recorded, so nobody "fixes" it later.
  ok('the decision is documented in the entity',
    /NO FOREIGN KEY/i.test(entity) && /labels/i.test(entity))
}

// =====================================================================
section('6. The existing DSP table is untouched')
{
  const analysisEntity = read(`${DB}/AudioAnalysisEntity.kt`)
  ok('song_analysis is still keyed by trackId',
    /@PrimaryKey[\s\S]{0,120}val trackId: String/.test(analysisEntity))
  ok('song_analysis still cascades from tracks', /ForeignKey\.CASCADE/.test(analysisEntity))
  ok('the DSP DAO still uses REPLACE',
    /OnConflictStrategy\.REPLACE/.test(read(`${DB}/AudioAnalysisDao.kt`)))
  ok('MIGRATION_1_2 is unchanged', /MIGRATION_1_2 = object : Migration\(1, 2\)/.test(database))
  ok('the DSP table is still created by 1->2',
    /CREATE TABLE IF NOT EXISTS `song_analysis`/.test(database))
}

// =====================================================================
section('7. The dataset table stores no sensitive path data')
{
  const e = stripKt(entity)
  ok('no filesystem path column', !/filePath|absolutePath|filesystemPath/i.test(e))
  ok('no directory column', !/directory|folderPath/i.test(e))
  ok('the URI is documented as a content URI, not a path',
    /content URI/i.test(entity))
  ok('the entity warns the URI is not logged', /never written to logs/i.test(entity))
}

// =====================================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`AI DATASET SCHEMA — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All AI dataset schema checks passed.')
console.log(`
NOT PROVEN HERE: these are STATIC source checks. No JVM or Android SDK
exists in this environment, so the Kotlin has NOT been compiled, Room's
annotation processor has NOT run, and the 2->3 migration has NOT been
executed. KOTLIN_COMPILED: NO. MIGRATION_RUN_ON_DEVICE: NO.`)
