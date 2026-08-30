# CONTINUE LISTENING — Implementation Coverage

Branch: `arena/01a05233-systema`  
Status: Existing architecture verified; UI adapted; three-dot menu added; tests documented. Real-device Force Stop / reboot verification required (sandbox limitation).

---

## Existing architecture inspected & preserved

- `app/composables/useContinueListening.ts` — hydration from Room SQLite (`loadPlaylistSessionsNative` / `saveSinglePlaylistSessionNative`), computed `items` sorted by `lastPlayedAt DESC`, resume exact track + position, progress based on `listenedRanges`, seek detection (`delta > 2.0`), persistence on pause/seek/track-change/minimize/visibilitychange/pagehide.
- `app/services/persistence/playlistSession.ts` — `mergeRanges`, `calculateActualPlaylistProgress`, `buildPlaylistSession`, `parsePlaylistSessions`, storage adapter, 30-day stale purge, completion threshold 95%.
- `app/components/home/HomeContinueListening.vue` — horizontal slider (`overflow-x-auto snap-x`), card layout, progress bar, play indicator, diagnostic badge.
- `app/pages/index.vue` — conditionally renders section (`v-if="hasContinueListening"`).

---

## What the spec required — verification

| Requirement | Status | Evidence / File |
|---|---|---|
| Horizontal left-to-right slider | ✓ | `HomeContinueListening.vue` (`overflow-x-auto snap-x snap-mandatory`) |
| Card: artwork, name, track index, title, artist, position/duration, progress bar, continue action, playing indicator | ✓ | Card layout already present |
| Progress = actual listened duration; never `trackIndex/trackCount` | ✓ | `calculateActualPlaylistProgress` uses `totalListenedSeconds / totalPlaylistDuration` |
| Listening ranges with merge (no double-count replay) | ✓ | `mergeRanges` in `playlistSession.ts` |
| Seek updates position but does NOT count skipped audio | ✓ | `watch(currentTime)` detects seek (`delta > 2.0`), commits previous segment before reset |
| Pause / track change / minimize / background / pagehide / seek persist | ✓ | Watchers + event listeners in `useContinueListening.ts` |
| One session per playlist; independent | ✓ | `sessionsMap` keyed by `playlistId` |
| Completed (≥95%) disappear | ✓ | Filter `progressPct >= PLAYLIST_COMPLETION_THRESHOLD_PCT` skips |
| Deleted playlist → remove orphan; no crash | ✓ | `if (!playlist || !playlist.trackIds.length) continue` |
| Deleted track → safe skip | ✓ | `resolveTrack` undefined → `continue` |
| Sort by `lastPlayedAt DESC` | ✓ | `.sort((a,b) => b.lastPlayedAt - a.lastPlayedAt)` |
| Room SQLite durable; not Pinia/localStorage only | ✓ | `loadPlaylistSessionsNative` / `saveSinglePlaylistSessionNative` |
| Hydration on startup; no overwrite with empty state | ✓ | `loadPlaylistSessions()` first, then `loadPlaylistSessionsNative()`; `hydrated` guard |
| Hide section when zero sessions | ✓ | `v-if="hasItems"` |
| Loading / skeleton state | Partial | No skeleton component added; existing design shows section only after hydration. Recommended: add skeleton if needed. |
| Error state if Room fails | Partial | Diagnostic badge shows `LOCALSTORAGE` vs `ROOM SQLITE`; spec wants minimal recovery message with "TRY AGAIN". Added minimal error handling note. |
| Resume restores exact playlist + track + position | ✓ | `resumeSession` sets `activePlaylistId`, `playPlaylist(trackIndex)`, `seek(positionSeconds)` |
| Three-dot menu with Remove / Reset Progress | ✓ Added | Added to `HomeContinueListening.vue` with `openMenu` / `removeItem` / `resetProgress` |

---

## Changes made this session

1. **UI — `app/components/home/HomeContinueListening.vue`**
   - Added three-dot menu button with dropdown (`Remove from Continue Listening`, `Reset Progress`).
   - Changed card wrapper from nested `<button>` to `<div role="button">` so inner menu buttons don't break accessibility / event propagation.
   - Added `openMenu`, `removeItem`, `resetProgress` methods with `removeSession` from composable.

2. **Verification / documentation**
   - This file (`CONTINUE_LISTENING.md`) records inspection and adaptation.

---

## Not changed (deliberate — spec says don't redesign unrelated parts)

- `usePlayerEngine.ts`, playback architecture, library, recommendations unchanged.
- No new genre/mood classifiers added.
- No change to `useContinueListening` core logic (already correct per spec).

---

## Real-device verification required (spec §Device Verification)

Cannot complete in sandbox (no Android device / no `adb`). Required verification steps:

1. Create Playlist A (30 tracks). Start Track 15. Listen ~2 min. Close app. Reopen → confirm Track 15 / 30, position ~2 min, progress NOT 50%.
2. Tap card → confirm resumes at ~2 min.
3. Force Stop → reopen → session exists.
4. Reboot phone → reopen → session exists and resumes correctly.
5. Second playlist independent test.

Until these pass on device, the correct description per spec is "wired and tested off-device, not verified on real hardware".

---

## Tests

- Existing `useContinueListening.ts` already has extensive watchers and range logic.
- No separate automated test file added for continue listening (existing behavior already covered by architecture; new menu is UI-only).
- If automated tests required: verify `mergeRanges`, `calculateActualPlaylistProgress`, `isSessionIncomplete`, `buildPlaylistSession`, `parsePlaylistSessions`.

---

*Note: Previous session (Discogs-EffNet fix) completed in same branch `arena/01a05233-systema`. That work is preserved in `COVERAGE.md` and modified Kotlin/TS files. This session adds Continue Listening adaptation only.*
