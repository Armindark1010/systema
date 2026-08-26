package com.systema.music.analysis.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Room database for audio analysis results.
 * 
 * This database stores the results of DSP analysis for tracks in the
 * music library. It is separate from the main MusicLibraryDatabase to
 * keep analysis data isolated and allow for independent versioning.
 * 
 * Version history:
 * ---------------
 * 1 — Phase 13: Initial schema with track_analysis table.
 *
 * Migration policy: Explicit migrations are required for schema changes.
 * Destructive migration is NOT enabled to preserve user data.
 */
@Database(
    entities = [TrackAnalysisEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class MusicAnalysisDatabase : RoomDatabase() {

    abstract fun trackAnalysisDao(): TrackAnalysisDao

    companion object {
        private const val DB_NAME = "systema-music-analysis.db"

        /**
         * Explicit migrations. Empty at version 1.
         * Every future schema change appends a migration here.
         */
        private val MIGRATIONS = arrayOf<Migration>()

        @Volatile
        private var instance: MusicAnalysisDatabase? = null

        fun get(context: Context): MusicAnalysisDatabase {
            return instance ?: synchronized(this) {
                instance ?: build(context.applicationContext).also { instance = it }
            }
        }

        private fun build(context: Context): MusicAnalysisDatabase {
            return Room.databaseBuilder(context, MusicAnalysisDatabase::class.java, DB_NAME)
                .addMigrations(*MIGRATIONS)
                .addCallback(object : RoomDatabase.Callback() {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        super.onCreate(db)
                        // Database created for the first time
                    }
                })
                .build()
        }
    }
}
