package com.systema.music.library

import android.content.Context
import android.util.Log
import com.systema.music.library.db.MusicLibraryDatabase
import com.systema.music.library.db.TrackDao
import com.systema.music.library.db.TrackEntity
import com.systema.music.library.db.TrackMapper
import com.systema.music.library.db.TrackSyncKey
import com.systema.music.library.model.MusicTrack
import com.systema.music.library.model.ScanProgress
import com.systema.music.library.model.ScanState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The single entry point to SYSTEMA's local music library.
 *
 * Everything above this class — the Capacitor plugin, Pinia, Vue and
 * every future phase (Media3 playback, AI analysis, semantic search) —
 * talks only to this API. Whether a track came from MediaStore, Room or
 * some later source is an implementation detail that never leaks.
 *
 *   MediaStore -> MediaStoreScanner -> MusicLibraryRepository -> Room
 *
 * Concurrency: all work runs on [Dispatchers.IO] under a supervised
 * scope owned by this repository. Nothing touches the main thread.
 */
class MusicLibraryRepository private constructor(
    private val context: Context,
    private val dao: TrackDao,
    private val scanner: MediaStoreScanner,
) {

    companion object {
        private const val TAG = "SystemaLibrary"

        /**
         * Rows read from MediaStore and written to Room per batch.
         * 250 keeps each transaction short (so progress stays smooth
         * and cancellation is responsive) while amortising the
         * per-transaction cost across a large library.
         */
        private const val SCAN_BATCH_SIZE = 250

        /** Chunk for `UPDATE ... WHERE id IN (...)`, safely under SQLite's variable cap. */
        private const val SQL_VARIABLE_CHUNK = 500

        const val DEFAULT_PAGE_LIMIT = 50
        const val MAX_PAGE_LIMIT = 500

        @Volatile
        private var instance: MusicLibraryRepository? = null

        fun get(context: Context): MusicLibraryRepository {
            return instance ?: synchronized(this) {
                instance ?: run {
                    val app = context.applicationContext
                    MusicLibraryRepository(
                        context = app,
                        dao = MusicLibraryDatabase.get(app).trackDao(),
                        scanner = MediaStoreScanner(app),
                    ).also { instance = it }
                }
            }
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val scanMutex = Mutex()
    private val cancelRequested = AtomicBoolean(false)
    private var scanJob: Job? = null

    private val _progress = MutableStateFlow(ScanProgress())

    /** Observable scan telemetry consumed by the plugin's event stream. */
    val progress: StateFlow<ScanProgress> = _progress.asStateFlow()

    // ---------------------------------------------------------------
    // Permission
    // ---------------------------------------------------------------

    fun hasPermission(): Boolean = MusicPermissions.hasPermission(context)

    fun permissionState(): String = MusicPermissions.stateFor(context)

    // ---------------------------------------------------------------
    // Scanning
    // ---------------------------------------------------------------

    /**
     * Starts an asynchronous incremental scan.
     *
     * Returns immediately; callers observe [progress] (the plugin
     * forwards it as scanStarted / scanProgress / scanCompleted /
     * scanError events).
     *
     * @throws MusicLibraryException if permission is missing or a scan
     *   is already running.
     */
    fun startScan(onProgress: (ScanProgress) -> Unit) {
        if (!hasPermission()) {
            throw MusicLibraryException(
                MusicLibraryException.Code.PERMISSION_DENIED,
                "Audio library permission has not been granted.",
            )
        }
        if (isScanning()) {
            throw MusicLibraryException(
                MusicLibraryException.Code.SCAN_IN_PROGRESS,
                "A library scan is already running.",
            )
        }

        cancelRequested.set(false)
        scanJob = scope.launch {
            scanMutex.withLock {
                runScan(onProgress)
            }
        }
    }

    fun isScanning(): Boolean = scanJob?.isActive == true

    fun cancelScan() {
        cancelRequested.set(true)
    }

    private suspend fun runScan(onProgress: (ScanProgress) -> Unit) {
        val startedAt = System.currentTimeMillis()
        // Monotonic-enough token identifying this scan generation.
        val scanToken = startedAt

        fun publish(next: ScanProgress) {
            _progress.value = next
            onProgress(next)
        }

        var state = ScanProgress(
            state = ScanState.SCANNING,
            startedAt = startedAt,
            total = null,
        )
        publish(state)

        try {
            val total = scanner.countTracks()
            state = state.copy(total = total)
            publish(state)

            // Snapshot of what Room already knows: three columns only.
            val existing: MutableMap<String, TrackSyncKey> =
                dao.loadSyncKeys().associateByTo(HashMap()) { it.id }

            val pendingTouch = ArrayList<String>(SQL_VARIABLE_CHUNK)

            val discovered = scanner.scan(
                batchSize = SCAN_BATCH_SIZE,
                isCancelled = { cancelRequested.get() },
            ) { batch ->
                val inserts = ArrayList<TrackEntity>(batch.size)
                val updates = ArrayList<TrackEntity>()
                var unchangedInBatch = 0

                for (track in batch) {
                    val known = existing.remove(track.id)
                    when {
                        known == null ->
                            inserts.add(TrackMapper.toEntity(track, scanToken))

                        // Same file, unchanged on disk: keep the row,
                        // just mark it as seen by this scan.
                        known.dateModified == track.dateModified &&
                            known.fileSize == track.fileSize -> {
                            pendingTouch.add(track.id)
                            unchangedInBatch++
                        }

                        else -> updates.add(TrackMapper.toEntity(track, scanToken))
                    }
                }

                // Persist this batch, then move on. The full library is
                // never held in memory at once.
                dao.applyBatch(inserts, updates)
                if (pendingTouch.size >= SQL_VARIABLE_CHUNK) {
                    flushTouches(pendingTouch, scanToken)
                }

                state = state.copy(
                    discovered = state.discovered + batch.size,
                    processed = state.processed + batch.size,
                    inserted = state.inserted + inserts.size,
                    updated = state.updated + updates.size,
                    unchanged = state.unchanged + unchangedInBatch,
                )
                publish(state)
            }

            flushTouches(pendingTouch, scanToken)

            if (cancelRequested.get()) {
                state = state.copy(state = ScanState.IDLE, finishedAt = System.currentTimeMillis())
                publish(state)
                return
            }

            // Anything Room still holds from an older generation is gone
            // from the device. One indexed DELETE, no full rebuild.
            val removed = dao.deleteStale(scanToken)

            state = state.copy(
                state = ScanState.COMPLETED,
                discovered = discovered,
                removed = removed,
                finishedAt = System.currentTimeMillis(),
            )
            publish(state)
            Log.i(
                TAG,
                "Scan complete: +${state.inserted} ~${state.updated} -${state.removed} " +
                    "=${state.unchanged} of ${state.discovered}",
            )
        } catch (e: SecurityException) {
            // Permission revoked mid-scan (the user can do this from
            // Settings at any time). Report it as a permission problem,
            // not an unknown failure.
            Log.w(TAG, "Scan lost audio permission", e)
            publish(
                state.copy(
                    state = ScanState.ERROR,
                    errorCode = MusicLibraryException.Code.PERMISSION_DENIED.name,
                    errorMessage = "Access to your audio files was revoked.",
                    finishedAt = System.currentTimeMillis(),
                ),
            )
        } catch (e: MusicLibraryException) {
            Log.e(TAG, "Scan failed (${e.codeName})", e)
            publish(
                state.copy(
                    state = ScanState.ERROR,
                    errorCode = e.codeName,
                    errorMessage = e.message,
                    finishedAt = System.currentTimeMillis(),
                ),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Scan failed", e)
            publish(
                state.copy(
                    state = ScanState.ERROR,
                    errorCode = MusicLibraryException.Code.UNKNOWN.name,
                    // Deliberately generic: no stack traces cross the bridge.
                    errorMessage = "The library scan could not be completed.",
                    finishedAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    private suspend fun flushTouches(pending: MutableList<String>, scanToken: Long) {
        if (pending.isEmpty()) return
        pending.chunked(SQL_VARIABLE_CHUNK).forEach { dao.touch(it, scanToken) }
        pending.clear()
    }

    // ---------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------

    suspend fun count(): Int = withContext(Dispatchers.IO) {
        try {
            dao.count()
        } catch (e: Exception) {
            throw MusicLibraryException(
                MusicLibraryException.Code.DATABASE_ERROR,
                "The library index could not be read.",
                e,
            )
        }
    }

    suspend fun getTrack(id: String): MusicTrack? = withContext(Dispatchers.IO) {
        try {
            dao.findById(id)?.let(TrackMapper::toDomain)
        } catch (e: Exception) {
            throw MusicLibraryException(
                MusicLibraryException.Code.DATABASE_ERROR,
                "The track could not be read.",
                e,
            )
        }
    }

    /**
     * Offset paginated read. Pagination is mandatory from day one — no
     * caller ever receives the whole library in a single payload.
     */
    suspend fun getTracks(
        offset: Int,
        limit: Int,
        sort: TrackSort,
        order: SortOrder,
        query: String? = null,
    ): TrackPage = withContext(Dispatchers.IO) {
        val safeLimit = limit.coerceIn(1, MAX_PAGE_LIMIT)
        val safeOffset = offset.coerceAtLeast(0)

        try {
            val trimmed = query?.trim()
            if (!trimmed.isNullOrEmpty()) {
                // Search-ready surface. Phase 6 replaces the ranking,
                // not the API shape.
                // Escape LIKE wildcards; the DAO declares ESCAPE '\'.
                val escaped = trimmed
                    .replace("\\", "\\\\")
                    .replace("%", "\\%")
                    .replace("_", "\\_")
                val pattern = "%$escaped%"
                val total = dao.searchCount(pattern)
                val rows = dao.search(pattern, safeLimit, safeOffset)
                return@withContext TrackPage(
                    items = rows.map(TrackMapper::toDomain),
                    total = total,
                    offset = safeOffset,
                    limit = safeLimit,
                )
            }

            val total = dao.count()
            val rows = when (sort) {
                TrackSort.TITLE ->
                    if (order == SortOrder.ASC) dao.pageByTitleAsc(safeLimit, safeOffset)
                    else dao.pageByTitleDesc(safeLimit, safeOffset)

                TrackSort.ARTIST ->
                    if (order == SortOrder.ASC) dao.pageByArtistAsc(safeLimit, safeOffset)
                    else dao.pageByArtistDesc(safeLimit, safeOffset)

                TrackSort.ALBUM ->
                    if (order == SortOrder.ASC) dao.pageByAlbumAsc(safeLimit, safeOffset)
                    else dao.pageByAlbumDesc(safeLimit, safeOffset)

                TrackSort.DATE_ADDED ->
                    if (order == SortOrder.ASC) dao.pageByDateAddedAsc(safeLimit, safeOffset)
                    else dao.pageByDateAddedDesc(safeLimit, safeOffset)

                TrackSort.DURATION ->
                    if (order == SortOrder.ASC) dao.pageByDurationAsc(safeLimit, safeOffset)
                    else dao.pageByDurationDesc(safeLimit, safeOffset)
            }

            TrackPage(
                items = rows.map(TrackMapper::toDomain),
                total = total,
                offset = safeOffset,
                limit = safeLimit,
            )
        } catch (e: MusicLibraryException) {
            throw e
        } catch (e: Exception) {
            throw MusicLibraryException(
                MusicLibraryException.Code.DATABASE_ERROR,
                "The library page could not be read.",
                e,
            )
        }
    }

    /** Wipes the local index. Used by a destructive "reset library" action. */
    suspend fun clear() = withContext(Dispatchers.IO) {
        try {
            dao.clear()
            _progress.value = ScanProgress()
        } catch (e: Exception) {
            throw MusicLibraryException(
                MusicLibraryException.Code.DATABASE_ERROR,
                "The library index could not be cleared.",
                e,
            )
        }
    }
}

enum class TrackSort {
    TITLE, ARTIST, ALBUM, DATE_ADDED, DURATION;

    companion object {
        fun from(value: String?): TrackSort = when (value?.lowercase()) {
            "artist" -> ARTIST
            "album" -> ALBUM
            "duration" -> DURATION
            "dateadded", "date_added", "recently-added" -> DATE_ADDED
            else -> TITLE
        }
    }
}

enum class SortOrder {
    ASC, DESC;

    companion object {
        fun from(value: String?): SortOrder =
            if (value?.lowercase() == "desc") DESC else ASC
    }
}

data class TrackPage(
    val items: List<MusicTrack>,
    val total: Int,
    val offset: Int,
    val limit: Int,
) {
    val hasMore: Boolean get() = offset + items.size < total
    val nextOffset: Int? get() = if (hasMore) offset + items.size else null
}
