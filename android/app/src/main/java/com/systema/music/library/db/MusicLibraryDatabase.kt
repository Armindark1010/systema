package com.systema.music.library.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Local music index.
 *
 * Version history
 * ---------------
 * 1 — Phase 1: `tracks` table only.
 * 2 — Phase 13: adds `song_analysis`, the on-device DSP results.
 * 3 — Phase 28: adds `track_ai_analysis`, the collected AI dataset
 *     (embeddings + measurements + HUMAN ground-truth labels).
 * 4 — Phase 29: adds `playlist_sessions`, durable Room SQLite persistence
 *     for active Playlist Listening Sessions (Continue Listening).
 * 5 — Phase 29: adds `playlists` & `playlist_tracks`, durable Room SQLite
 *     persistence for user and AI playlists.
 * 6 — Phase 29: adds `listenedRangesJson` & `totalListenedSeconds` to `playlist_sessions`
 *     for true listened-time tracking without index assumptions.
 *
 * Migration policy: destructive migration is deliberately NOT enabled.
 * A user's library index must survive app updates, and later phases
 * (AI analysis, playback stats, playlists) will store data that cannot be
 * regenerated from MediaStore. Every schema change ships an explicit
 * Migration in [MIGRATIONS].
 */
@Database(
    entities = [
        TrackEntity::class,
        AudioAnalysisEntity::class,
        TrackAiAnalysisEntity::class,
        PlaylistSessionEntity::class,
        PlaylistEntity::class,
        PlaylistTrackEntity::class,
    ],
    version = 6,
    exportSchema = true,
)
abstract class MusicLibraryDatabase : RoomDatabase() {

    abstract fun trackDao(): TrackDao

    abstract fun audioAnalysisDao(): AudioAnalysisDao

    abstract fun trackAiAnalysisDao(): TrackAiAnalysisDao

    abstract fun playlistSessionDao(): PlaylistSessionDao

    abstract fun playlistDao(): PlaylistDao

    companion object {
        private const val DB_NAME = "systema-music-library.db"

        /**
         * 1 -> 2: the Phase 13 DSP analysis table.
         *
         * Purely additive — `tracks` is untouched, so an existing
         * library index survives the upgrade intact and no re-scan is
         * triggered. The statements mirror the Room annotations on
         * AudioAnalysisEntity exactly; if they drift, Room's schema
         * validation fails loudly at open time rather than silently
         * corrupting reads.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `song_analysis` (
                        `trackId` TEXT NOT NULL,
                        `analyzerVersion` INTEGER NOT NULL,
                        `status` TEXT NOT NULL,
                        `analyzedAt` INTEGER NOT NULL,
                        `durationMs` INTEGER NOT NULL,
                        `sampleRate` INTEGER NOT NULL,
                        `channels` INTEGER NOT NULL,
                        `analyzedSampleCount` INTEGER NOT NULL,
                        `rms` REAL,
                        `peak` REAL,
                        `dynamicRangeDb` REAL,
                        `silenceRatio` REAL,
                        `spectralCentroid` REAL,
                        `spectralCentroidMin` REAL,
                        `spectralCentroidMax` REAL,
                        `spectralBandwidth` REAL,
                        `spectralRolloff` REAL,
                        `zeroCrossingRate` REAL,
                        `bpm` REAL,
                        `bpmConfidence` REAL,
                        `loudnessDbfs` REAL,
                        `decodeTimeMs` INTEGER,
                        `dspTimeMs` INTEGER,
                        `totalAnalysisTimeMs` INTEGER,
                        `errorCode` TEXT,
                        `attemptCount` INTEGER NOT NULL,
                        PRIMARY KEY(`trackId`),
                        FOREIGN KEY(`trackId`) REFERENCES `tracks`(`id`)
                            ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_song_analysis_analyzerVersion` " +
                        "ON `song_analysis` (`analyzerVersion`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_song_analysis_status` " +
                        "ON `song_analysis` (`status`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_song_analysis_bpm` " +
                        "ON `song_analysis` (`bpm`)",
                )
            }
        }

        /**
         * 2 -> 3: the Phase 28 AI dataset table.
         *
         * Purely additive. `tracks` and `song_analysis` are not read,
         * written or altered, so a user's library index and DSP results
         * survive untouched and no rescan is triggered.
         *
         * There is intentionally NO foreign key to `tracks`: these rows
         * carry hand-assigned labels that cost human time to produce,
         * and a library rescan that momentarily drops a track must not
         * CASCADE them away.
         *
         * Column types mirror TrackAiAnalysisEntity exactly. If they
         * drift, Room's schema validation fails loudly when the database
         * opens rather than corrupting reads.
         */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `track_ai_analysis` (
                        `id` TEXT NOT NULL,
                        `schemaVersion` INTEGER NOT NULL,
                        `trackId` TEXT NOT NULL,
                        `title` TEXT,
                        `artist` TEXT,
                        `album` TEXT,
                        `sourceUri` TEXT,
                        `bpm` REAL,
                        `bpmConfidence` REAL,
                        `loudnessDbfs` REAL,
                        `dynamicRangeDb` REAL,
                        `peak` REAL,
                        `rms` REAL,
                        `spectralCentroid` REAL,
                        `spectralBandwidth` REAL,
                        `spectralRolloff` REAL,
                        `zeroCrossingRate` REAL,
                        `silenceRatio` REAL,
                        `sourceDurationSec` REAL,
                        `analysedDurationSec` REAL,
                        `sourceSampleRate` INTEGER,
                        `modelSampleRate` INTEGER,
                        `windowsProcessed` INTEGER,
                        `embeddingVector` TEXT,
                        `embeddingDimension` INTEGER,
                        `embeddingModel` TEXT,
                        `embeddingModelVersion` TEXT,
                        `normalized` INTEGER,
                        `preNormalizationL2` REAL,
                        `analyzerVersion` INTEGER NOT NULL,
                        `analysisDurationMs` INTEGER,
                        `decodeDurationMs` INTEGER,
                        `inferenceDurationMs` INTEGER,
                        `experimental` INTEGER NOT NULL,
                        `labelLanguage` TEXT,
                        `labelGenres` TEXT,
                        `labelMoods` TEXT,
                        `labelVocal` TEXT,
                        `labelEnergy` TEXT,
                        `labelContexts` TEXT,
                        `labelNotes` TEXT,
                        `labelledAt` INTEGER,
                        `labelRevision` INTEGER NOT NULL,
                        `status` TEXT NOT NULL,
                        `errorCode` TEXT,
                        `errorMessage` TEXT,
                        `createdAt` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        `supersededAt` INTEGER,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_track_ai_analysis_trackId` " +
                        "ON `track_ai_analysis` (`trackId`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS " +
                        "`index_track_ai_analysis_embeddingModel_embeddingModelVersion` " +
                        "ON `track_ai_analysis` (`embeddingModel`, `embeddingModelVersion`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_track_ai_analysis_labelRevision` " +
                        "ON `track_ai_analysis` (`labelRevision`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_track_ai_analysis_status` " +
                        "ON `track_ai_analysis` (`status`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_track_ai_analysis_updatedAt` " +
                        "ON `track_ai_analysis` (`updatedAt`)",
                )
            }
        }

        /**
         * 3 -> 4: adds the semantic prediction column to `track_ai_analysis` (Phase 29).
         *
         * ADDITIVE AND NULLABLE. One ALTER TABLE, no table rebuild, no
         * data copy, so it cannot lose collected analyses or labels.
         * Existing rows get NULL, which is the truthful value — they
         * were analysed before any semantic model existed.
         */
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE `track_ai_analysis` ADD COLUMN `semanticJson` TEXT",
                )
            }
        }

        /**
         * 4 -> 5: the Playlists, Playlist Tracks & Listening Sessions tables (Phase 29).
         *
         * Purely additive. Tracks, DSP analysis and AI dataset are untouched.
         */
        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                android.util.Log.i("SystemaDb", "DATABASE_VERSION upgrading 4 -> 5 (creating playlist_sessions, playlists & playlist_tracks)")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `playlist_sessions` (
                        `playlistId` TEXT NOT NULL,
                        `trackId` TEXT NOT NULL,
                        `trackIndex` INTEGER NOT NULL,
                        `positionSeconds` REAL NOT NULL,
                        `durationSeconds` REAL NOT NULL,
                        `lastPlayedAt` INTEGER NOT NULL,
                        `updatedAt` TEXT NOT NULL,
                        `completed` INTEGER NOT NULL,
                        PRIMARY KEY(`playlistId`)
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_playlist_sessions_lastPlayedAt` " +
                        "ON `playlist_sessions` (`lastPlayedAt`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_playlist_sessions_completed` " +
                        "ON `playlist_sessions` (`completed`)",
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `playlists` (
                        `id` TEXT NOT NULL,
                        `title` TEXT NOT NULL,
                        `description` TEXT,
                        `cover` TEXT,
                        `kind` TEXT NOT NULL,
                        `createdAt` TEXT NOT NULL,
                        `updatedAt` TEXT NOT NULL,
                        `aiMetaJson` TEXT,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_playlists_title` ON `playlists` (`title`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_playlists_updatedAt` ON `playlists` (`updatedAt`)",
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `playlist_tracks` (
                        `rowId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `playlistId` TEXT NOT NULL,
                        `trackId` TEXT NOT NULL,
                        `position` INTEGER NOT NULL,
                        `addedAt` INTEGER NOT NULL,
                        FOREIGN KEY(`playlistId`) REFERENCES `playlists`(`id`)
                            ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_playlist_tracks_playlistId_position` " +
                        "ON `playlist_tracks` (`playlistId`, `position`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_playlist_tracks_playlistId` " +
                        "ON `playlist_tracks` (`playlistId`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_playlist_tracks_trackId` " +
                        "ON `playlist_tracks` (`trackId`)",
                )
            }
        }

        /**
         * 5 -> 6: True Listened Ranges & Time for Continue Listening.
         *
         * Purely additive columns on `playlist_sessions`.
         */
        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                android.util.Log.i("SystemaDb", "DATABASE_VERSION upgrading 5 -> 6 (adding listenedRangesJson & totalListenedSeconds)")
                db.execSQL("ALTER TABLE `playlist_sessions` ADD COLUMN `listenedRangesJson` TEXT")
                db.execSQL("ALTER TABLE `playlist_sessions` ADD COLUMN `totalListenedSeconds` REAL NOT NULL DEFAULT 0.0")
            }
        }

        /**
         * Explicit migrations. Every schema change appends one here
         * rather than dropping user data.
         */
        private val MIGRATIONS = arrayOf<Migration>(
            MIGRATION_1_2,
            MIGRATION_2_3,
            MIGRATION_3_4,
            MIGRATION_4_5,
            MIGRATION_5_6,
        )

        @Volatile
        private var instance: MusicLibraryDatabase? = null

        fun get(context: Context): MusicLibraryDatabase {
            return instance ?: synchronized(this) {
                instance ?: build(context.applicationContext).also {
                    instance = it
                    android.util.Log.i("SystemaDb", "DATABASE_OPEN db=systema-music-library.db version=6")
                }
            }
        }

        private fun build(context: Context): MusicLibraryDatabase =
            Room.databaseBuilder(context, MusicLibraryDatabase::class.java, DB_NAME)
                .addMigrations(*MIGRATIONS)
                .build()
    }
}
