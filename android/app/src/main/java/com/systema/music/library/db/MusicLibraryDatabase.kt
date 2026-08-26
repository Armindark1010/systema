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
 *
 * Migration policy: destructive migration is deliberately NOT enabled.
 * A user's library index must survive app updates, and later phases
 * (AI analysis, playback stats) will store data that cannot be
 * regenerated from MediaStore. Every schema change ships an explicit
 * Migration in [MIGRATIONS].
 */
@Database(
    entities = [TrackEntity::class, AudioAnalysisEntity::class],
    version = 2,
    exportSchema = true,
)
abstract class MusicLibraryDatabase : RoomDatabase() {

    abstract fun trackDao(): TrackDao

    abstract fun audioAnalysisDao(): AudioAnalysisDao

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
         * Explicit migrations. Every schema change appends one here
         * rather than dropping user data.
         */
        private val MIGRATIONS = arrayOf<Migration>(MIGRATION_1_2)

        @Volatile
        private var instance: MusicLibraryDatabase? = null

        fun get(context: Context): MusicLibraryDatabase {
            return instance ?: synchronized(this) {
                instance ?: build(context.applicationContext).also { instance = it }
            }
        }

        private fun build(context: Context): MusicLibraryDatabase =
            Room.databaseBuilder(context, MusicLibraryDatabase::class.java, DB_NAME)
                .addMigrations(*MIGRATIONS)
                .build()
    }
}
