package com.systema.music.library.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Local music index.
 *
 * Version history
 * ---------------
 * 1 — Phase 1: `tracks` table only.
 *
 * Migration policy: destructive migration is deliberately NOT enabled.
 * A user's library index must survive app updates, and later phases
 * (AI analysis, playback stats) will store data that cannot be
 * regenerated from MediaStore. Every schema change ships an explicit
 * Migration in [MIGRATIONS].
 */
@Database(
    entities = [TrackEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class MusicLibraryDatabase : RoomDatabase() {

    abstract fun trackDao(): TrackDao

    companion object {
        private const val DB_NAME = "systema-music-library.db"

        /**
         * Explicit migrations. Empty at version 1; every future schema
         * change appends one here rather than dropping user data.
         */
        private val MIGRATIONS = emptyArray<androidx.room.migration.Migration>()

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
