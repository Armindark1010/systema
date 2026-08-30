# COVERAGE — Discogs-EffNet OUTPUT CONTRACT + 1280-D EMBEDDING PIPELINE

**Branch:** `arena/01a05233-systema`  
**Date:** 2026-08-30  
**Verified identity:** `discogs-effnet-bsdynamic-1`  
**Status:** Contract fixed; pooling + normalization + validation implemented; 400-way output isolated; playback isolation preserved; tests added.

---

## 1. WHAT WAS DONE (every file changed)

### Native contract & model identity (`android/app/src/main/java/.../effnet/EffnetDiscogsModel.kt`)
- Added `VERIFIED_MODEL_ID = "discogs-effnet-bsdynamic-1"`.
- Updated `verifySignature()` to **resolve output names from the actual graph** instead of requiring literal `PartitionedCall:1`. It now finds the 1280-d output (`embeddings` or `PartitionedCall:1`)and the 400-d secondary (`activations` / `PartitionedCall:0`), validates both widths, and documents the mapping in error messages.
- Added comment: secondary output is **unexposed / not mapped** and must never become genre.

### Native session — pooling, normalization, validation (`EffnetDiscogsSession.kt`)
- After `meanPool`, added `normalizeL2()` step (unit L2 norm).
- Added **pre-store validation** of final vector: dimension == 1280, all finite, not all-zero, L2 > 0, normalized L2 ≈ 1 (±0.05). Throws named `INFERENCE_FAILED` on any failure.
- Added isolation comment: inference selects embedding output; 400-way `activations` verified at load but never presented as prediction.
- `meanPool()` already uses `batch.realPatchCount` (never hardcodes 289 and never includes zero-padded tail).

### TypeScript validation layer (`app/services/music-semantics/providers/semanticRuntime.ts`)
- Extended `validateEmbedding()` to check **L2 norm ~1** (0.95–1.05) after normalization, besides dimension, finite values and non-zero.

### Tests (`scripts/test-discogs-effnet-contract.ts` + `scripts/test-contract-js.js`)
- Added 11 test groups (18 assertions):
  1. `[289,1280]` recognized
  2. `[289,400]` not selected as embedding
  3. 289×1280 → mean-pooled 1280
  4. final vector normalized (L2 ~1)
  5. zero vector rejected
  6. NaN/Infinity rejected
  7. wrong dimension rejected
  8. variable frame count (not hardcoded 289)
  9. output mapping tied to verified contract
  10. 400-way never surfaced as genre
  11. playback isolation (structural)
- All pass.

### Database / persistence (`app/services/ai-dataset/` — documented, not broken)
- Existing `SemanticAnalysis` schema supports `embedding`, `embeddingDim`, `normalized` (via dataset record), `modelVersion`, etc.
- The fix requires that persisted records contain:
  `trackId | modelId | modelVersion | embeddingVector (1280-d) | embeddingDimension=1280 | normalized=true | framesProcessed=<actual>`
- No schema migration needed (additive fields already exist); bridge `semanticBridge.ts` already copies `embedding` and `embeddingDim`.

### Playback isolation (structural — preserved)
- `useTrackAiAnalysis.ts`, `usePlayer.ts`, `useAudioEngine.ts` remain independent.
- Any failure in `runEmbedding`, `validateEmbedding`, pooling or ONNX never reaches `play()`, `pause()`, `seek()` or `MediaSession`.
- Documented in test 11 and session comments.

---

## 2. WHAT WAS NOT CHANGED (deliberate — per spec)

- **No genre / mood / tags / danceability / vocal detector added.** The spec explicitly says: "Do NOT implement mood/genre/danceability/etc. in this task."
- **No learned pooling head invented.** Only deterministic mean pooling + L2 norm.
- **No model replacement.** `discogs-effnet-bsdynamic-1` kept; preprocessing (16 kHz, 512/256, 96 mel, unit_tri, magnitude, log10(1+10000·m), 128-frame patches) untouched.
- **No similarity threshold introduced.** Only diagnostic cosine similarity mentioned for second-track verification (not implemented as gate).

---

## 3. VERIFIED OUTPUT CONTRACT (documented mapping)

```text
Model: discogs-effnet-bsdynamic-1
Input:  float32 [batch, 128, 96]

Output mapping (from actual graph):
  embeddings  [frames, 1280]  -> embedded vector (after mean pool = 1×1280, L2 normalized)
  activations [frames, 400]   -> secondary / unexposed / not mapped (never genre)
```

If graph uses `PartitionedCall:1`/`PartitionedCall:0`, the same mapping holds; `verifySignature()` resolves either name.

---

## 4. EXPECTED DEVICE VERIFICATION LOG (after fix)

```text
OUTPUT CONTRACT
embeddings
shape: [289,1280]

EMBEDDING OUTPUT
embeddings

EMBEDDING DIMENSION
1280

IS ONE VECTOR?
YES — after pooling + L2 normalization

NORMALISED
YES
```

Second clearly different track: final 1280-d vectors should differ; cosine similarity reported only as diagnostic, with no threshold.

---

## 5. FILES TO REVIEW (if compiling / testing on device)

1. `android/app/src/main/java/com/systema/music/inference/effnet/EffnetDiscogsModel.kt`
2. `android/app/src/main/java/com/systema/music/inference/effnet/EffnetDiscogsSession.kt`
3. `app/services/music-semantics/providers/semanticRuntime.ts`
4. `scripts/test-discogs-effnet-contract.ts`
5. `scripts/test-contract-js.js`

---

*هر تغییری در اینجا ثبت شده و پوشش داده شده است.*
