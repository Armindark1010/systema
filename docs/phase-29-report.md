# Phase 29 — Experimental Music Semantic Analysis Provider

**Commit:** `3dbc601` · **Branch:** `arena/01a03aca-systema`
**Device verification: NOT VERIFIED.**
**Runtime: NOT IMPLEMENTED — no real prediction has ever been produced.**

Read the second and third lines before anything else. Everything below
describes a pipeline that is complete from the provider contract through
to export, and that currently has no model behind it.

---

## 1. Model

Three classifier heads over one shared embedding model. No single model
covers all four requested fields, which is why the design has a shared
front-end and swappable heads.

| | Embedding | Mood/theme | Genre | Voice/instrumental |
|---|---|---|---|---|
| Name | `discogs-effnet-bs64` | `mtg_jamendo_moodtheme-discogs-effnet` | `mtg_jamendo_genre-discogs-effnet` | `voice_instrumental-discogs-effnet` |
| Version | 1 (2022-02-17) | 1 | 1 | 2 (file named `-1`) |
| Framework | TF 2.8.0 | TF | TF | TF 2.4.0 |
| Formats | frozen, SavedModel, **ONNX** | frozen | frozen | frozen |
| Input | mel `[64,128,96]` | `[1280]` embedding | `[1280]` | `[1280]` |
| Output | `[64,1280]` embed + `[64,400]` styles | 56 sigmoid | 87 sigmoid | 2 softmax |
| Sample rate | 16 kHz | — | — | — |
| Published metric | ROC-AUC 0.954 / PR-AUC 0.206 | **PR-AUC 0.14** | — | acc. 0.96 |

**Source:** Essentia models, MTG-UPF (`essentia.upf.edu/models`).
**Licence: CC BY-NC-SA 4.0 — non-commercial.** This blocks commercial
release, not experimentation, and is recorded in code as
`MODEL_LICENSE.commercialUseAllowed === false`.

**Supported fields:** mood (56 labels), genre (87), vocal/instrumental (2).
**Not supported:** language, danceability, acousticness, context
suitability — no model in the chain predicts them, so they stay
`unsupported`.

**`top50tags` is deliberately disabled.** Its 50 label strings could not
be retrieved. Real scores attached to invented label names would be
worse than no head at all, so `labelsUnavailable: true` keeps it out of
`usableTaxonomies()` and `zipPredictions` refuses it. Three separate
tests assert no labels were invented.

**PR-AUC 0.14 on the mood head is weak** and is surfaced in the taxonomy
rather than buried. Gathering evidence about exactly this is the point
of the phase.

---

## 2. Architecture

```
Audio (content:// URI)
   │
   ▼
MusicSemanticAnalysisProvider          ← generic contract, names no vendor
   │  createMusicSemanticProvider()    ← registry, mirrors the CLAP provider
   ▼
semanticRuntime                        ← the ONLY model-aware boundary
   │  runEmbedding → 1280-d            ← returns PROVIDER_NOT_READY today
   │  runHead      → scores
   ▼
zipPredictions(taxonomy, scores)       ← refuses any length mismatch
   ▼
SemanticAnalysisResult                 ← complete ranked list, experimental: true
   │
   ├─► useTrackAiAnalysis.runSemantic  ← same Analyze press, after the embedding
   │        │
   │        ├─► PlayerAiAnalysis.vue   ← existing sheet, top-5 display slice
   │        └─► persistSemanticToDataset
   │                 │
   │                 ▼
   │            saveSemanticAnalysis   ← model region ONLY
   │                 │
   ▼                 ▼
cachedSemanticFor ◄─ DatasetRecord.semantic ──► Room semanticJson (v4)
   (the row IS the cache)      │
                               ├──► /dev/ai-dataset  (all classes + metrics)
                               └──► export           (prediction ∥ groundTruth)
```

`DatasetRecord.groundTruth` sits alongside `.semantic` and is reachable
only through `saveLabels()`. The two regions have no code path between
them.

---

## 3. Files changed

**New — provider (5)**

| File | Why |
|---|---|
| `music-semantics/types.ts` | Generic contract. Vendor names are a test failure here. |
| `music-semantics/index.ts` | `createMusicSemanticProvider()` + test override. |
| `providers/jamendoTaxonomy.ts` | The real label lists, verbatim and order-critical. |
| `providers/jamendoProvider.ts` | Binds taxonomy to runtime. |
| `providers/semanticRuntime.ts` | Isolated runtime boundary. Returns not-ready. |

**New — dataset (3):** `semanticRecord.ts` (stored shape + guards),
`semanticEvaluation.ts` (multi-label metrics, label mapping),
`semanticBridge.ts` (the only place `source: 'model'` is stamped).

**Modified — TypeScript (8):** `datasetRecord.ts` (schema 1→2),
`datasetService.ts` (`saveSemanticAnalysis`, carry-forward),
`bridgeMapping.ts`, `datasetExport.ts`, `useTrackAiAnalysis.ts`,
`useAiDataset.ts`, `PlayerAiAnalysis.vue`, `dev/ai-dataset.vue`,
`trackAnalysis.ts` (unsupported reasons + `handledBy`).

**Modified — Kotlin (4) + schema:** entity column, DB v4 + `MIGRATION_3_4`,
DAO bind, plugin passthrough, `schemas/…/4.json`.

**`FullPlayer.vue` — 3 computeds and 3 prop bindings, additive only, left
uncommitted.** It carries your uncommitted drag-to-minimize work; I never
staged or reverted it.

---

## 4. Tests

| | Result |
|---|---|
| New: `test-music-semantics.ts` | **243 passed, 0 failed** |
| New: `test-music-semantics-mutation.ts` | **19/19 sabotages caught** |
| Full sweep, all 46 suites | **5307 passed, 4 failed** |
| Typecheck | **98 errors = unchanged baseline** |
| DSP / inference shells | skip honestly (no Android SDK here) |
| Gradle build | **not run** — no Android SDK in this environment |

**The 4 failures are pre-existing** in `test-audio-experience` (1) and
`test-background-playback` (3). I verified this by stashing all my work
and re-running: identical failures. They concern media-session callbacks
and notification building, from your own recent commits.

Mutations caught include: fabricated embedding, invented labels,
prediction stamped human, prediction overwriting ground truth,
re-analysis wiping predictions, top-1-only storage, dropped model
version, out-of-range scores, length-mismatch zipping, reversed
voice/instrumental order, accuracy on multi-label, metrics from too
little data, cache ignoring version, vendor leak, weakened
`experimental`, destructive migration, label overwrite in SQL, and
export merging the two regions.

**Four Phase 28 guards had to be rewritten**, because they asserted
proxies this phase legitimately invalidated. I sharpened rather than
relaxed each one:

- *"schema version is still 2"* → Phase 13's entities still registered,
  no destructive migration, no `DROP` on its tables. It was already
  failing before I started (Phase 28 moved it to 3).
- *"the export holds no predictions"* → now false by design; replaced by
  assertions that the notice distinguishes the two regions.
- *"no threshold is introduced"* → now enumerates threshold identifiers
  and forbids production/similarity ones specifically.
- *v3 column parity* → parity against create + ALTERs, so the v3
  statement can keep describing v3 forever.

---

## 5. Device verification — NOT VERIFIED

Nothing here has run on a phone. No APK was built. **The runtime returns
not-ready, so even a successful install would show the explanatory note,
not predictions.** Steps 4–9 cannot pass until weights and a mel
front-end exist.

1. `npx nuxt build && npx cap sync android`
2. `cd android && ./gradlew assembleDebug`
3. `adb install -r app/build/outputs/apk/debug/app-debug.apk`
4. Open a track in the Full Player; confirm playback is unaffected.
5. Press **Analyze**; confirm the existing embedding result still appears.
6. Confirm the **SEMANTIC** block appears with the `EXPERIMENTAL` tag.
7. **Expected today:** the explanatory note, no predictions, no error state.
8. *(needs runtime)* Confirm mood/genre/vocal each show labels with scores.
9. *(needs runtime)* Confirm the model name, version and inference ms are shown.
10. Close and reopen the Full Player; confirm the result persists.
11. Press **Analyze** again; confirm "saved result" (cache hit, no re-inference).
12. Press **RE-RUN**; confirm inference actually re-runs.
13. Open `/dev/ai-dataset`; confirm the row shows a **Predicted (model)** value.
14. Open the row detail; confirm the **complete** class list under "Raw output".
15. Add human mood + vocal labels; confirm the prediction is unchanged.
16. Confirm evaluation reads `Not enough labelled data` below 10 rows.
17. Export → uninstall → reinstall → re-import; confirm `prediction` and
    `groundTruth` are both restored and still separate.

An upgrade check worth doing before step 3: install the **previous**
build, add labels, then install this one and confirm they survive. The
v3→v4 migration is proven against real SQLite in
`test-ai-dataset-migration.ts`, but that is not a device.

---

## 6. Production safety

- No change to playback, queue, playlists, recommendations, search
  ranking or automatic selection. `player.ts` is asserted to contain no
  reference to semantics.
- Every result carries `experimental: true` as a literal type; weakening
  it to `boolean` is a caught mutation.
- No production threshold or production model selection was introduced.
  The one threshold added is the sigmoid cutoff for evaluation display.
- No context-suitability claim. "Good for driving" remains unsupported,
  and inferring it from a predicted mood is explicitly listed as
  fabrication in `UNSUPPORTED_SEMANTICS`.
- No fabrication path exists: no BPM→mood, key→mood, loudness→happy,
  filename→mood, artist→language, or CLAP→genre. Asserted per-file
  across eight files.
- No Python runtime, no server, no second database. Conversion tooling
  stays outside the app and is documented, not shipped.
- Export keeps the existing shared-storage strategy.

---

## 7. What remains

1. **Obtain the weights.** Every download from `essentia.upf.edu`
   returned HTTP 000 from this sandbox; only JSON metadata resolved. The
   paths are correct — the network is the blocker.
2. **Convert the three heads to ONNX** (`tf2onnx`, commands in
   `phase-29-semantic-model.md`). The embedding model already publishes
   ONNX.
3. **Implement the mel front-end.** The largest remaining piece: the
   embedding takes `[64,128,96]` mel patches, not audio, and nothing in
   SYSTEMA produces them today.
4. **Wire `semanticRuntime` to `InferenceRuntime.kt`**, the existing
   ONNX boundary.
5. **Retrieve the `top50tags` label list** before that head is enabled.
6. **Then collect real predictions and evaluate** — the actual goal.
   Given PR-AUC 0.14, the honest expected outcome is that the mood head
   may not be worth keeping. The pipeline is built to answer that with
   evidence rather than assumption.
