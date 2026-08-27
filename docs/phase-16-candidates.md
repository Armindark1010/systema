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
