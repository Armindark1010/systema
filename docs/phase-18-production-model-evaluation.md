# Phase 18 — Production Embedding Model Evaluation & CLAP Feasibility

> **Status: BLOCKED.**
> **No production model was selected automatically.**
> No candidate model was executed in this phase. Every weight host is
> blocked in the environment Phase 18 ran in. Read §5 before reading
> any other section, because it determines what the rest of this
> document can and cannot claim.

---

## 1. Objective

Decide what embedding architecture SYSTEMA should use for:

1. audio → audio similarity,
2. music-to-music retrieval,
3. semantic music search,
4. eventual natural-language library search — including Persian
   queries such as «یه آهنگ غمگین و آروم شبیه داریوش می‌خوام».

Requirement (4) is the one that constrains the answer. It cannot be
served by an audio-only embedding at all, no matter how good that
embedding is at (1)–(3). A model that cannot accept text is not a
partial solution to text search; it is not a solution to it.

**Scope limit.** Phase 18 is evaluation only. It does not build library
indexing, background embedding, a recommendation engine, semantic
search UI, or playlist generation, and it does not select a model.

---

## 2. Phase 17 baseline (given, not re-derived)

| Property | Value |
|---|---|
| Model | YAMNet (MobileNetV1), 1024-d |
| Dataset | 10 tracks, 19 human-labelled pairs |
| Label distribution | SAME 3 · SIMILAR 8 · DIFFERENT 8 |
| Aggregation | mean pooling, L2-normalised |
| **SIMILAR vs DIFFERENT AUC** | **0.3125** |
| Pair overlap | 56.25 % |
| Verdict | **HEAVY OVERLAP** |
| Memory | before 333.3 MB / peak 333.3 MB / after 333.3 MB / net +0.0 MB / **RELEASED** |
| Verification | Device-verified on the target handset |

**How to read AUC 0.3125.** It is below 0.5. On this labelled set
YAMNet ranked SIMILAR pairs as *less* similar than DIFFERENT pairs —
worse than a coin flip. With 19 pairs the confidence interval is very
wide, so the precise value should not be quoted as a score; the useful
conclusion is directional and robust: **YAMNet's embedding space does
not encode musical similarity as humans judge it.**

That is not surprising. YAMNet was trained to tag AudioSet events. It
learned to separate music from speech from a dog barking. Nothing in
its objective asked it to separate a sad Dariush ballad from an upbeat
pop track — both are simply "Music".

This baseline is **not modified** by Phase 18, and the Phase 16 memory
lifecycle code was left untouched.

---

## 3. Candidates evaluated

| # | Candidate | Modality | Why it was considered |
|---|---|---|---|
| 1 | YAMNet | audio-only | Incumbent baseline (Phase 17) |
| 2 | PANNs CNN10 | audio-only | Stronger AudioSet tagger, phone-scale |
| 3 | OpenL3 (music) | audio-only | Self-supervised, dedicated music weights |
| 4 | LAION-CLAP (music ckpt) | **audio + text** | Trained for text↔audio alignment |
| 5 | Microsoft CLAP 2023 | **audio + text** | Alternative CLAP lineage |
| 6 | AudioMuse-AI-DCLAP | **audio + text** | Distilled CLAP, ONNX for both towers |
| 7 | M2D-CLAP | **audio + text** | SOTA music zero-shot, research checkpoint |

VGGish was carried over from Phase 16 but is not re-litigated here: it
is 128-d, older and weaker than every other option, and nothing about
it addresses the text requirement.

---

## 4. Architecture audit (18A)

All figures are **published or read from primary sources**, never
measured by SYSTEMA. "Primary" below means the value was read out of
the actual package config or repository file during this phase.

| Model | Params | Size | SR | Window | Dim | Modality | Shared space | ONNX | Music-similarity trained? | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| YAMNet | ~3.7 M | ~15 MB | 16 kHz | 0.96 s | 1024 | audio | — | community | **No** — AudioSet tagging | primary |
| PANNs CNN10 | ~4.9 M | UNKNOWN | 32 kHz | UNKNOWN | 512 | audio | — | requires conversion | **No** — AudioSet tagging | secondary |
| OpenL3 music | UNKNOWN | UNKNOWN | 48 kHz | 1.0 s | 512 / 6144 | audio | — | requires conversion | Partially — self-supervised, music weights | secondary |
| LAION-CLAP music | ~155 M | ~2.2 GB | 48 kHz | 10 s | 512 | **audio+text** | **512-d** | requires conversion | **Yes** — contrastive, music ckpt | primary |
| MS-CLAP 2023 | GPT-2-scale text tower | UNKNOWN | 44.1 kHz | 7 s | 1024 | **audio+text** | **1024-d** | requires conversion | Partially | primary |
| DCLAP student | ~7 M audio | 22 MB audio + 501 MB text | 44.1 kHz | 10 s | 512 | **audio+text** | **512-d** | **community ONNX, both towers** | **Yes** — distilled from CLAP music | primary |
| M2D-CLAP | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | audio+text | UNKNOWN | UNKNOWN | Partially — GTZAN zero-shot 79.31 | secondary |

### Primary-source contracts read during this phase

These were extracted from the packages themselves (PyPI was reachable
even though weight CDNs were not), so they are contracts, not
recollections:

- **LAION-CLAP** — `laion_clap` 1.1.7 wheel: `HTSAT-tiny.json` gives
  48 kHz, 64 mel bins, `window_size` 1024, `hop_size` 480, fmin 50,
  fmax 14000, `clip_samples` 480000 (= 10 s). `clap_module/model.py`
  gives `joint_embed_shape: int = 512` — **the shared text/audio space
  is 512-d, not the 768 the audio tower's `embed_dim` might suggest.**
  This distinction matters: projecting into a shared space is the whole
  mechanism, and reading the wrong number would produce a dimension
  mismatch at integration time.
- **MS-CLAP** — `msclap` 1.3.4 wheel: `config_2023.yml` gives HTSAT +
  GPT-2, 44.1 kHz, 7 s, `d_proj: 1024`. `CLAPWrapper.py` fetches
  weights via `hf_hub_download` — i.e. HuggingFace-only distribution.
- **DCLAP** — GitHub API listing of release `v1`:
  `model_epoch_36.onnx` (1.2 MB), `model_epoch_36.onnx.data`
  (21.2 MB), `clap_text_model.onnx` (501.4 MB). Preprocessing per the
  repository README: 10 s segments at 44.1 kHz, 50 % overlap, 64 mel
  bands, `n_fft` 1024, hop 480, normalised `(log_mel + 42.6) / 25.9`;
  text tokenised with the `laion/clap-htsat-unfused` tokenizer padded
  to exactly 77 tokens.

---

## 5. Deployment feasibility — and why nothing ran (18D/18E)

### 5.1 The network probe

Availability was **tested, not assumed**:

| Host | Result |
|---|---|
| `github.com` | REACHABLE (200) |
| `api.github.com` | REACHABLE (200) |
| `pypi.org`, `files.pythonhosted.org` | REACHABLE (200) |
| `huggingface.co` | **BLOCKED** (no connection; DNS resolves) |
| `cdn-lfs.huggingface.co` | **BLOCKED** |
| `release-assets.githubusercontent.com` | **BLOCKED** |
| `objects.githubusercontent.com` | **BLOCKED** |
| `tfhub.dev` | **BLOCKED** |
| `storage.googleapis.com` | **BLOCKED** |

The GitHub *API* answers, which is how the DCLAP release assets were
found and catalogued with exact byte sizes. But every release asset
download 302-redirects to `release-assets.githubusercontent.com`,
which does not connect. So the artefacts are **known to exist and
still unobtainable**. Metadata was reachable; weights were not.

### 5.2 Consequence

**No candidate model was downloaded, converted, loaded, or executed in
Phase 18.** Therefore:

- No load time, inference time, RTF, decode, preprocessing or
  aggregation timing was measured for any candidate.
- No peak or post-cleanup memory was measured for any candidate.
- No audio→audio quality was measured for any candidate.
- No text→audio retrieval was measured for any candidate.

Every 18E measurement slot is **NOT MEASURED**. This is a property of
the environment, not a finding about the models, and it is recorded as
such rather than filled with plausible estimates.

### 5.3 Target-device context (carried forward)

- Poco X7 Pro — MediaTek Dimensity 8400-Ultra, Mali-G720, Android 15.
- **Not Qualcomm**, so ONNX Runtime's QNN execution provider does not
  apply.
- **NNAPI is deprecated in Android 15**; Google expects most devices to
  use the CPU backend. **CPU is the realistic baseline.**

---

## 6. Audio → audio results (18F)

| Model | Result |
|---|---|
| YAMNet | **MEASURED** (Phase 17): SIMILAR-vs-DIFFERENT AUC 0.3125, overlap 56.25 %, HEAVY OVERLAP |
| All others | **NOT MEASURED** — never executed |

No re-run was performed, and the Phase 17 labels were not touched. No
similarity threshold was invented, in this phase or any other.

The honest summary is that Phase 18 adds **no new audio→audio
evidence**. It explains the Phase 17 result (§2) but does not improve
on it.

---

## 7. Text → audio results (18G/18H)

**NOT MEASURED — for any model.**

A query set was not run, because running one would have required a
model that can embed text, and no such model could be obtained. The
brief's rule is explicit and was followed: an unrelated text model, a
manual text→AudioSet-label mapping, or an LLM guessing song names are
all **forbidden fakes**, and any of them would have produced a
plausible-looking table of Precision@K numbers that meant nothing.

Producing that table was the single easiest way to appear to complete
this phase, and it is the reason this section is short.

What Phase 18 *does* establish about text→audio is structural rather
than empirical:

- Only CLAP-class models can do it at all. YAMNet, PANNs and OpenL3
  are architecturally incapable of accepting a text query.
- The mechanism requires a genuine **shared** projection space, and the
  dimensions must match for `cosine(text, audio)` to be defined. The
  audit in §4 records the shared dimension for each text-capable model
  (LAION-CLAP 512-d, MS-CLAP 1024-d, DCLAP 512-d), read from source.
- The DCLAP route is the only one where both towers already exist as
  ONNX, which is the practical difference between "possible" and
  "a conversion project".

---

## 8. Performance results (18E)

**NOT MEASURED for every candidate.** No model was loaded, so there are
no load times, no first/warm/median/p95 inference figures, no RTF, and
no decode or preprocessing breakdown to report.

The only performance datum in this phase is the Phase 17 YAMNet run,
which is already recorded in the Phase 17 documentation and is not
restated here as if it were new.

---

## 9. Memory lifecycle (18O)

| Checkpoint | YAMNet (Phase 17, device) | All other candidates |
|---|---|---|
| BEFORE_MODEL_LOAD | 333.3 MB | NOT MEASURED |
| AFTER_MODEL_LOAD | 333.3 MB | NOT MEASURED |
| AFTER_TRACK_N | 333.3 MB | NOT MEASURED |
| AFTER_SESSION_CLEANUP | 333.3 MB | NOT MEASURED |
| Net | +0.0 MB | NOT MEASURED |
| Result | **RELEASED** | **UNKNOWN** |

No new memory measurement was taken, and the Phase 16 memory-lifecycle
code was **not modified** — no regression appeared that would justify
touching it.

---

## 10. Licensing (18A)

| Model | Code | Weights | Commercial use | Note |
|---|---|---|---|---|
| YAMNet | Apache-2.0 | Apache-2.0 | **Permitted** | Cleanest of the set |
| PANNs CNN10 | Apache-2.0 | **CC BY 4.0** (Zenodo 3576403) | Permitted **with attribution** | Attribution must ship in-product |
| OpenL3 | MIT | **CC BY 4.0** | Permitted **with attribution** | Code and weights differ; the weights are what ships |
| LAION-CLAP | **CC0 1.0** | CC0 1.0 | **Permitted** | See below |
| MS-CLAP 2023 | MIT | **UNKNOWN** | **UNKNOWN** | MIT code does not imply MIT weights |
| **DCLAP student** | **AGPL-3.0** | **AGPL-3.0** | **COPYLEFT — blocker** | See below |
| M2D-CLAP | UNKNOWN | UNKNOWN | UNKNOWN | Research checkpoint; assume restrictive |

### Two licensing findings that change the picture

**LAION-CLAP is not licence-ambiguous.** Earlier phases flagged it as
ambiguous because PyPI classifies the package Apache-2.0 while the
metadata quotes "Creative Commons Legal Code". The bundled `LICENSE`
file was read directly in this phase: it is **CC0 1.0**. Both readings
permit commercial use, so this is **not a blocker**. Correcting this
matters — the earlier note would have deprioritised the one
permissively-licensed CLAP.

**DCLAP is AGPL-3.0, and that is the blocker.** This was read from the
repository's own `LICENSE` file. AGPL-3.0 is strong copyleft; shipping
these weights inside a closed-source distributed app raises obligations
that SYSTEMA very likely cannot meet. This is a legal question, not an
engineering one, and it applies *even though DCLAP is technically the
best fit found in this phase*.

The combination is worth stating plainly: **the licence-clean CLAP is
too big for the phone, and the phone-sized CLAP is licence-blocked.**

---

## 11. Limitations

1. **Nothing was executed.** The central limitation. Every non-YAMNet
   row is research, and research is not evidence.
2. **The labelled set is tiny.** 19 pairs. AUC over 8×8 comparisons
   moves in steps of 1/64. No number derived from it should be treated
   as decision-grade.
3. **Only one model has ever been measured**, so there is no
   comparison — the Phase 18 comparison table has one populated column.
4. **Text→audio is entirely unevaluated**, including for the models
   that can in principle do it.
5. **Some fields remain UNKNOWN** (M2D-CLAP throughout; MS-CLAP weights
   licence; several sizes and parameter counts). They are marked
   UNKNOWN rather than estimated.
6. **No checkpoint hash was computed** for any candidate, because no
   checkpoint file was obtained. Provenance is therefore recorded by
   name and source URL only.
7. The DCLAP figures come from the author's own README and a
   Raspberry Pi benchmark; they are **unverified by SYSTEMA**.

---

## 12. Comparison table (18P)

| Model | Audio→Audio | Text→Audio | Speed | Memory | Size | License | Device | Verdict |
|---|---|---|---|---|---|---|---|---|
| YAMNet | AUC 0.3125 (HEAVY OVERLAP) | N/A — audio only | measured (Ph. 17) | RELEASED, +0.0 MB | ~15 MB | Apache-2.0 | **VERIFIED** | **NOT SUITABLE** |
| PANNs CNN10 | NOT MEASURED | N/A — audio only | UNKNOWN | UNKNOWN | UNKNOWN | CC BY 4.0 | NOT TESTED | INSUFFICIENT EVIDENCE |
| OpenL3 music | NOT MEASURED | N/A — audio only | UNKNOWN | UNKNOWN | UNKNOWN | CC BY 4.0 | NOT TESTED | INSUFFICIENT EVIDENCE |
| LAION-CLAP music | NOT MEASURED | NOT MEASURED | UNKNOWN | UNKNOWN | ~2.2 GB | CC0 1.0 | NOT TESTED | **BLOCKED** |
| MS-CLAP 2023 | NOT MEASURED | NOT MEASURED | UNKNOWN | UNKNOWN | UNKNOWN | MIT code / UNKNOWN weights | NOT TESTED | **BLOCKED** |
| DCLAP student | NOT MEASURED | NOT MEASURED | UNKNOWN | UNKNOWN | 22 MB + 501 MB | **AGPL-3.0** | NOT TESTED | **BLOCKED** |
| M2D-CLAP | NOT MEASURED | NOT MEASURED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT TESTED | INSUFFICIENT EVIDENCE |

Only the YAMNet row rests on the labelled dataset. The others are not
on a different dataset — they are on **no** dataset.

---

## 13. Final recommendation (18I / 18Q)

### Verdict by axis

- **AUDIO → AUDIO: NOT SUITABLE (current model).** YAMNet's AUC of
  0.3125 does not support music similarity. No replacement has been
  measured, so there is no evidenced alternative to recommend yet.
- **TEXT → AUDIO: BLOCKED.** Architecturally impossible with the
  current model, and no CLAP-class model could be obtained, licensed
  clearly, and sized for the device simultaneously.
- **OVERALL PRODUCT FIT: BLOCKED.**

### Overall: **BLOCKED**

**No production model was selected automatically.**

Phase 18 could not execute a single candidate. The CLAP feasibility
question was therefore answered on architecture, licensing and
availability evidence rather than on measurement — which is enough to
establish direction, and not enough to select a model.

### What the evidence does support

CLAP-class architecture is **the right direction**. It is the only
family that can serve natural-language search, its training objective
(contrastive text↔audio alignment) matches the product goal, and a
music-specialised checkpoint exists. The Phase 17 failure is best
explained by an objective mismatch, and CLAP is precisely the class of
model that fixes that mismatch.

The obstacle is not conceptual, it is logistical: size and licence.

### Recommended next steps (unblocking, in order)

1. Re-run this evaluation from an environment with access to
   HuggingFace and GitHub release assets.
2. Get a **legal** answer on AGPL-3.0 before any DCLAP integration work.
3. If AGPL is unacceptable, **distil in-house from the CC0-licensed
   LAION-CLAP-Music teacher** — the teacher's licence permits exactly
   this, which is the most valuable single finding in this phase.
4. Expand the labelled set well beyond 19 pairs before treating any AUC
   as decision-grade.
5. Only then measure on device: load time, warm inference, RTF, peak
   and post-cleanup memory.

---

## 14. Exact identifiers and reproduction

### Checkpoint identifiers

| Model | Checkpoint | Source | Hash |
|---|---|---|---|
| YAMNet | yamnet (AudioSet), community ONNX | tfhub.dev/google/yamnet | UNKNOWN — not re-obtained |
| PANNs CNN10 | `Cnn10_mAP=0.380.pth` | Zenodo 3576403 | UNKNOWN — unobtainable |
| OpenL3 | openl3 music, mel128/256 | openl3 package | UNKNOWN — unobtainable |
| LAION-CLAP | `music_audioset_epoch_15_esc_90.14.pt` (~2.2 GB) | HuggingFace (LAION) | UNKNOWN — unobtainable |
| MS-CLAP | `CLAP_weights_2023.pth` | HuggingFace via `hf_hub_download` | UNKNOWN — unobtainable |
| DCLAP | `model_epoch_36.onnx` + `.onnx.data` + `clap_text_model.onnx` | `github.com/NeptuneHub/AudioMuse-AI-DCLAP` release v1 | UNKNOWN — asset bodies unreachable |
| M2D-CLAP | UNKNOWN | arXiv 2503.22104 | UNKNOWN |

### Reproducing the network probe

```bash
for u in https://huggingface.co https://tfhub.dev \
         https://storage.googleapis.com https://github.com \
         https://release-assets.githubusercontent.com; do
  printf '%-50s ' "$u"
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "$u"
done
```

`000` means the connection failed outright.

### Reproducing the primary-source contract extraction

No weights required — these read config out of the packages:

```bash
pip download --no-deps --dest /tmp/p laion-clap msclap
cd /tmp/p && unzip -o -q laion_clap-*.whl -d lx && unzip -o -q msclap-*.whl -d mx
cat lx/laion_clap/clap_module/model_configs/HTSAT-tiny.json
grep -n 'joint_embed_shape' lx/laion_clap/clap_module/model.py
cat mx/msclap/configs/config_2023.yml
```

### Reproducing the DCLAP asset listing

```bash
curl -s https://api.github.com/repos/NeptuneHub/AudioMuse-AI-DCLAP/releases
```

### Running the Phase 18 tests

```bash
npx tsx scripts/test-phase18-candidates.ts
```

### Viewing the evaluation page

`/dev/ai-benchmark/production-candidates` — reachable from the
benchmark lab index.
