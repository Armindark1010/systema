# Phase 29.x — Discogs-EffNet device verification

**Status: NOT VERIFIED.** No Android device has run this code. Every
test in this repository runs in Node, where there is no ONNX Runtime,
no Android and no model file. Those tests prove the *wiring* is honest.
They cannot prove inference works, and nothing below should be read as
a claim that it does.

This document is the procedure that would establish that.

---

## What was built

| Concern | Answer |
|---|---|
| Model import path | Existing `ModelImporter` → `ModelStorage` → `ModelContractStore` → `ModelRegistry` |
| Registry identity | Derived from the installed file name, e.g. `discogs-effnet-bsdynamic-1` |
| Version | Parsed from the file's trailing numeric token (`-1` → `"1"`), never invented |
| Declared input | `[batch, 128, 96]` float32, batch read from the graph (`-1` when dynamic) |
| Declared output | `[batch, 1280]` float32 |
| Embedding dimension | 1280 |
| Extra outputs | 400-way Discogs styles (`PartitionedCall:0`). Documented, **not** surfaced |
| Preprocessing | MusiCNN front end: 16 kHz, frame 512, hop 256, 96 slaneyMel bands, `unit_tri`, magnitude spectrum, `log10(1 + 10000·m)`, 128-frame patches, hop 62 |
| Android runtime | `OnnxInferenceRuntime` (`RuntimeIds.ONNX`), shared with the benchmark |
| Native bridge | Wired: `effnetStatus`, `effnetLoadModel`, `effnetEmbedTrack`, `effnetRelease` |
| Classifier heads | **None.** Genre, mood, tags and voice/instrumental are not produced |

---

## Preconditions

1. A JDK and the Android SDK. **Neither exists in the sandbox this was
   written in**, so the Kotlin has never been compiled. Expect to fix
   compile errors on the first build; that is the normal cost of
   writing Kotlin without a compiler, not a sign the design is wrong.
2. `discogs-effnet-bsdynamic-1.onnx` on the device, reachable from the
   file picker. Do **not** copy it into the app directory by hand — the
   point of the exercise is that the importer accepts it.
3. A known-good MP3 of at least ~5 seconds. Shorter than one patch
   (~2.1 s of audio) is **expected to be refused**, not to succeed.

## Build and install

```bash
npm run build:android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

If the Kotlin does not compile, that is the first real finding.

## Watch the logs

```bash
adb logcat -c
adb logcat -s SystemaEffnet:V SystemaInference:V Capacitor/Plugin:V
```

---

## Step 1 — Import the model

Model Import → pick `discogs-effnet-bsdynamic-1.onnx`.

**Expected:** the importer accepts it and it appears as installed.

**If it is REJECTED**, read the reason from `rejectionReasonFor`. The
fix must stay generic: no branch anywhere may test for the string
"discogs". A Discogs-specific bypass would let the next unvetted model
through on the same path.

**Confirm the identity is real:**

```
adb shell ls -la /sdcard/Android/data/com.systema.music/files/models/
```

The file name is the identity. `bs64` and `bsdynamic` must produce
**different** model ids — if they collapse into one, swapping exports
would silently reuse the previous cache.

## Step 2 — Confirm what the graph actually declares

This is the step that validates the assumptions, and it is the one
worth doing carefully.

Trigger a load and read the log line:

```
SystemaEffnet: loaded modelId=discogs-effnet-bsdynamic-1 batch=Dynamic
  inputs=serving_default_melspectrogram[-1, 128, 96]
  outputs=PartitionedCall:1[-1, 1280] PartitionedCall:0[-1, 400]
```

Check each field against the table above:

- **Input name** — if it is not `serving_default_melspectrogram`, the
  ONNX export renamed it and `EffnetDiscogsModel.INPUT_NAME` is wrong.
- **Batch axis** — `-1` means dynamic and `batch=Dynamic` is correct.
  A literal `64` with a filename saying `bsdynamic` means the file is
  mislabelled; trust the graph, which is what the code does.
- **Patch/band axes** — must be `128` and `96`. Anything else means the
  front end is producing the wrong tensor and the embedding would be
  confident nonsense.
- **1280** — the embedding width. If it differs, the ONNX export is not
  the model this was written against; stop and report it rather than
  adjusting the constant to match.

`verifySignature` should reject a mismatch with `MODEL_INCOMPATIBLE`.
If it accepts something from the list above, the check is too weak.

## Step 3 — Run one track

Full Player → AI Analysis → Analyze, on the known-good MP3.

**Expected log:**

```
SystemaEffnet: embedded trackId=<id> modelId=discogs-effnet-bsdynamic-1
  dim=1280 patches=118/118 decodeMs=… prepMs=… inferMs=…
```

**Expected sheet:** an `EMBEDDING` block showing `dimensions 1280`, the
model identity, the inference time, and the sentence explaining that no
labels are produced.

**Expected ABSENT:** genre, mood, tags, language, danceability,
acousticness, context suitability. If any of those appear, they were
fabricated and that is a defect, not a feature.

**Sanity-check the numbers, do not just read them:**

- `patches` should be roughly `analysed_seconds × 1.008`. ~120 for the
  default 120-second window. A `patches` of 1 means the front end is
  only producing one patch and the rest of the track is being ignored.
- `inferMs` of ~0 means the graph did not really run.
- The vector must not be all zeros — the TS layer rejects that with
  `INVALID_OUTPUT`, so if you see a stored all-zero embedding, the
  guard was bypassed.

**The strongest available check:** analyse two very different tracks
and compare their vectors. If cosine similarity is ~1.0, the model is
not actually seeing the audio — it is returning a constant, which is
exactly what a broken front end produces.

## Step 4 — Persistence

Close the player, reopen it, press Analyze again on the same track.

**Expected:** the result returns from cache (no `SystemaEffnet:
embedded` line, no decode cost).

**Then verify human labels survived.** If the track had ground-truth
labels, confirm they are unchanged. `saveSemanticAnalysis` preserves
`groundTruth` explicitly, and a test asserts it, but this is the field
where a regression would be least recoverable — check it on the device.

**Cache invalidation:** import a different export (e.g. the `bs64`
one), analyse the same track, and confirm it re-runs rather than
returning the `bsdynamic` result. This is what the file-derived version
string exists for.

## Step 5 — The error paths

Each must produce its own code, with no fallback to CLAP and no
fabricated result.

| Situation | How to produce it | Expected |
|---|---|---|
| `MODEL_NOT_INSTALLED` | Delete the model, then Analyze | Message naming Model Import |
| `MODEL_INCOMPATIBLE` | Import an unrelated `.onnx` under a `discogs-effnet-*` name | Signature rejection |
| `PREPROCESSING_FAILED` | A ~1 second clip, or a corrupt file | "too short" / decode failure |
| `INFERENCE_FAILED` | Hard to force deliberately; check it is reachable | Runtime error surfaced |

After every one of them, confirm the sheet shows **no** semantic
output. A refusal that still renders something has fallen back.

---

## Reporting the outcome

Record, for each step: what the log actually said, what the sheet
actually showed, and whether it matched. Where it did not match, the
log line is the useful artefact — please paste it verbatim rather than
summarising, since the failure is usually in the specific numbers.

Until Steps 1–5 have all passed on a real device, the correct
description of this work is "wired and tested off-device", not
"working".
