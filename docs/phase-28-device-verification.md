# Phase 28 — Device Verification Checklist

**Status: NOT PERFORMED.**

Nothing in this checklist has been executed. This environment has no
Android device, no emulator, no JVM, no Android SDK and no Gradle, so
the Kotlin in this phase has never been compiled and the Room migration
has never run on a real database.

What *has* been verified is recorded at the bottom, separately, so the
two are not confused.

---

## Before starting

1. Build and install the app on the device.
2. Confirm the app opens and the music library loads as usual.
   *If the library is empty or the app crashes on launch, stop.* That
   would indicate the v2 → v3 migration failed, and the remaining steps
   would be meaningless.
3. Confirm playback works: play a track, pause, skip.

> **Watch for:** the migration is additive and must not disturb existing
> data. If tracks or previously computed DSP analyses have vanished,
> record it and stop — that is a release blocker.

---

## A. Analyse a real track

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1 | Open a real MP3 in the Full Player | Track plays normally | ☐ |
| 2 | Open the AI Analysis sheet | Sheet opens, playback unaffected | ☐ |
| 3 | Press Analyze | Loading state appears | ☐ |
| 4 | Wait for completion | Real results appear — dimension, model, timings | ☐ |
| 5 | Check the embedding line | Shows a dimension (512 for CLAP), marked experimental | ☐ |
| 6 | Check the measurements | Tempo/loudness present **only if** the DSP analyser already ran for this track; otherwise the sheet says so | ☐ |
| 7 | Confirm playback | Audio never stopped, stuttered or skipped | ☐ |

**Record:** model id, model version, dimension, inference ms.

---

## B. The record reaches the dataset

| # | Step | Expected | Result |
|---|------|----------|--------|
| 8 | Navigate to `/dev/ai-dataset` | Page loads | ☐ |
| 9 | Check for the NOT PERSISTED banner | **Must be ABSENT** on device | ☐ |
| 10 | Find the analysed track in the table | One row, correct title and artist | ☐ |
| 11 | Check the Embedding column | Shows the dimension, not a dash | ☐ |
| 12 | Check the label columns | All dashes — nothing was invented | ☐ |
| 13 | Check Completeness | Below 100%, since no labels exist yet | ☐ |

> **If the banner in step 9 appears**, the app fell back to the in-memory
> gateway. The plugin is not registered or the migration did not apply.
> Nothing after this point will persist.

---

## C. Add manual labels

| # | Step | Expected | Result |
|---|------|----------|--------|
| 14 | Press OPEN on the row | Editor opens with measurements shown read-only | ☐ |
| 15 | Check the save badge | Reads NOT LABELLED | ☐ |
| 16 | Select a language | Button becomes active | ☐ |
| 17 | Select one or more genres and moods | Multi-select toggles on and off | ☐ |
| 18 | Select vocal and energy | Single-select; pressing again clears | ☐ |
| 19 | Select one or more contexts | Multi-select works | ☐ |
| 20 | Check the badge again | Now reads UNSAVED CHANGES | ☐ |
| 21 | Press SAVE LABELS | Badge becomes SAVED | ☐ |
| 22 | Close the editor | Table row now shows the labels | ☐ |
| 23 | Check Completeness | Increased, ideally 100% | ☐ |

---

## D. Persistence across an app restart

| # | Step | Expected | Result |
|---|------|----------|--------|
| 24 | Fully close the app (swipe from recents, not just background) | — | ☐ |
| 25 | Reopen the app | Launches normally | ☐ |
| 26 | Go to `/dev/ai-dataset` | The record is still listed | ☐ |
| 27 | Check the labels | Exactly as entered | ☐ |
| 28 | Open the record | Measurements and embedding still present | ☐ |

**This is the core requirement of the phase.** If the row is gone, the
database is not being used and everything else is cosmetic.

Optional but valuable:

| # | Step | Expected | Result |
|---|------|----------|--------|
| 29 | Reboot the device, reopen the app | Record and labels still present | ☐ |
| 30 | Clear the app's *cache* (not data) in Android settings | Record and labels still present | ☐ |

> Note: clearing **storage/data** — as opposed to cache — deletes the
> database by design. That is Android's behaviour for all app data, not
> a defect in this feature.

---

## E. Re-analysis must not destroy labels

| # | Step | Expected | Result |
|---|------|----------|--------|
| 31 | Return to the Full Player with the same track | — | ☐ |
| 32 | Press RE-RUN in the AI Analysis sheet | Analysis runs again | ☐ |
| 33 | Go back to `/dev/ai-dataset` | — | ☐ |
| 34 | Check the same row | **Labels unchanged** | ☐ |
| 35 | Check the row count | Still one row for this track/model/version | ☐ |
| 36 | Check Updated | Timestamp moved forward | ☐ |

**This is the second core requirement.** Any label loss here is a
release blocker.

---

## F. Export

| # | Step | Expected | Result |
|---|------|----------|--------|
| 37 | Press EXPORT JSON | Note reads "Saved to Documents/SYSTEMA/…" with a byte count | ☐ |
| 38 | Open a file manager, go to Documents/SYSTEMA | The file exists | ☐ |
| 39 | Open the JSON (or copy it to a computer) | Valid JSON | ☐ |
| 40 | Find the analysed record | Present | ☐ |
| 41 | **Check `embedding.vector`** | Contains the COMPLETE vector — count the entries, expect 512 for CLAP, not a truncated list | ☐ |
| 42 | Check `groundTruth` | Contains exactly the labels entered, and `"source": "human"` | ☐ |
| 43 | Check the `notice` field | States labels are human-assigned and no predictions are included | ☐ |
| 44 | Press EXPORT CSV | A second file appears | ☐ |
| 45 | Open the CSV | One header row plus one row per record; multi-labels joined with `\|` | ☐ |

**Record:** actual vector length observed in the JSON.

---

## G. Reinstall survival (the honest test)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 46 | Confirm the export file is in Documents/SYSTEMA | — | ☐ |
| 47 | Uninstall the app | — | ☐ |
| 48 | Check Documents/SYSTEMA in a file manager | **The export file is still there** | ☐ |
| 49 | Reinstall the app | — | ☐ |
| 50 | Go to `/dev/ai-dataset` | **Empty — this is EXPECTED** | ☐ |

> **Be clear about what this proves.** The Room database does *not*
> survive an uninstall; no on-device database can, and this project has
> no server. What survives is the exported file, which is why the export
> exists. If the dataset must survive a reinstall automatically, that
> requires a real backend — a separate piece of work.

---

## H. Nothing else changed

| # | Step | Expected | Result |
|---|------|----------|--------|
| 51 | Play several tracks, skip, seek, pause | Behaves exactly as before | ☐ |
| 52 | Check the library | All tracks present, no rescan triggered | ☐ |
| 53 | Check existing DSP analyses | Still present for previously analysed tracks | ☐ |
| 54 | Check playlists | Unchanged | ☐ |
| 55 | Confirm no recommendation behaviour changed | Nothing new appears anywhere in the normal UI | ☐ |

---

## What WAS verified in development

For contrast — these were actually executed:

- **252** dataset contract assertions (identity, versioning, label
  preservation, null handling, filtering, statistics, export/import).
- **118** static schema checks proving the Room entity, DAO and
  migration agree with each other.
- **55** migration tests that **execute the shipping DDL on real
  SQLite** against a populated v2 database: existing tracks and DSP
  rows verified intact, indices created, and the real
  `ON CONFLICT DO UPDATE` clause proven not to touch label columns.
- **141** page and integration assertions, including an end-to-end
  analyse → label → re-analyse cycle proving labels survive.
- Fourteen deliberate mutations injected across the suites; every one
  failed the tests. Two initially survived and exposed genuinely weak
  assertions, which were tightened.
- `/dev/ai-dataset` returns HTTP 200 and renders in the dev server.
- Typecheck at baseline (96 pre-existing errors, none in new files);
  production build clean.

**Not covered by any of the above:** Kotlin compilation, Room's
generated schema validation, the Capacitor plugin actually registering,
MediaStore writes, and every behaviour in sections A–H.
