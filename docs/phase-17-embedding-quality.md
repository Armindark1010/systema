# Phase 17 — Embedding Quality Lab

Phase 16A produced a 1024-d L2-normalised vector per track and stopped there,
recording the status as *"quality not yet evaluated"*. This phase builds the
instrument that can evaluate it.

It does **not** report a result. Running it on real hardware does.

```
audio → YAMNet → output_1 [N,1024] → MEAN → [1024] → L2 → cosine similarity
```

---

## 1. What was built

| File | Role |
|---|---|
| `EmbeddingSimilarity.kt` | **NEW** — cosine, pairwise sets, neighbours, statistics. Pure arithmetic, no Android. |
| `EmbeddingQualityLab.kt` | **NEW** — the incremental evaluation loop, cancellation, memory discipline, reporting. |
| `SimilarityTest.kt` | **NEW** — 137 executed JVM assertions. |
| `test-quality-lab.ts` | **NEW** — 182 wiring + behavioural assertions. |
| `quality.vue` | **NEW** — the live diagnostic UI. |
| `InferencePlugin.kt` | 3 new methods + 4 events. Reuses the benchmark's runtime registry. |
| `inferencePlugin.ts` / `inferenceService.ts` | Types, event subscription, display helpers. |
| `index.vue` | Entry point card. |
| `run-inference-tests.sh` | Compiles and runs the new Kotlin suite. |

Nothing in the Phase 16A pipeline was modified. `FrameEmbeddingAggregator` is
called, not changed.

---

## 2. The incremental contract

The requirement that shaped the whole design: **results must appear as they
happen**, not in one batch at the end.

| Event | When | Carries |
|---|---|---|
| `qualityEvalStarted` | after the cold model load | total, model, strategy |
| `qualityEvalTrackStarted` | before each track | position, trackId, elapsed |
| `qualityEvalTrackCompleted` | **after each track** | the evaluation, live matrix, live stats, counts, memory |
| `qualityEvalFinished` | once, at the end | the full report |

`runQualityEvaluation` resolves as soon as the run is *accepted*. Holding a
bridge promise open for a multi-minute run is precisely what would produce a
blank screen. This mirrors `MusicLibraryPlugin.scan`, a pattern already in the
codebase.

Track *N*'s result is emitted **before** track *N+1* starts — asserted
behaviourally, not just structurally (suite §17).

---

## 3. Which tensor, and what cannot happen

The embedding comes from `result.embeddingFrames`, populated by
`OnnxInferenceRuntime` by **shape** via `OutputContract`. Never `result.output`
(index 0 — for YAMNet the 521-wide class scores).

| Guard | Behaviour |
|---|---|
| no embedding output | `EMBEDDING_UNAVAILABLE`, **no fallback to output_0** |
| unresolved shape | `EMBEDDING_SHAPE_INVALID`, layout never guessed |
| zero-magnitude vector | `DEGENERATE_EMBEDDING`, excluded from the matrix |
| norm ≠ 1 ± 1e-4 | `NOT_UNIT_LENGTH`, **never silently renormalised** |
| width mismatch | rejected — including MEAN (1024) vs MEAN_STD (2048) |
| NaN / Inf | rejected before the dot product |

Cosine is a plain dot product **because** both vectors are verified unit
length. Dividing by measured norms instead would silently "work" on a broken
pipeline — and detecting that class of problem is the entire point of this
phase.

---

## 4. Statistics

Computed over the **N(N−1)/2 distinct off-diagonal pairs**. The diagonal is 1
by definition; including it would drag every mean toward 1.0 and make an
indifferent embedding space look excellent.

Reported: pair count, mean, median, min, max, range, population std dev,
p25/p75, and a 10-bucket histogram **fixed across [−1, 1]**.

The fixed buckets are deliberate. An auto-scaled histogram makes every
distribution look equally spread, disguising the single most important thing
this lab can reveal: embeddings crammed into a narrow band, where nothing is
distinguishable from anything.

Only successful embeddings enter the geometry. A failed track contributes
nothing and is never assigned a placeholder.

---

## 5. Labels

Optional, and **supplied by the developer only**. A pair is grouped when both
ends carry a label; cross-group pairs get their own combined key rather than
being dropped.

Labels are **never** derived from artist or genre metadata. Doing so would turn
a measurement of your tag quality into a claim about embedding quality — two
entirely different things.

With no labels the report states:

> **UNLABELED EVALUATION.** Similarity statistics describe embedding geometry
> only. They do not prove semantic music similarity quality.

---

## 6. The verdict field is a constant

`qualityConclusion` is always `INSUFFICIENT EVIDENCE`.

That is not a placeholder. No threshold on cosine statistics is defensible
without labelled ground truth at a scale this phase does not have, and a
threshold invented to fill the gap is exactly the confirmation bias the phase
exists to avoid. There is no GOOD branch and no BAD branch anywhere in the
code — asserted by test.

---

## 7. Cancellation and failure

**Stop** sets an atomic flag checked between tracks *and* inside the decode
callback, so a stop does not have to wait out a three-minute file. The loop
`break`s rather than returning, so the report — carrying every completed
result — is still built.

> EVALUATION STOPPED · Completed 7/20 · Failed 0 · Remaining 13

A failed track returns a failure row and the loop continues to the next track.
`TrackEvaluation.failed()` has no embedding parameter, so a failed track cannot
carry a vector *structurally*, not merely by convention.

---

## 8. Memory

Per track, everything large is local to `evaluateOne` and becomes garbage on
return. Decoded chunks are released immediately after concatenation, so the
peak holds one copy of the audio rather than two.

Retained across the run: one 1024-float vector (≈4 KB) and scalars per track.
A 20-track run therefore grows by ~80 KB of embeddings — not by 20 tracks of
decoded PCM, which at five minutes and 16 kHz would be ~19 MB each.

PSS is sampled before, during (peak) and after; the model is unloaded in a
`finally`.

---

## 9. Energy

```
ENERGY
Not directly measured
```

`energyMeasured` is `false`. Android exposes no per-process energy accounting
trustworthy over a short foreground run: `BatteryManager` counters are coarse,
device-dependent and dominated by the screen. An estimate presented as a
measurement would be worse than no number at all.

CPU time, memory and wall clock **are** measured, and the existing
`EnvironmentSnapshot` (screen state, thermal, charging, battery level) is
attached to every report — on this device the screen state alone was worth a
2.32× swing.

---

## 10. Verification status — four distinct states

| State | Status |
|---|---|
| **IMPLEMENTED** | ✅ Yes |
| **TESTED IN SANDBOX** | ✅ Yes — 2164 assertions, 0 failed |
| **DEVICE VERIFIED** | ❌ **No — not performed** |
| **QUALITY VERIFIED** | ❌ **No — requires a device run** |

Detail:

| Claim | Status |
|---|---|
| Cosine of identical / orthogonal / opposite vectors | **TEST PASSED** (executed on JVM) |
| Norm validation, dimension mismatch, NaN/Inf rejection | **TEST PASSED** |
| First track yields no comparison | **TEST PASSED** |
| Incremental emission, per-track | **TEST PASSED** (behavioural simulation) |
| Failure does not abort the batch | **TEST PASSED** |
| Cancellation preserves completed results | **TEST PASSED** |
| Matrix grows incrementally | **TEST PASSED** |
| No decoded audio retained between tracks | **TEST PASSED** (static) |
| Statistics from valid embeddings only | **TEST PASSED** |
| No fabricated quality score | **TEST PASSED** |
| Uses `output_1`, never `output_0` | **TEST PASSED** (wiring) |
| Kotlin type-checks vs. stub Android/ONNX/Capacitor APIs | **PASSED** (local shims, *not* Gradle) |
| Nuxt build / generate / `cap sync` | **PASSED** |
| Runtime id resolves (`onnxruntime`, not `onnx`) | **TEST PASSED** — see §13 |
| **Android Gradle compile** | **NOT RUN** — no Android SDK in the sandbox |
| **Real YAMNet execution** | **NOT PERFORMED** in this phase |
| **Embedding quality** | **UNKNOWN — that is what the lab is for** |
| **Production model** | **NOT SELECTED** |

---

## 11. Device verification steps

Not yet performed. To perform it:

1. Build and install: `./gradlew :app:installDebug`.
2. Settings → **AI BENCHMARK LAB** → **QUALITY LAB**.
3. **Step 1** — pick the imported `yamnet.onnx`. (Import it in the ONNX Runtime
   Lab first if the list is empty; the test model is deliberately excluded.)
4. **Step 2** — tick 8–20 tracks. Choose deliberately: include two tracks you
   consider genuinely similar and two you consider unrelated, so the numbers
   have something to disagree with. Optionally tap **ADD LABELS**.
5. Press **RUN EVALUATION**.
6. **While it runs**, confirm the incremental behaviour:
   - the counter advances `1/N`, `2/N`, …;
   - a result card appears after **each** track, not at the end;
   - the current track name and ⏳ state are visible;
   - the matrix appears from track 2 and grows;
   - elapsed time ticks.
7. Per completed track, confirm: `1024 dimensions`, `norm 1.0000` in green,
   frames shown as `N × 1024`, no `NaN`, and **track 1 says
   "No comparison available — first embedding."**
8. Press **STOP EVALUATION** mid-run once. Confirm completed results survive
   and the summary reports completed/failed/remaining honestly.
9. Re-run to completion and record: median inference, median total, median RTF,
   memory before/peak/after, and the pairwise mean/median/min/max.
10. Sanity-check the geometry: do tracks you consider similar actually score
    higher than tracks you consider unrelated? **That comparison is the real
    result of this phase**, and it cannot be obtained from the sandbox.

Record the numbers. One run is a measurement, not a conclusion.

---

## 12. What this phase deliberately did not do

No production model selected. No embedding database, no library scan, no
background analysis, no semantic search, no recommendations. The aggregation
pipeline is unchanged. The evaluation is capped at 20 explicitly chosen tracks
so it can never become a library-wide sweep.

---

## 13. Postscript — the runtime identifier bug

The first device run of this lab never reached a track:

```
EVALUATION ERROR
Unknown runtime 'onnx'. Available: onnxruntime, reference
```

**Root cause.** `quality.vue` hardcoded `runtimeId: 'onnx'`. The Kotlin
registry is keyed by each runtime's own `runtimeId`, which is
`"onnxruntime"`, so the lookup missed and the run was rejected before the
model was even loaded. Nothing downstream was wrong: preprocessing,
`output_1` selection, aggregation and cosine were never reached.

**Fix.** One line — the page now sends `RUNTIME_ONNX`, the constant already
shared with Kotlin's `RuntimeIds.ONNX`. No new runtime was created, the
registry was not widened, and `reference` is untouched.

**Why it escaped review.** `runQualityEvaluation` is typed
`runtimeId: RuntimeId`, a union of the two constants, so `'onnx'` *is* a
type error — but nothing was type-checking it. `nuxt.config.ts` sets
`typeCheck: false`, `nuxt build` does not check types, and `vue-tsc` was not
installed, so **no tool in the repo type-checked a single `.vue` file.**
The previous phase's claim that `npm run build` acts as a type-check was
wrong, and this bug is what that error cost.

`vue-tsc` is now a dev dependency with an `npm run typecheck` script. With
it, the bug is caught precisely:

```
app/pages/dev/ai-benchmark/quality.vue(237,7):
  error TS2322: Type '"onnx"' is not assignable to type 'RuntimeId'.
```

It is deliberately **not** part of `npm test` yet: the repo has ~94
pre-existing type errors in older components, and wiring it in now would
turn the suite red for reasons unrelated to any current change. Clearing
those is its own task.

**This is the second desynchronisation of this identifier.** Phase 15 hit
the mirror image — the registry said `"onnx"` while callers said
`"onnxruntime"`. That fix guarded the registry and `onnx.vue`; Phase 17 then
added a *new* caller that no guard covered. The new assertions
(`test-quality-lab.ts` §23) therefore check **every** `.vue` page in
`app/pages/dev/ai-benchmark/` for a bare `'onnx'` literal, rather than one
file by name, and simulate the registry lookup end to end — including that
genuinely unknown ids (`'onnx'`, `'tflite'`, `''`) still fail, and that
resolution is exact-match so a prefix cannot silently succeed.

**Device verification is still required.** Fixing the identifier only means
the run can now *start*. Nothing about embedding quality is known.
