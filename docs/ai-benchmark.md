# SYSTEMA — AI Model Benchmarking & Analysis Lab (Phase 14)

**Status:** research instrument. Not a production feature.
**Route:** `/dev/ai-benchmark` (unlinked; type it directly)
**Phase 13 impact:** none. Room schema stays at version 2.

---

## 0. The one-line summary

Phase 14 builds the apparatus for deciding **which on-device audio model SYSTEMA
should use** — and deliberately stops short of deciding. It measures; a human
chooses.

---

## 1. Why this phase exists

The tempting move was to pick CLAP, wire it in, and call it "AI-powered music
understanding". That would have been a mistake for three reasons:

1. **The obvious candidate is the heaviest.** LAION-CLAP's audio tower is ~30M
   parameters at ~111 GFLOPs per sample, and the full checkpoint including the
   RoBERTa text encoder is around 155M parameters. On a mid-range phone that is
   a serious commitment, and nobody had measured whether it is affordable.
2. **The alternatives are not obviously worse.** YAMNet is a MobileNetV1 built
   for phones. PANNs CNN10 sits in between. For "does this track sound like that
   track", a 1024-dimensional AudioSet embedding may be entirely sufficient —
   and 40× cheaper.
3. **A choice you cannot justify is a choice you cannot revisit.** Once a model
   ships, its embedding dimension leaks into the database, the index and the UI.
   Changing it later means a migration.

So this phase produces evidence and an explicit, recorded decision point instead
of a default.

### What Phase 14 explicitly does NOT do

- ❌ No library scanning, indexing or whole-library embedding
- ❌ No background/WorkManager analysis
- ❌ No startup AI work
- ❌ No semantic search, vector search, recommendations, taste profiles, AI
  playlists, LLM or conversational AI (those are Phase 15+, per §32)
- ❌ No silent production-model selection

The constraint "**never touch the entire music library**" is enforced in code,
not just documented — see §9.

---

## 2. Candidate models

Registered in `app/services/ai-lab/modelRegistry.ts`. All figures are **published
metadata, not SYSTEMA measurements**, and the UI labels them as such.

| Model | Dim | Rate | Size (claimed) | Licence | Why it is a candidate |
|---|---|---|---|---|---|
| **Reference DSP** | 64 | 22.05k | 0 MB | internal | Not a candidate — harness self-test (§4) |
| **YAMNet** | 1024 | 16k | ~15 MB | Apache-2.0 | MobileNetV1 backbone; the literature's usual mobile recommendation |
| **VGGish** | 128 | 16k | ~280 MB | Apache-2.0 | Smallest embedding; poor size/benefit, kept as a baseline |
| **PANNs CNN10** | 512 | 32k | ~100 MB | MIT | Mid-weight; lighter PANNs preferred on constrained hardware |
| **OpenL3 (music)** | 512 | 48k | ~190 MB | **CC-BY-NC-SA** | Music-specific, most precise of the classics — but non-commercial |
| **LAION-CLAP** | 512 | 48k | ~620 MB | Apache-2.0 | Audio/text shared space; the eventual text-search enabler |
| **M2D-CLAP** | 768 | 16k | ~350 MB | research | Stronger CLAP-family alternative (79.31 zero-shot GTZAN) |

**Notes that matter more than the table:**

- **OpenL3's licence is a blocker for commercial distribution.** CC-BY-NC-SA is
  non-commercial. This is recorded as a limitation on the registry entry.
- **CLAP's size may be overstated for our use.** If text embeddings are
  precomputed off-device, the RoBERTa text encoder need not ship at all. That
  decision must be made before any size figure is treated as final.
- **None of these are installed.** Every real candidate is `NOT_INSTALLED`.
  Weights are far too large for git and must be side-loaded.

---

## 3. Target hardware, and two findings that shaped the design

Target device: **Poco X7 Pro** — MediaTek Dimensity 8400-Ultra (4nm, octa-core
Cortex-A725 up to 3.25 GHz), Mali-G720, LPDDR5X/UFS 4.0, **Android 15**.

Two research findings changed what was worth building:

### NNAPI is deprecated in Android 15

That is the exact OS on the target device. Google's own guidance notes that most
devices are expected to fall back to the CPU backend, and points elsewhere for
new work. **Consequence:** NNAPI is registered as a measurable, *unavailable*
provider — never assumed to be faster. CPU is the realistic baseline.

### Qualcomm's QNN provider does not apply

ONNX Runtime's `onnxruntime-android-qnn` depends on Qualcomm's runtime. The
target is MediaTek. **Consequence:** there is no cheap NPU path here. Xiaomi
markets an NPU but exposes no public vendor API, so §9's instruction to
*document rather than fake* NPU support is satisfied by saying plainly: no
validated GPU/NPU path exists, and none is claimed.

---

## 4. Why ONNX Runtime is not integrated (and what exists instead)

**`onnxruntime-android` was deliberately NOT added.** Reasons:

1. Phase 14's own brief assigns runtime integration to Phase 15 (§32).
2. The AAR is ~15–20 MB and the models are 15–620 MB. Neither can live in git,
   so adding the dependency would produce a build that is bigger and still
   cannot run a single model.
3. A runtime with no weights measures nothing.

What exists instead is the **`InferenceRuntime` abstraction** plus two
implementations:

- **`ReferenceRuntime`** — real, deterministic, weight-free. It computes a
  genuine band-energy + zero-crossing embedding, L2-normalised. This is not a
  mock: it lets the harness prove that timing, memory tracking, warm-up
  discipline, aggregation, determinism checks and failure isolation all work
  correctly, on any machine, in CI.
- **`OnnxRuntimeStub`** — declares the contract and **fails loudly**. It throws
  `RUNTIME_UNAVAILABLE` with a specific explanation. It never fabricates a
  latency, never returns a plausible embedding, never pretends a model loaded.

That last point is the important one. A stub returning invented numbers would
silently corrupt every conclusion this phase exists to produce.

**Adding ONNX in Phase 15 means writing one class.** No benchmark, UI, store or
test code changes.

---

## 5. Datasets

Two kinds, both explicit, both capped at **20 samples** (`MAX_DATASET_SAMPLES`).

### Synthetic (default)

Twelve deterministic generated signals spanning dense/sparse, bass-heavy/bright,
percussive/tonal, noisy/quiet, plus three edge cases: digital silence, an
ultra-short 0.4 s clip, and a 30 s multi-window excerpt.

These are **not music and are not described as such**. They are controlled
inputs with known, deliberately different properties. Their value:

- fully reproducible (seeded mulberry32 PRNG keyed off the sample id),
- runnable on desktop and in CI,
- committable, unlike real audio,
- and they include a **known-similar pair**, which is what makes the
  nearest-neighbour sanity check possible.

### Device tracks (optional)

Real tracks the developer picks **by hand** on the device, capped at 20.

Selection procedure:

1. Scan your library from Settings (the lab will not scan for you).
2. Open `/dev/ai-benchmark`, choose **DEVICE TRACKS (MANUAL)**.
3. Press **LOAD TRACK LIST**, tick 5–20 tracks spanning genres, dynamics and
   production styles.
4. The dataset id is a hash of the selected ids, so the same selection
   reproduces the same id.

Only a track id and a truncated 40-character label are stored. **Never a file
path, never audio.**

---

## 6. Pipeline and preprocessing

```
Dataset → Preprocessing → Runtime → Inference → Embedding → Metrics → Result → Comparison
```

Defaults (`DEFAULT_PREPROCESSING`): 48 kHz, mono, 10 s window, 0 s overlap, peak
normalisation to 0.95, mean aggregation.

Each model overrides what its input contract requires. **Every override is
recorded and reported** — `resolvePreprocessing()` returns the applied config
plus a human-readable list of differences, which lands in the run's warnings.
This is what stops YAMNet's 0.96 s frames from being silently compared against
CLAP's 10 s frames as though they measured the same thing.

Edge-case handling that is easy to get wrong and is tested:

- Peak/RMS normalisation of digital silence returns silence, **not NaN**.
- A buffer shorter than one window yields exactly one zero-padded frame, so
  sample counts stay predictable.
- An empty buffer still yields one frame rather than zero.

---

## 7. Metrics, and what they honestly mean

Every metric carries a confidence: **MEASURED / ESTIMATED / UNKNOWN /
NOT_APPLICABLE**. The `LabMetric` component renders the label, so a missing
measurement can never be mistaken for a zero.

| Group | Metrics | Honesty note |
|---|---|---|
| **Model** | size, format, dim, quantization, runtime | Size is *claimed* unless measured at load |
| **Performance** | load, warm-up, avg / median / p95, throughput, audio duration, RTF | MEASURED |
| **Memory** | baseline / peak / delta | **ESTIMATED** — JS heap only, not process RSS |
| **CPU** | usage | **NOT_APPLICABLE** — unreadable from the WebView; no figure invented |
| **Reliability** | success / fail / timeout / error counts, rate | MEASURED |
| **Quality** | determinism, mean pairwise similarity, NN sanity | Not accuracy — see below |

### There is no accuracy metric, on purpose

§7 forbids inventing accuracy without ground truth, and there is no labelled
dataset here. What is measured instead:

- **Determinism** — cosine similarity between repetitions on identical input.
  Anything below 1.0 means the model is non-deterministic.
- **Mean pairwise similarity** — a *separation proxy*. Near 1.0 across clearly
  different inputs means the model cannot tell them apart, which is a real
  finding. Low is better.
- **Nearest-neighbour sanity** — does the known-similar pair embed closer than
  an unrelated sample? A pass/fail sanity check, not a benchmark score.

The UI states "NOT AN ACCURACY MEASUREMENT" directly beneath these numbers.

### Measurement discipline

1. **Model load is timed separately** and never folded into inference averages.
2. **Warm-up runs are executed and discarded.** The first pass through any
   runtime pays for lazy allocation and JIT; including it would defame the model.
3. **N repetitions per sample**, all timings retained, so median and p95 are
   real order statistics rather than derived from an average.

---

## 8. Desktop vs device

**A desktop number must never be presented as a device number.** Enforced three
ways:

- Every run is stamped `SYNTHETIC` / `DESKTOP` / `DEVICE` from
  `Capacitor.isNativePlatform()`.
- Desktop runs get an unmissable banner and a warning prepended to the run.
- **The comparison engine treats mixed environments as a hard blocker** and
  refuses to present them as a fair comparison.

`SYNTHETIC` is a third category on purpose: a reference-runtime run validates
the *harness*, and saying so is different from claiming a model result.

---

## 9. How "never touch the library" is enforced

Not by documentation. By construction, and by tests:

| Guard | Mechanism |
|---|---|
| No library-wide dataset | `buildDeviceDataset()` **truncates** to 20. Feed it 5,000 tracks, get 20. Tested. |
| No store-level sweep | `stores/aiLab.ts` does not import the library store and exposes no `benchmarkAll`/`analyzeLibrary` action |
| No startup work | The store has no `onMounted`, no auto-run watcher; no Nuxt plugin references the lab |
| No background work | No WorkManager, no `AudioAnalysisScheduler`, no periodic work anywhere in the lab tree |
| No production entry point | Not linked from AppShell, MobileDock, DesktopSidebar, settings, Home or AI Insights |
| Isolated chrome | `dev` layout — no AppShell, no bottom nav, no mini player |

`scripts/test-ai-benchmark-safety.ts` (282 assertions) audits all of the above.
It strips comments before matching, so the extensive prose about what is
*deliberately not done* cannot accidentally satisfy a check.

---

## 10. Storage — and why it is not Room

Benchmark runs live in `localStorage` under `systema:ai-lab:*`, **not** the
Phase 13 Room database.

Rationale: the Room DB holds production analysis data with a migration history.
Benchmark results are research artefacts whose shape changes every time a metric
is added. Sharing a database would force a Room migration per experiment and put
real user data at risk for zero benefit. **The Room schema therefore stays at
version 2, untouched** — asserted by the safety suite.

Retention is capped at 50 runs (oldest dropped). Export before you hit it.

---

## 11. Export

`EXPORT JSON` produces metrics and metadata only, with a disclaimer embedded in
the payload so a shared file cannot be misread. **No audio, no embeddings, no
file paths** — verified behaviourally by building a real export and inspecting
its keys, not by grepping the source.

---

## 12. Interpreting results

1. **Check the environment badge first.** DESKTOP tells you almost nothing about
   the phone.
2. **Check `status`.** `PARTIAL_SUCCESS` means averages cover only the samples
   that succeeded.
3. **Read confidence labels.** An ESTIMATED memory figure is not a measurement,
   and the target evaluator will report UNKNOWN rather than passing a target on
   a number it does not trust.
4. **Check compatibility before comparing.** Different dataset, preprocessing,
   device, environment or harness version ⇒ NOT COMPARABLE.
5. **Real-time factor** < 1.0 means faster than playback. For background
   analysis you want a good deal of headroom below that.

### Reference targets (§29)

Configurable defaults, **not** pass/fail gates: median ≤ 500 ms, peak ≤ 350 MB,
size ≤ 200 MB, RTF ≤ 0.5, success ≥ 95%. They exist so the dashboard can say
"meets/misses" instead of leaving you to eyeball raw numbers.

### There is no composite score

§18 forbids an arbitrary score, and any weighting of latency against memory
against quality would be exactly that. Recommendations are per-category and each
states the single metric it used. `BALANCED` is the only multi-metric one and it
discloses its formula: an equal-weight rank sum of latency and memory.

---

## 13. Selecting a production model (§28)

Recommendations are **advisory**. Adopting a model requires a human to press
**SELECT AS PRODUCTION MODEL** and write a rationale — the rationale is
mandatory, because a selection with no stated reason is indistinguishable from a
silent default.

**"NO PRODUCTION MODEL SELECTED" is a valid, expected state**, and it is the
current one.

---

## 14. Adding a model

Append a `ModelDefinition` to `MODEL_REGISTRY`. Nothing else changes — the
runner is model-agnostic. Required: id, version, source, licence, format, size +
`sizeConfidence`, input contract, embedding dimension, runtime, quantization,
availability, a rationale, and **at least one honest limitation** (the registry
validator rejects a real candidate with an empty limitations list).

---

## 15. Running

**Desktop / CI:**
```bash
npm test          # includes both Phase 14 suites
npm run dev       # → http://localhost:3000/dev/ai-benchmark
```

**Device (the only measurements that count):**
```bash
npm run build:android
npx cap open android      # build & install from Android Studio
```
Then navigate to `/dev/ai-benchmark`, confirm the banner reads **DEVICE
BENCHMARK**, and run. Only the reference harness will execute until Phase 15
installs a real runtime and weights.

---

## 16. Verification status

| Level | What |
|---|---|
| **TEST VERIFIED** | Registry, preprocessing determinism, framing, reference runtime, statistics, warm-up/repeat discipline, failure isolation, partial success, load-failure handling, comparison compatibility, targets, recommendations, persistence round-trip, export shape, sustained cap, all safety guarantees — **469 assertions** (187 harness + 282 safety) |
| **DESKTOP VERIFIED** | `npm test` exit 0; `npm run build` exit 0; `npx cap sync android` exit 0; all three routes render HTTP 200 in a live dev server; lab page confirmed free of app chrome; Phase 13 routes still 200 |
| **CODE VERIFIED** | ONNX stub contract, device detection on Android, native memory/CPU reporting |
| **NOT VERIFIED** | **Anything on real hardware.** No Android device, emulator or SDK in this environment. No real model has been executed — zero weights installed. Device latency, memory, thermal behaviour and NNAPI availability are all **unmeasured**. |

**No number in this phase came from a phone.** The harness is proven correct;
the models are unmeasured.

---

## 17. Phase 15 checklist

1. Add `com.microsoft.onnxruntime:onnxruntime-android`.
2. Implement `OnnxRuntime implements InferenceRuntime` (replace the stub).
3. Define the side-loading path for weights (`Documents/systema-models/`), with
   checksum verification against `ModelDefinition.checksum`.
4. Add a native memory/CPU probe so those metrics become MEASURED.
5. Export YAMNet and PANNs CNN10 to ONNX; benchmark on device.
6. Only then decide about CLAP — and whether the text encoder must ship at all.
