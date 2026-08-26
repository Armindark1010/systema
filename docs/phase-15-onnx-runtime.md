# Phase 15 — ONNX Runtime Integration

**Status:** implemented, pushed as `4e22a44`.
**Verification:** see the honesty table at the end. **NOT VERIFIED ON HARDWARE.**

---

## 1. What was built

Real ONNX Runtime inference on Android, behind the existing
`InferenceRuntime` abstraction, reachable only from the developer
benchmark lab.

```
Nuxt page
  → InferencePlugin        (Capacitor bridge — numbers and error codes only)
    → InferenceBenchmark   (lifecycle, timing, the 20-track cap)
      → InferenceRuntime   (the stable contract)
        → OnnxInferenceRuntime  ← the ONLY file importing ai.onnxruntime
          → ONNX Runtime
            → .onnx file
```

Nothing above the Kotlin line knows which runtime or which hardware
executed anything. Replacing ONNX Runtime in a later phase means
writing one new `InferenceRuntime` implementation and changing zero
TypeScript files.

### Files added

| File | Role |
|---|---|
| `inference/ModelDescriptor.kt` | Model contract as data; `TestModel`; error codes; `InferenceResult` |
| `inference/InferenceRuntime.kt` | The stable interface |
| `inference/OnnxInferenceRuntime.kt` | Real ONNX execution. **Only file importing `ai.onnxruntime`** |
| `inference/ReferenceInferenceRuntime.kt` | Pure-Kotlin control, **not a fallback** |
| `inference/ModelInputPreparer.kt` | The preprocessing boundary |
| `inference/ModelStorage.kt` | Side-loaded model storage; weights never in git |
| `inference/ModelRegistry.kt` | Installed files → descriptors |
| `inference/EnvironmentSnapshot.kt` | Screen/charging/battery/thermal/device metadata |
| `inference/InferenceBenchmark.kt` | Load-once → run N → unload; separated timings |
| `inference/InferencePlugin.kt` | The Capacitor bridge |
| `services/native/inferencePlugin.ts` | Typed contract. Contains no ONNX type |
| `services/native/inferenceService.ts` | Throws rather than substituting anything |
| `pages/dev/ai-benchmark/onnx.vue` | Runtime + model selection, MEASURE |
| `scripts/make-test-onnx-model.py` | Generates the deterministic model |

---

## 2. The deterministic test model (§8)

`android/app/src/main/assets/models/systema-test-model.onnx` — **423
bytes**, sha256 `6a552f3d…97ff3`.

```
output = (input × 2 + 1)²

[1, 2, 3, 4] → ×2 → [2, 4, 6, 8]
             → +1 → [3, 5, 7, 9]
             → ²  → [9, 25, 49, 81]
```

**Why a 423-byte model rather than a real one.** Proving "Kotlin →
ONNX Runtime → real `.onnx` → real inference → real output" needs a
file whose correct answer is known in advance, not a large model. If
ONNX Runtime is genuinely executing the graph, those four numbers
appear. If anything is stubbed or substituted, they do not.

It is committed because it contains **no learned weights** — it is
arithmetic, the same category as a test fixture. Real candidate
weights remain `.gitignore`d.

The graph uses only `Mul` and `Add` (present in every ONNX Runtime
build, including reduced mobile ones), so a failure means the
integration is broken, never that an operator was missing. Its input
length is **dynamic**, which also exercises the code path a
variable-length audio model will need.

### Verified against real ONNX Runtime (desktop)

```
input : [('input',  ['n'], 'tensor(float)')]
output: [('output', ['n'], 'tensor(float)')]

[1,2,3,4]   → [9.0, 25.0, 49.0, 81.0]     ← canonical case
[0,-1,-0.5] → [1.0, 1.0, 0.0]             ← sign/zero edge cases
len 1       → [25.0]                      ← dynamic shape, minimum
len 220500  → all 1.0                     ← dynamic shape, audio-sized
50 runs     → byte-identical               ← determinism
```

---

## 3. No fake inference (§5, §13)

Four independent guarantees, each with a test:

1. **The reference runtime is not a fallback.** It refuses any model
   other than the test model with `MODEL_INVALID`. Asked to "run
   YAMNet" it fails rather than returning arithmetic that could be
   mistaken for an embedding.
2. **Nothing catches an ONNX failure and retries elsewhere.** The
   safety suite greps for exactly that pattern in both layers.
3. **A missing model fails.** `MODEL_NOT_FOUND`, never an empty or
   zero-filled embedding.
4. **No randomness anywhere in the inference package.** Asserted per
   file.

### The five required error codes

`MODEL_NOT_FOUND` · `MODEL_LOAD_FAILED` · `MODEL_INVALID` ·
`MODEL_INFERENCE_FAILED` · `MODEL_UNLOADED`
(plus `INPUT_SHAPE_MISMATCH` and `RUNTIME_UNAVAILABLE`)

They are distinct because they demand distinct fixes: "side-load the
file", "the file is corrupt", and "it loaded but broke while running"
are three different problems.

---

## 4. The preprocessing boundary (§10)

**Implemented:** `RAW_WAVEFORM` (resample → fit length → peak
normalise) and `RAW_TENSOR` (passthrough).

**Deliberately refused:** `MEL_SPECTROGRAM`, `LOG_MEL_SPECTROGRAM`.

A mel front end must match a model's training configuration exactly —
bin count, fmin/fmax, power vs magnitude, log base, normalisation.
Getting any of those subtly wrong produces embeddings that look
plausible and mean nothing. The code throws `INPUT_SHAPE_MISMATCH`
with that explanation rather than guessing.

**Phase 13's DSP output is not model input.** BPM, spectral centroid
and loudness are a human-readable *description* of a track; a model
consumes a specific tensor. Treating them as interchangeable would be
a category error, so the two paths never touch.

**Known limitation, recorded rather than hidden:** the resampler is
linear interpolation with no anti-aliasing filter. Fine for timing a
model; not adequate for judging embedding quality.

---

## 5. Measurement (§11)

| Metric | Meaning |
|---|---|
| `decodeMs` | MediaCodec decode |
| `preprocessingMs` | PCM → model input |
| `inferenceMs` | **`session.run()` alone** |
| `tensorMs` | Tensor allocation + reading output back |
| `totalMs` | Sum of the above |
| `audioDurationMs` | Audio actually analysed |
| `rtf` | `totalMs / audioDurationMs` |
| `coldLoadMs` | Session creation — **once per batch, not per track** |

`inferenceMs` is timed as tightly as possible around `run()` so the
question "how much does the model itself cost?" has an answer that is
not contaminated by decode or marshalling.

Every result also carries `modelId`, `modelVersion`, `runtime`,
`device`, `androidVersion`, `screenState`, `chargingState`,
`thermalStatus` and `timestamp`.

### Lifecycle (§12)

```
load once → run selected tracks → unload
```

Never per-track reloading (which would make every measurement a cold
load and hide warm cost entirely). Unload runs in a `finally` block,
so a failed run still releases the session. Tensors and results are
closed in their own `finally`. `OrtEnvironment` is deliberately never
closed — it is a process-wide singleton, and closing it would break
every later load.

---

## 6. Safety (§13)

| Rule | How it is enforced |
|---|---|
| Max 20 tracks | Independently in `InferenceBenchmark`, `InferencePlugin` and `inferenceService` — the web layer is a UI, not a security boundary |
| No library scan | No file in the inference package touches MediaStore, ContentResolver or the track table |
| No auto-inference | No Nuxt plugin, layout or main-app page imports the inference service |
| No background scheduling | No WorkManager API appears in the package |
| Phase 13 untouched | Nothing writes to the analysis store; the decoder is reused read-only |
| No weights in git | `.gitignore` covers weight formats; the only committed `.onnx` is 423 bytes |

Tracks are **required** by the plugin — there is no "all" option and
no default. Asked for nothing, it fails rather than helpfully choosing
something.

---

## 7. Dependency choice

`com.microsoft.onnxruntime:onnxruntime-android:1.27.0`, CPU execution
provider, single-threaded intra/inter-op.

- **Not `onnxruntime-mobile`** — its reduced operator set would make a
  candidate model's failure indistinguishable from an integration bug.
  Size can be traded away once a model is actually chosen.
- **Not `onnxruntime-android-qnn`** — QNN is Qualcomm's provider; the
  target Poco X7 Pro is a **MediaTek Dimensity 8400-Ultra**, so that
  artifact would add ~6.5 MB that could never activate.
- **Not NNAPI** — deprecated in **Android 15**, the exact OS on the
  target device. Google's own guidance expects most devices to fall
  back to CPU.

CPU is the only honest execution provider here.

---

## 8. Superseded assertions

Two older tests asserted "no onnxruntime dependency". Phase 15 adds one
deliberately, so rather than deleting the rules I narrowed them to the
properties they were actually protecting:

- **Phase 14 suite** → inference must stay **native**; a JavaScript
  ONNX runtime would mean models running inside the WebView, bypassing
  the Kotlin boundary. Also now asserts at most one ONNX artifact and
  specifically not the QNN variant.
- **Phase 13 suite** → the **analyser package** must import no ML
  runtime and must not reach into the inference package. Phase 13's
  stored results must stay pure DSP.

---

## 8b. Runtime identifier contract (fixed after device testing)

Device testing surfaced a real blocker:

```
RUNTIME_UNAVAILABLE
Unknown runtime 'onnxruntime'. Available: onnx, reference
```

**Root cause.** Kotlin held two competing sources of truth for one
identifier. The registry was hand-written and keyed `"onnx"`, while
each runtime's own `runtimeId` property said `"onnxruntime"`.
`getCapabilities()` advertised the *property*; `runtime(id)` looked up
the *key*. The web layer was therefore told to request a name the
registry could not answer to.

The lab page made it worse: it searched for the literal `'onnx'`,
missed silently, then fell through to `runtimes[0]?.id` — which would
have quietly selected the **reference** runtime whenever ONNX was
unavailable, exactly the silent substitution §13 forbids.

**Canonical id: `onnxruntime`.** Two pre-existing reasons, not a
preference:

1. Phase 14 already defined `RuntimeId = 'reference' | 'onnxruntime'`
   and its `OnnxRuntimeStub` already used that spelling. Phase 15's job
   was to make that stub real, not to rename the contract around it.
2. `'onnx'` is **already taken** for a different concept:
   `ModelFormat = 'onnx' | 'tflite' | 'none'` names a **file format**.
   A runtime is not a format — a future TFLite runtime could load a
   converted `.onnx`, and one token for both would be ambiguous.

**Structural fix.** The registry now derives keys from the runtimes
themselves:

```kotlin
listOf(OnnxInferenceRuntime(), ReferenceInferenceRuntime())
    .associateBy { it.runtimeId }
```

A key can no longer disagree with what is advertised. Both languages
reference shared constants (`RuntimeIds` / `RUNTIME_ONNX`), bridge
fields are typed `RuntimeId` rather than `string`, and the page's
first-available fallback is gone: if ONNX is unavailable the selection
stays on ONNX, the button reads UNAVAILABLE, and MEASURE fails
explicitly.

---

## 9. Verification honesty table

| Claim | Status |
|---|---|
| Test model is a real ONNX file with the intended graph | **TEST VERIFIED** (102 assertions) |
| ONNX Runtime executes it → `[9,25,49,81]`, dynamic shapes, 50-run determinism | **DESKTOP VERIFIED** (onnxruntime 1.29.0, Python) |
| `ai.onnxruntime` confined to one file | **TEST VERIFIED** |
| No fallback, no fabrication, no weights committed | **TEST VERIFIED** (82 assertions) |
| 20-track cap, no library scan, Phase 13 untouched | **TEST VERIFIED** |
| Nuxt builds; Capacitor syncs | **DESKTOP VERIFIED** |
| Runtime id is canonical and agrees across the bridge | **ANDROID CODE VERIFIED** (26 assertions; static + behavioural replay) |
| Selecting ONNX resolves `OnnxInferenceRuntime` | **ANDROID CODE VERIFIED** — resolution logic replayed in tests, not executed on device |
| APK builds (`./gradlew assembleDebug`) | **NOT RUN HERE** — no JVM in this sandbox; JDK download blocked by TLS |
| Kotlin contract suite (descriptor, preprocessing, reference lifecycle) | **NOT RUN HERE** — no JVM/kotlinc in this environment. Runs via `./gradlew testDebugUnitTest` |
| **ONNX Runtime loads and executes on the Poco X7 Pro** | **NOT VERIFIED ON HARDWARE** |
| Real-audio pipeline end to end on device | **NOT VERIFIED ON HARDWARE** |
| Repeated inference without crash; unload releases memory | **NOT VERIFIED ON HARDWARE** |

Desktop ONNX Runtime executing the file says the **model** is correct.
It says nothing about the **Android AAR**, the ABI, or this device.
Only running it establishes that.

### To verify on device

1. Build and install the Android app.
2. Settings → **AI BENCHMARK LAB** → **ONNX RUNTIME LAB**.
3. Runtime **ONNX Runtime (CPU)**, model **Deterministic Test Model**,
   iterations 10 → **RUN TEST MODEL**. Expect `[9, 25, 49, 81]` and
   `deterministic: YES`.

   If it instead reports `RUNTIME_UNAVAILABLE`, the id contract has
   regressed — check that the registry still uses
   `associateBy { it.runtimeId }` and that both sides use the shared
   constants. If it reports `MODEL_LOAD_FAILED`, the runtime resolved
   correctly but the native AAR could not open the file, which is a
   genuinely different problem.
4. Select 1–3 tracks → **MEASURE**. Note that the test model accepts a
   waveform only because its shape is dynamic; the useful figures are
   decode and preprocessing cost.
5. Repeat with the screen off and record it **separately** — never
   averaged with screen-on results.

---

## 10. Explicitly not done

No production model chosen. No CLAP. No library-wide benchmark. No
analysis of the 3,910-track library. No embeddings, vector search or
recommendations. No change to the Phase 13 analyser or its stored
results. No cloud inference.

**Phase 16 handles audio embeddings.**
