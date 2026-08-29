# Phase 29 — Music Semantic Analysis Provider: model & runtime findings

Everything below was read from the official Essentia model metadata
(`essentia.upf.edu/models/...json`) during this phase, not from memory.

---

## 1. The model is a TWO-STAGE pipeline, not one model

This is the single most important architectural fact, and it is easy to
miss: `mtg_jamendo_moodtheme-discogs-effnet` **cannot consume audio.**
It is a small classifier head that consumes a 1280-dimensional
embedding. Audio has to go through a separate embedding model first.

```
audio 16 kHz mono
      ↓
  mel-spectrogram              (external front-end, 128 × 96 patches)
      ↓
discogs-effnet-bs64-1          embedding model — 1280-d per patch
      ↓
  ┌───────────────┬────────────────────┬──────────────────┐
  ↓               ↓                    ↓                  ↓
moodtheme      genre              top50tags        voice_instrumental
56 classes     87 classes         50 classes       2 classes
```

One embedding pass feeds every head. Adding a head costs one small
matrix, not another audio pass — which is why the provider is designed
around "one embedding, many heads" rather than one provider per field.

---

## 2. Exact model identities

### Embedding model (required by all heads)

| Field | Value |
|---|---|
| Name | `discogs-effnet-bs64-1` |
| Version | 1 |
| Released | 2022-02-17 |
| Framework | TensorFlow 2.8.0 |
| Formats | `frozen_model`, `SavedModel`, **`onnx`** |
| Input | `serving_default_melspectrogram`, float, **[64, 128, 96]** (batch 64, 128 frames, 96 mel bands) |
| Output (embeddings) | `PartitionedCall:1`, float, **[64, 1280]** |
| Output (styles) | `PartitionedCall:0`, float, [64, 400] |
| Sample rate | **16000 Hz**, mono |
| Trained on | Discogs-4M (unreleased in-house), 3.3M tracks |
| Metrics | ROC-AUC 0.954, PR-AUC 0.206 |

### Head — mood/theme (the primary target)

| Field | Value |
|---|---|
| Name | `mtg_jamendo_moodtheme-discogs-effnet-1` |
| Version | **1** |
| Released | 2022-11-20 |
| Framework | TensorFlow 2.8.0 |
| Formats | **`frozen_model` only — no ONNX published** |
| Input | `model/Placeholder`, float, **[1280]** |
| Output | `model/Sigmoid`, float, **[56]** — multi-label, independent sigmoids |
| Type | multi-label classifier |
| Trained on | MTG-Jamendo mood/theme subset, 18,486 full tracks |
| Metrics | **test PR-AUC 0.14**, test ROC-AUC 0.76 |

**PR-AUC 0.14 deserves emphasis.** On a 56-label multi-label problem
that is meaningfully above random, but it is a weak classifier in
absolute terms. Individual predictions will frequently be wrong. This
is precisely why the phase collects raw scores and human labels rather
than displaying a mood as fact — the number tells us to expect the
evaluation to be unflattering.

### Head — voice / instrumental

| Field | Value |
|---|---|
| Name | `voice_instrumental-discogs-effnet-1` |
| Version | **2** |
| Released | 2022-08-25 |
| Framework | TensorFlow 2.4.0 |
| Formats | `frozen_model` only |
| Input | `model/Placeholder`, float, [1280] |
| Output | `model/Softmax`, float, **[2]** — single-label, softmax |
| Classes | `instrumental`, `voice` (**in that order — index 0 is instrumental**) |
| Trained on | in-house MTG collection, 1000 excerpts, 500/class |
| Metrics | 5-fold CV normalised accuracy **0.96** |

Note the different output op: mood/theme is **Sigmoid** (independent
per-label probabilities that need not sum to 1), voice/instrumental is
**Softmax** (mutually exclusive, sums to 1). Treating one like the other
would silently corrupt every score, so the taxonomy records the
activation per head and the metrics code branches on it.

### Head — genre

| Field | Value |
|---|---|
| Name | `mtg_jamendo_genre-discogs-effnet-1` |
| Output | multi-label, **87 classes**, Sigmoid |
| Source of class list | official Essentia models documentation |

### Head — top50tags

50 classes, multi-label. **The exact class list could not be retrieved**
(the metadata endpoint did not respond during this phase), so this head
is declared but its taxonomy is left empty and marked
`labelsUnavailable`. Guessing 50 label strings would put fabricated
vocabulary into the dataset.

---

## 3. Licensing — the blocker for shipping, not for experimenting

> "All the models created by the MTG are licensed under **CC BY-NC-SA
> 4.0** and are also available under proprietary license upon request."
> — essentia.upf.edu/models.html

Also relevant:

- **Essentia library itself: AGPL-3.0.** Not used here; we do not link
  Essentia. Only the model weights are relevant.
- MTG-Jamendo dataset metadata: CC BY-NC-SA 4.0; the dataset is stated
  to be "for non-commercial research and academic use".

**Consequence: `NC` means these weights cannot ship in a commercial
closed-source app.** For a personal, non-commercial build, and for the
research/evaluation purpose of this phase, CC BY-NC-SA is fine. A
commercial licence is available from MTG on request.

This is recorded in the provider itself, not just here, so nobody
discovers it after building a product around it. `SA` additionally means
derivative weights would have to be shared alike — relevant if the model
is ever fine-tuned.

**No production model is selected by this phase.**

---

## 4. Runtime decision: ONNX Runtime Android

Options evaluated against the existing architecture:

| Option | Verdict |
|---|---|
| **ONNX Runtime Android** | **Chosen.** Already a dependency (`android/app/build.gradle`), already wrapped by `InferenceRuntime` / `OnnxInferenceRuntime`, already used by CLAP. Adds zero new dependencies. |
| TensorFlow Lite | Rejected. Would add a second ~3 MB+ inference stack for one experiment, and duplicate a runtime abstraction that already exists. |
| Essentia native (C++) | Rejected. Needs an NDK build of Essentia plus TensorFlow C — very large, AGPL-3.0, and would bypass `InferenceRuntime` entirely. |
| Essentia.js | Rejected. WASM in the WebView; the audio lives on the native side, and the project rule is that the UI never runs inference. |
| Python | Excluded by the brief, and correctly so. |

### What conversion is required

| Model | Published format | Needed | Action |
|---|---|---|---|
| `discogs-effnet-bs64-1` | **ONNX available** | ONNX | download only |
| `mtg_jamendo_moodtheme-1` | frozen `.pb` | ONNX | **convert** via `tf2onnx` |
| `voice_instrumental-2` | frozen `.pb` | ONNX | **convert** via `tf2onnx` |
| `mtg_jamendo_genre-1` | frozen `.pb` | ONNX | **convert** via `tf2onnx` |

The heads are tiny (a 1280→512→56 MLP), so conversion is mechanical.
Conversion tooling lives in `scripts/phase29/` and is **not** part of the
application, per the brief.

### The mel front-end is the real work

EffNet does not take audio; it takes **[64, 128, 96]** mel patches. So a
device implementation needs a 16 kHz, 96-band mel front-end producing
128-frame patches, batched 64 at a time. The project already has mel
infrastructure for other models, but CLAP's front-end is CLAP's — its
parameters differ and it must not be reused blindly.

This is documented as remaining work rather than guessed at, because a
mel front-end that is subtly wrong produces confident, meaningless
predictions — the exact failure this phase is meant to avoid.

---

## 5. Can it run on Android?

**Plausibly yes, and NOT PROVEN.**

- EffNet-B0-scale at 16 kHz is a small model; ONNX Runtime Android
  already runs CLAP, which is considerably larger.
- The heads are negligible.
- The batch-64 input means padding to a fixed batch, or re-exporting with
  a dynamic batch axis.

Nothing here has been executed on a device. No weights were obtainable
in this environment: `essentia.upf.edu` model downloads return HTTP 000
(connection refused at the network layer), exactly as `huggingface.co`
does. The metadata JSON was reachable through a different path; the
weights were not.

---

## 6. What this phase therefore builds

Per §16 of the brief: the full pipeline **except** the device runtime,
with a runtime boundary that is honest about being empty.

- Generic, model-independent provider contract.
- Real, verbatim taxonomies for the heads whose labels were confirmed.
- Dataset schema v2, backward compatible, storing complete ranked output.
- Full Player and `/dev/ai-dataset` integration.
- Human labelling kept strictly separate from prediction.
- Multi-label-correct evaluation metrics.
- A runtime adapter that reports `PROVIDER_NOT_READY` until real weights
  are imported, and **never** returns a fabricated prediction.

The provider will produce nothing until the models are converted and
imported. That is the correct behaviour: an empty result is recoverable,
a fake one silently poisons every later evaluation.

---

## 7. Conversion procedure (run OFF-device, outside the app)

```bash
pip install tf2onnx tensorflow

# Heads: frozen graph -> ONNX
python -m tf2onnx.convert \
  --graphdef mtg_jamendo_moodtheme-discogs-effnet-1.pb \
  --inputs   model/Placeholder:0 \
  --outputs  model/Sigmoid:0 \
  --opset 13 \
  --output   mtg_jamendo_moodtheme-discogs-effnet-1.onnx

python -m tf2onnx.convert \
  --graphdef voice_instrumental-discogs-effnet-1.pb \
  --inputs   model/Placeholder:0 \
  --outputs  model/Softmax:0 \
  --opset 13 \
  --output   voice_instrumental-discogs-effnet-1.onnx
```

`discogs-effnet-bs64-1.onnx` is published directly and needs no
conversion.

Verify each conversion by comparing TF and ONNX outputs on the same
input before trusting it; a silently wrong conversion is
indistinguishable from a working one in the UI.
