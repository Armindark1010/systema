# Phase 16 — Audio Embedding Model Evaluation

**Status: BENCHMARK MODE. NO PRODUCTION MODEL SELECTED.**

This document records what was researched, what was built, and — most
importantly — what could **not** be established. Phase 16 was asked to answer
which embedding model gives the best trade-off on the real device. It cannot
answer that yet, and this document says so rather than filling the gap with
plausible numbers.

---

## 0. Two corrections to the phase premise

Both were found before any code was written, and both change what the phase
can honestly deliver.

### 0.1 The "Native Memory Lifecycle Test" did not exist

The brief asked to *preserve* a Native Memory Lifecycle Test said to have been
added to the ONNX Runtime Lab. **No such test existed.** A search across every
`.kt`, `.ts` and `.vue` file for `memoryLifecycle`, `MemoryLifecycle`,
`nativeMemory`, `baselineMemory` and `postUnload` returned nothing; the only
matches for "memory" inside `inference/` were explanatory comments.

The Phase 15 report was accurate on this point — it recorded native memory
release as **code-verified only**, never instrumented. So there was nothing to
preserve.

**It has therefore been built from scratch in this phase.** The report says
*built*, not *preserved*.

### 0.2 No candidate model can be obtained in this environment

Every model host is network-blocked from the build environment:

| Host | Reachable |
|---|---|
| `huggingface.co` | BLOCKED |
| `tfhub.dev` | BLOCKED |
| `storage.googleapis.com` | BLOCKED |
| `raw.githubusercontent.com` | BLOCKED |

No candidate can be downloaded, converted, or executed here. Consequently
**every latency, memory, thermal and quality figure for every candidate is
`UNKNOWN` / `NOT VERIFIED ON HARDWARE`**, and no amount of engineering in this
phase can change that. What Phase 16 delivers instead is the harness, the
adapter contract, and a researched candidate matrix with the missing evidence
named explicitly.

---

## 1. Candidate matrix

All figures below are **quoted from published papers and repositories**. None
was measured by SYSTEMA. None of these models has run on the target device.

| Candidate | Size (published) | Input | Embedding dim | Preprocessing | Licence | Cold load | Warm inference | RAM | Thermal | Device verified |
|---|---|---|---|---|---|---|---|---|---|---|
| **YAMNet** (MobileNetV1) | ~15 MB | 16 kHz mono | 1024 | Raw waveform — log-mel front end **inside the ONNX graph** | Apache-2.0 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **NO** |
| **VGGish** | ~280 MB | 16 kHz mono | 128 | External 96×64 log-mel patch | Apache-2.0 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **NO** |
| **OpenL3** (music, mel128) | ~45 MB | 48 kHz mono | 512 / 6144 | External mel128 | MIT (code) / **CC BY 4.0 (weights)** | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **NO** |
| **PANNs CNN14** | ~300 MB | 32 kHz mono | 2048 | External log-mel | Apache-2.0 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **NO** |
| **LAION-CLAP** (HTSAT-tiny + RoBERTa) | ~620 MB | 48 kHz mono | 512 | External log-mel | Apache-2.0 code; **per-checkpoint terms vary** | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **NO** |

### Status and reasons

| Candidate | Status | Reason |
|---|---|---|
| YAMNet | **RUNNABLE** | Apache-2.0, ~3.7 M params, and the common ONNX exports accept a dynamic raw 16 kHz mono waveform with the mel front end inside the graph — so no external filterbank has to be matched. |
| VGGish | **BLOCKED — preprocessing** | Needs an externally computed 96×64 log-mel patch. 128 dimensions is also weak for music similarity, and ~280 MB is a poor return on that. |
| OpenL3 | **BLOCKED — preprocessing** | Needs an external mel128 front end at 48 kHz matched to training. Highest published timbral accuracy of the set, but also the worst under noise, and the CC BY 4.0 weights carry an in-app attribution obligation. |
| PANNs CNN14 | **BLOCKED — preprocessing** | External log-mel, ~80 M params, ~300 MB. Published Raspberry Pi measurements show CNN14 reaching ~85 °C thermal limits — a bad shape for a handset. CNN6/CNN10 would be the variants to revisit. |
| LAION-CLAP | **BLOCKED — preprocessing** | ~155 M params and ~111 GFLOPs/sample across two towers. Attractive because it enables text-to-audio search, but far too heavy for per-track on-device work, its ONNX export is non-trivial, and checkpoint licensing is ambiguous. |

### The YAMNet preprocessing hazard

This is the single most dangerous detail in the phase.

YAMNet's official front end lives **inside the TensorFlow graph**, and at least
one community ONNX export preserves that: its input is a raw
`waveform f32 [-1]` and its outputs include the computed log-mel itself. Other
exports strip the front end and expect a 96×64 patch.

**The correct preprocessing therefore depends entirely on which export is
used.** Feeding a pre-computed log-mel to an in-graph-front-end model — or raw
PCM to a mel-input model — produces numerically plausible embeddings that are
meaningless. Neither failure is visible by inspecting the output.

Per the phase's own rule, this must **fail loudly**, not be guessed. The
adapter refuses any candidate declaring a mel input until a verified front end
exists.

For the record, YAMNet's exact published spec, should an external front end
ever be built: 16 kHz mono, STFT with a 400-sample periodic Hann window,
160-sample hop, 512-point DFT, 64 mel bins spanning 125–7500 Hz,
`log(mel + 0.001)`, assembled into 96 × 64 patches (0.96 s).

---

## 2. What was built

### 2.1 The adapter layer

```
InferenceBenchmark
  → InferenceRuntime            (stable contract)
    → OnnxInferenceRuntime      (generic: loads a graph, feeds a tensor)
      → CandidateModelAdapter   (model-specific contract, as DATA)
        → Preprocessing
          → ONNX model
```

`OnnxInferenceRuntime` stays generic. The moment it knows YAMNet wants 16 kHz,
it stops being a runtime and becomes a YAMNet driver — so each candidate
declares its contract as data in `CandidateModelAdapter.kt`, and a test asserts
that no candidate's name appears anywhere in the runtime.

`validate()` is the gate. A candidate that is licence-blocked, ONNX-blocked, or
whose preprocessing SYSTEMA cannot reproduce exactly throws rather than runs,
and `toDescriptor()` calls `validate()` first so a blocked candidate cannot even
be converted into something the runtime would accept.

### 2.2 The native memory lifecycle test

`MemoryProbe.kt` + `InferenceBenchmark.runMemoryLifecycle()`.

Per cycle: **load → infer ×N → unload**, with memory sampled at every boundary,
repeated for 3–50 cycles.

Design decisions, and why:

- **Total PSS is the headline.** ONNX Runtime allocates natively.
  `Runtime.getRuntime().totalMemory()` would report almost nothing while a
  300 MB model sat resident, so the Java heap is recorded only to demonstrate
  the model is *not* there.
- **`-1` means UNKNOWN, never `0`.** `capture()` cannot throw; a failed read
  degrades rather than aborting a benchmark, and the UI renders it as
  `UNKNOWN`.
- **Repeated cycles, because one proves nothing.** PSS is an OS estimate over
  shared and lazily reclaimed pages; a few MB of drift is normal. Only a trend
  carries information.
- **The verdict enum has no `NO_LEAK` value.** The available verdicts are
  `STABLE`, `GROWING`, `INCONCLUSIVE`. A test can show memory returning to
  baseline across the cycles it ran; it cannot prove a negative. `STABLE` is
  the strongest honest claim, and the UI states that alongside the result.
- **`GROWING` requires both a majority of rising steps and an 8 MB climb.**
  Calling normal PSS jitter a leak would send someone hunting a bug that
  isn't there.
- **Fewer than 3 cycles is `INCONCLUSIVE`,** and the service refuses to run
  fewer than 3.

This closes the outstanding Phase 15 item — "unload releases native memory" was
**ANDROID CODE VERIFIED** only. It is now *measurable*. It has **not yet been
measured on the device**; the harness exists, the run does not.

### 2.3 Latency as a distribution

`LatencyStats` reports count, min, median, p95, max and mean. A bare mean is
the least informative number available on a phone: one thermal stall skews it,
one lucky run flatters it. p95 uses nearest-rank, so `count` travels with it —
with 10 samples the p95 *is* the maximum, and nobody should quote it as stable.

### 2.4 UI

`Settings → AI Benchmark Lab → Candidate lab`
(`/dev/ai-benchmark/candidates`), labelled **"Developer Diagnostic — Not a
Production Feature"**. Not reachable from Home, Library, Player, Search or any
normal navigation. Nothing on the page runs automatically; the memory test is
bound to an explicit click.

### 2.5 In-app model import (Phase 16.1)

adb is not always available, so a model can be supplied from the phone itself.

**Flow:** `IMPORT ONNX MODEL` → `ACTION_OPEN_DOCUMENT` → user taps one file →
copied to a `.part` staging file in the **existing** models directory →
validated → promoted → registered → appears in the existing model selector.

The architecture is unchanged. The destination is the same
`getExternalFilesDir()/models` that adb pushes to, the model is consumed by the
same `OnnxInferenceRuntime`, and no second inference path or JavaScript runtime
was added.

**Validation is two-stage, and only the second stage is authoritative:**

1. A byte-level sniff rejects obvious impostors (renamed `.mp3`, `.zip`,
   `.json`, `.wav`, PDFs, text). This is a *reject filter only* — passing it
   proves nothing.
2. The file is genuinely loaded through `OnnxInferenceRuntime`. If ONNX Runtime
   will not build a session, the staging file is deleted and nothing is
   registered.

A corrupted model passes stage 1 and is caught by stage 2. That is exactly why
stage 2 exists, and it is verified in `scripts/verify-import-validation.py`.

**Metadata is read, not guessed.** Input/output names, shapes and types come
from `OrtSession`, surfaced through the new `TensorSignature` on
`LoadedModelInfo`. A dynamic trailing dimension yields `null`, not an invented
embedding width. The filename is never used to infer identity — a file called
`yamnet.onnx` is not evidence that it is YAMNet.

**Sample rate and preprocessing are not in an ONNX graph**, so they are
recorded as `UNKNOWN` at import. Until a developer declares them, benchmarking
that model against real audio fails with the new
**`PREPROCESSING_UNAVAILABLE`** error code, checked in
`ModelRegistry.requireAudioContract()` before a single track is decoded.

This is what stops YAMNet being benchmarked against the decoder's 22.05 kHz
when its contract requires 16 kHz. An undeclared model now falls back to
`RAW_TENSOR` — which the audio path refuses — rather than the old
`RAW_WAVEFORM` default, which would have run happily on the wrong input.

Declaring a mel or log-mel format records the model as **BLOCKED**, not
verified: saying a model needs a mel front end does not make one exist.

---

## 3. Verification status

| Claim | Status |
|---|---|
| Adapter refuses blocked candidates | CODE VERIFIED + TEST PASSED |
| Preprocessing is refused, not approximated | CODE VERIFIED + TEST PASSED |
| Memory test cannot claim "no leak" | CODE VERIFIED + TEST PASSED |
| Memory test is manual only | CODE VERIFIED + TEST PASSED |
| Candidate matrix declares itself unmeasured | CODE VERIFIED + TEST PASSED |
| Memory lifecycle **runs on device** | **NOT VERIFIED ON HARDWARE** |
| Import: sniff + session-build logic discriminates | LOGIC VERIFIED (`scripts/verify-import-validation.py`, 20/20 against real ONNX Runtime) |
| Import: contract gate refuses undeclared models | CODE VERIFIED + TEST PASSED |
| Import: **file picker works on a device** | **NOT VERIFIED ON HARDWARE** |
| Import: **a real YAMNet .onnx was imported** | **NOT ATTEMPTED — weights unobtainable here** |
| Import: **YAMNet inference executed** | **NOT VERIFIED — never run** |
| Any candidate model loads | **NOT VERIFIED — weights unobtainable** |
| Any candidate latency / RAM / thermal figure | **NOT VERIFIED — nothing executed** |
| Embedding quality of any candidate | **NOT VERIFIED — nothing executed** |

Kotlin still cannot be compiled in this environment (no JDK is installable —
every JDK host fails TLS). Kotlin changes are validated by inspection plus the
static TypeScript audit, exactly as in Phase 15.

---

## 4. Recommendation

**NO PRODUCTION MODEL SELECTED.**

The evidence does not support choosing one, and choosing on published
specifications alone is precisely what this phase exists to prevent.

What the research *does* support is a **provisional ordering for the first
device test**, to be treated as a hypothesis:

1. **YAMNet first.** It is the only candidate that is simultaneously small
   (~15 MB), permissively licensed (Apache-2.0), and — in the right export —
   free of any preprocessing SYSTEMA would have to reproduce. 1024 dimensions
   is ample for track similarity.
2. **Low-complexity MobileNets** (arXiv 2303.01879) as the next avenue; `mn01`
   is reported comparable to OpenL3 and PANNs-CNN14 at a fraction of the MACs.
3. **OpenL3 only if** a mel128 front end is built *and verified against a
   reference implementation*, and the CC BY 4.0 attribution is honoured in-app.
4. **PANNs CNN14 and LAION-CLAP are not viable** for per-track work on this
   handset on size and compute grounds.

### Evidence required before any selection

- A YAMNet ONNX export whose input contract is *confirmed* — in-graph front end
  or not. This determines everything downstream.
- Cold load, first inference and warm inference (median/p95/min/max) on the
  Poco X7 Pro, screen ON, ≥20 iterations.
- The memory lifecycle test over ≥10 cycles with a real model resident.
- Sustained-load behaviour at 10/20/50 iterations with thermal state recorded.
- The deterministic embedding-quality sanity check — same-track similarity,
  cross-track distribution, loudness stability — explicitly an engineering
  sanity check, not a trained benchmark.

Until those exist, SYSTEMA stays in benchmark mode.

---

## 5. Output contract audit — explaining `out dim 208921`

A device run of an imported `yamnet.onnx` on the Xiaomi 2412DPC0AG reported
`out dim 208921`. This section explains that figure exactly and records what it
revealed.

### 5.1 The number

```
208921 = 401 × 521
```

401 and 521 are both prime, so this factorisation is **unique** — there is no
competing explanation. Of the three declared trailing dimensions, only 521
divides 208921 exactly:

| Trailing dim | 208921 ÷ dim | Remainder |
|---|---|---|
| **521** | **401** | **0 — exact** |
| 1024 | 204 | 25 |
| 64 | 3264 | 25 |

**401 is the frame count.** YAMNet frames at a 0.96 s window with a 0.48 s hop,
so 401 frames spans `(401−1) × 0.48 + 0.96 = 192.96 s`. The reported
`total 25058 ms ÷ rtf 0.130` implies ≈192.75 s — consistent, since an rtf
rounded to three decimals cannot resolve a single 0.48 s frame.

### 5.2 Output meanings

Read from the session, classified by shape:

| Output | Runtime shape | Elements | Meaning |
|---|---|---|---|
| `output_0` | `[401, 521]` | **208,921** | Per-frame **AudioSet class scores**. 521 is the published AudioSet ontology size. **Not an embedding.** |
| `output_1` | `[401, 1024]` | 410,624 | Per-frame **embeddings**. This is the tensor a similarity system needs. |
| `output_2` | `[19296, 64]` | 1,234,944 | **Log-mel spectrogram**, computed *inside* the graph. Its presence confirms the mel front end is in-graph, so raw-waveform input is correct. |

### 5.3 The code path

```
OnnxInferenceRuntime.infer()
  results = active.run(...)
  val first = results.get(0)          ← index 0 = output_0 = CLASS SCORES
  val flat  = flattenFloats(first)    ← [401,521] → FloatArray(208921)
InferenceBenchmark.measureOne()
  outputDimension = result.output.size ← 208921
onnx.vue
  "out dim {{ m.outputDimension }}"    ← displayed as if a dimension
```

### 5.4 The finding

**Worse than suspected.** The concern was that frame embeddings were being
flattened into one giant vector. In fact **the embeddings were never read at
all**. `results.get(0)` returns `output_0`, so the benchmark measured the
class-score tensor. The 1024-d embeddings in `output_1` were computed, thrown
away, and never appeared in any measurement.

The timings remain valid — the full graph ran, so inference cost is real. Only
the *output figure* was misattributed.

Two distinct defects:

1. **Wrong tensor selected.** `results.get(0)` is arbitrary for a multi-output
   graph.
2. **A flattened element count labelled as a dimension.** `out dim` scales with
   track length and ontology size; it never described embedding width.

### 5.5 What changed

Diagnostics only. **Output selection is deliberately unchanged** — switching
tensors would retroactively alter what previous measurements meant.

- `OutputContract.kt` — classifies each output by **shape**, never by model
  name. Unrecognised shapes are `UNKNOWN`, never defaulted to "embedding".
- `LoadedModelInfo`/`InferenceResult` carry all resolved output shapes plus the
  name and index of the tensor actually read.
- The UI label `out dim` is retired in favour of **`raw output elements`**, with
  an expandable `OUTPUT CONTRACT` panel and a banner when the read tensor is not
  the embedding.

### 5.6 Is track-level aggregation required?

**Yes — but not yet, and not silently.** The correct pipeline is:

```
audio → 16 kHz mono waveform → YAMNet → N × 1024 per-frame embeddings
      → pooling → ONE 1024-d track embedding
```

Aggregation is **not implemented** and was not implemented here; the audit only
makes its absence visible (`aggregationRequired: true`). Choosing a pooling
strategy — mean, max, or mean+std — is a decision with real consequences for
similarity quality and must be made deliberately, not as a side effect of an
audit.

### 5.7 Verification status

| Claim | Status |
|---|---|
| 208921 = 401 × 521, uniquely | **PROVEN** (closed-form arithmetic) |
| `results.get(0)` returns `output_0` | **PROVEN** (live ONNX Runtime, YAMNet-shaped stand-in) |
| Flattened `output_0` = 208921 for a 192.96 s track | **REPRODUCED EXACTLY** |
| Embeddings are `output_1`, unread | **PROVEN** |
| Shape-based classification is correct | **TEST PASSED** (23/23 + 73/73) |
| Diagnostics render on device | **NOT VERIFIED ON HARDWARE — retest required** |
| Kotlin compiles | **NOT VERIFIED — no JDK installable** |
| Real `yamnet.onnx` re-executed | **NO — model hosts unreachable here** |

---

## 6. Phase 16A — track-level aggregation

Section 5.6 said aggregation was required but not implemented. This section
records implementing it.

```
audio → YAMNet → output_1 [N, 1024] → pooling → [1024] → L2 norm → track embedding
```

### 6.1 The contract

| Stage | Value |
|---|---|
| input | `N × D` per-frame embeddings, float32, row-major |
| pooling | `MEAN` (default) or `MEAN_STD` |
| output | `D` for MEAN, **`2D` for MEAN_STD** |
| normalisation | L2, tolerance `1e-4` |
| zero input | all-zero vector, `degenerate = true`, **no epsilon** |
| NaN / Inf | **rejected before pooling**, with a count |
| shape mismatch | **rejected**, never reshaped |

`FrameEmbeddingAggregator` takes `N` and `D` as parameters and contains no
model name and no literal `1024`. It also imports nothing from Capacitor,
Android or ONNX — which is what makes the arithmetic executable on a plain JVM
instead of only reviewable in a diff. The bridge-facing glue lives separately in
`FrameEmbeddingBridge.kt`.

### 6.2 Which tensor, and what happens when it is absent

The embedding is located by **shape**, through `OutputContract.classify`, and
accepted only for the roles `FRAME_EMBEDDINGS` or `SINGLE_EMBEDDING`. The model
name is never consulted: a file called `yamnet.onnx` may contain any graph, and
name-based identification is how the original defect became possible.

If no output classifies as an embedding, the run records an
`aggregationError` and produces **no** track embedding. It does **not** fall
back to `output_0`. Pooling 521-wide AudioSet class scores would yield a
well-formed, confident, meaningless 1024-d vector — the failure mode that is
hardest to detect downstream.

A failed aggregation does **not** fail the track. The decode, preprocessing and
inference timings are still valid measurements of the model, so they are kept
and the reason for the missing embedding is reported alongside them.

### 6.3 Timings

Aggregation runs **after** `infer()` returns, outside every pre-existing timing
boundary.

| Timing | Meaning | Changed? |
|---|---|---|
| `decodeMs` | PCM decode | unchanged |
| `preprocessingMs` | resample / normalise | unchanged |
| `inferenceMs` | `session.run()` alone | unchanged |
| `tensorMs` | tensor construction | unchanged |
| `totalMs` | the four above, same formula | unchanged |
| **`aggregationMs`** | pooling + L2 normalisation | **new** |

`aggregationMs` is reported but **deliberately excluded from `totalMs`**, so
numbers measured before aggregation existed remain directly comparable. No
previous measurement is retroactively reinterpreted.

### 6.4 MEAN_STD is not the baseline

`MEAN_STD` concatenates the mean with the population standard deviation, so a
1024-wide input produces a **2048-wide** output. That is stated in the enum, in
the aggregator, in the JSON payload and in the UI. A 2048-d vector cannot be
compared against a 1024-d one, and quietly changing the width would silently
invalidate anything built on the earlier contract.

Population (`N`), not sample (`N−1`): this describes the frames of *this* track,
not an estimate of a wider population. A single frame therefore has a deviation
of exactly zero rather than a divide-by-zero NaN. Variance uses the two-pass
form; the one-pass shortcut cancels catastrophically when the mean is large
relative to the spread, which is a real risk for embedding activations.

### 6.5 Why a zero vector stays zero

A zero vector has no direction, so it has no unit form. Three options exist and
only one is honest:

| Option | Result |
|---|---|
| divide anyway | `NaN`, silently corrupting everything downstream |
| add an epsilon | a near-zero vector that *looks* normalised but is not |
| return zeros | stays zero, and the caller is told |

The aggregator returns the zero vector unchanged and sets `degenerate = true`.
**No epsilon is added anywhere.** Such a vector must not be used for similarity:
cosine against it is *undefined*, not "zero similarity".

### 6.6 Memory

Mean pooling allocates exactly one `DoubleArray(D)` accumulator and one
`FloatArray(D)` output, and walks the input once. The `N × 1024` tensor is never
duplicated. When the embedding happens to be output index 0, the already-read
buffer is reused rather than copying ~1.6 MB a second time. The embedding is
read inside the scope that closes the ONNX result, so no native buffer, tensor
or session outlives the run.

### 6.7 Verification status

| Claim | Status |
|---|---|
| Aggregation arithmetic is correct | **TEST PASSED** — 97/97, executed on a JVM |
| `[[1,2],[3,4]] → [2,3]` | **TEST PASSED** (hand-checkable) |
| `[[3,4]] → [3,4] → [0.6,0.8]` | **TEST PASSED** (hand-checkable) |
| L2 norm ≈ 1 at D = 2/64/512/1024 | **TEST PASSED** |
| Bit-identical across repeated runs | **TEST PASSED** |
| `2 × 1024` and `401 × 1024` both → 1024 | **TEST PASSED** |
| Zero vector gives zeros, never NaN | **TEST PASSED** |
| NaN / +Inf / −Inf rejected pre-pooling | **TEST PASSED** |
| A `[401,521]` buffer claimed as `[401,1024]` is rejected | **TEST PASSED** |
| CLASS_SCORES / FRAME_EMBEDDINGS / TRACK_EMBEDDING are distinct | **TEST PASSED** (integration) |
| Wiring: tensor choice, timings, labelling | **TEST PASSED** — 111/111, static audit |
| Phase 15 contract suite still passes | **TEST PASSED** — 67/67 |
| Whole repo suite | **TEST PASSED** — 823 assertions, 0 failed |
| Nuxt build / static generate / `cap sync` | **PASSED** |
| Kotlin type-checks against stub Android+ONNX APIs | **PASSED** (local shims, *not* a Gradle build) |
| **Android app compiles via Gradle** | **NOT RUN** — no Android SDK here |
| **Runs on a device** | **NOT VERIFIED — no hardware run performed** |
| **Embedding quality** | **NOT EVALUATED** |
| **Production model** | **NOT SELECTED** |

Mean pooling is the **baseline**. Nothing here shows it is the best pooling for
music similarity, and no claim to that effect is made.

### 6.8 Manual device verification

Not yet performed. To perform it:

1. Build and install the debug APK (`./gradlew :app:installDebug`).
2. Settings → **AI BENCHMARK LAB** → **ONNX RUNTIME LAB**.
3. Import `yamnet.onnx` via the in-app importer (Phase 16.1).
4. Select **one** track and run it.
5. Expand **OUTPUT CONTRACT** and confirm:
   - `output_1` is `[N, 1024]`, role `FRAME_EMBEDDINGS`;
   - `output_0` is `[N, 521]`, role `CLASS_SCORES`, and is the *selected* output;
   - the raw element count is labelled a **flattened count**, not a dimension.
6. In the **TRACK EMBEDDING** block, confirm:
   - aggregation = `MEAN`;
   - frame embedding `N × 1024` → track embedding **1024**;
   - normalization = `L2`, unit length = **YES**;
   - the preview contains no `NaN` or `Infinity`;
   - `aggregation time` is present and small relative to `inferenceMs`.
7. Confirm `inferenceMs`, `totalMs` and `rtf` are of the same order as the
   pre-aggregation run — aggregation must not have moved them.

Record the numbers. One run is a measurement, not a performance result.
