# Phase 19 — On-Device Music Embedding Distillation & Teacher Evaluation

> **Result: BLOCKED.**
> **No production model was selected automatically.**
> No teacher model could be obtained, so no teacher inference, no
> text→audio retrieval, and no real distillation run were possible.
> The distillation *pipeline* was built and executed end-to-end
> against a synthetic fixture — that validates the code, and says
> nothing about music. **YAMNet is unchanged and remains in place.**

---

## 1. What was asked, and what is actually answered

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Can we obtain a usable teacher? | **No** — every weight host is blocked; two direct fetches returned 0 bytes | BLOCKED |
| 2 | Is its license acceptable? | LAION-CLAP is **CC0 1.0** (promising). DCLAP is **AGPL-3.0** (blocker). Distillation legality itself is **not settled** | FACT |
| 3 | Does it outperform YAMNet? | **UNKNOWN** — never executed | BLOCKED |
| 4 | Can it do text→audio? | Architecturally **yes** (512-d shared space, read from source). Empirically **NOT MEASURED** | FACT |
| 5 | Can we distil it? | Pipeline exists and runs end-to-end. Against a *real* teacher: **NOT MEASURED** | MEASURED (pipeline only) |
| 6 | Does the student retain ranking quality? | **UNKNOWN for music.** Fixture results validate code only | BLOCKED |
| 7 | Is the student fast enough on device? | **NOT MEASURED** — nothing ran on device | BLOCKED |
| 8 | Does the student release memory? | **NOT MEASURED** — nothing was loaded on device | BLOCKED |
| 9 | Strong enough to replace YAMNet? | **No.** Nothing measured beats YAMNet because nothing was measured | BLOCKED |
| 10 | Exact blocker? | **Network egress to every weight host.** Secondary: AGPL-3.0 on the one phone-sized CLAP | FACT |

---

## 2. The blocker, evidenced

Availability was re-probed for Phase 19 rather than inherited from
Phase 18, because "it was blocked last time" is an assumption.

| Host | Result |
|---|---|
| `pypi.org` | REACHABLE (200) |
| `github.com`, `api.github.com` | REACHABLE (200) |
| `huggingface.co` | **BLOCKED (000)** |
| `cdn-lfs.huggingface.co` | **BLOCKED (000)** |
| `release-assets.githubusercontent.com` | **BLOCKED (000)** |
| `objects.githubusercontent.com` | **BLOCKED (000)** |
| `zenodo.org` | **BLOCKED (000)** — newly blocked, removes the PANNs fallback |
| `download.pytorch.org` | **BLOCKED (TLS EOF)** |

Two direct weight fetches were attempted, not merely assumed to fail:

- LAION-CLAP `music_audioset_epoch_15_esc_90.14.pt` → **0 bytes** (connection refused)
- DCLAP `model_epoch_36.onnx` → **HTTP 302 → blocked CDN → 0 bytes**

**BLOCKED — WEIGHTS UNAVAILABLE.** No teacher inference of any kind was
performed. Steps 5, 6 and 10 of the brief are blocked, not skipped and
not estimated.

---

## 3. Teacher registry (Step 1)

Every value carries an evidence grade. **FACT** means read from a
primary source (package config, LICENSE file, repository API);
**UNVERIFIED** means published but unchecked. A published figure never
becomes MEASURED by being tabulated.

| Field | LAION-CLAP music | DCLAP | M2D-CLAP |
|---|---|---|---|
| Checkpoint | `music_audioset_epoch_15_esc_90.14.pt` · FACT | 3 ONNX assets, exact sizes · FACT | UNKNOWN |
| Audio dim | 512 · FACT | 512 · FACT | UNKNOWN |
| Text dim | 512 · FACT | 512 · FACT | UNKNOWN |
| **Shared dim** | **512** · FACT | **512** · FACT | UNKNOWN |
| Sample rate | 48 kHz · FACT | 44.1 kHz · FACT | UNKNOWN |
| Window | 10 s · FACT | 10 s · FACT | UNKNOWN |
| Size | ~2.2 GB · UNVERIFIED | 22.4 MB audio + 501.4 MB text · FACT | UNKNOWN |
| ONNX | No, requires conversion · FACT | **Yes, both towers** · FACT | UNKNOWN |
| License | **CC0 1.0** · FACT | **AGPL-3.0** · FACT | UNKNOWN |
| Weights obtainable | **BLOCKED_NETWORK** | **BLOCKED_NETWORK** | UNKNOWN |
| Teacher viability | VIABLE — pending legal review | **BLOCKED** (copyleft) | UNKNOWN |
| Audio→audio | **NOT MEASURED** | **NOT MEASURED** | **NOT MEASURED** |
| Text→audio | **NOT MEASURED** | **NOT MEASURED** | **NOT MEASURED** |

### The 512 that matters

LAION-CLAP's shared space is **512-d** (`joint_embed_shape` in
`clap_module/model.py`), *not* the 768 that `HTSAT-tiny.json` lists as
`embed_dim` — 768 is the pre-projection width. Building an integration
against 768 would produce a dimension mismatch at exactly the point
where it is most expensive to discover.

---

## 4. Teacher output contract (Step 2)

```
audio ──► teacher audio encoder ──► embedding ──► L2 normalise ─┐
                                                                ├─► cosine
text  ──► teacher text encoder  ──► embedding ──► L2 normalise ─┘
```

`validateTeacherContract` (TypeScript) and `TeacherOutputContract`
(Python) both enforce:

1. both dimensions known — unknowns cannot assert a shared space;
2. both positive;
3. the model actually has a text encoder;
4. **`audio_dim == text_dim`**;
5. embeddings L2-normalised.

**A mismatch fails loudly.** Neither implementation will insert a
projection to make the numbers agree. Doing so is trivial and would
manufacture a cosine between two unrelated spaces — a number that looks
entirely valid and means nothing.

---

## 5. Dataset design (Step 3) and labelling (Step 4)

Eight groups spanning the four required contrast families:

| Group | Intent | Real / slots |
|---|---|---|
| `A_same_recording` | Two encodes of one recording | 2/2 |
| `B_same_artist_style` | Same artist, similar character | 1/2 |
| `C1_calm_sad_persian_pop` | Calm / sad Persian pop | 3/3 |
| `C2_energetic_persian_pop` | Energetic Persian pop | 2/2 |
| `C3_classical_iranian` | Traditional / classical Iranian | 3/3 |
| `C4_instrumental_orchestral` | Instrumental / orchestral | 1/2 |
| `C5_electronic_remix` | Electronic / remix | 1/2 |
| `D_contrast` | Deliberate maximal contrast | 0/2 |

**13 real tracks, 5 placeholders.** The placeholders are counted and
displayed rather than quietly padding the design — in particular
`D_contrast` is empty, so the strongest available contrast is currently
*absent* from the real set, which would weaken any measurement taken
today.

**Labels remain human.** Groups are a design aid and are used only by
the synthetic fixture's geometry. They are never converted into pair
labels: deriving labels from artist, genre, filename or folder would
measure metadata tidiness and report it as an embedding result.

---

## 6. Audio→audio and text→audio (Steps 5 & 6)

**BLOCKED — WEIGHTS UNAVAILABLE. No results.**

No cosine matrix, no AUC, no Precision@K, no MRR, no Top-5 ranking, for
any teacher. The query set (10 queries: 6 English, 4 Persian) is
written and committed, ready to run the moment a teacher is reachable.

### Persian

**PERSIAN TEXT SUPPORT UNVERIFIED** for every teacher. LAION-CLAP was
trained on English audio captions. Its tokenizer will accept Persian
bytes and return a vector, but that vector has no established meaning.
No Persian capability is claimed by any model in this registry.

---

## 7. Distillation experiment (Steps 7–9)

The pipeline is **built and executed**. It was run against a
**synthetic fixture teacher**, and the distinction is critical.

### What the fixture is

`SyntheticTeacher` generates embeddings from group identity plus
per-track noise, giving a *known* geometry. A correct pipeline must
recover it. It is a unit-test oracle for the training code — nothing
more. Every artifact is tagged `teacher_is_real: false` and carries a
warning forbidding its use as a music result.

### Executed result

Trained on 208 fixture tracks, **all metrics computed on 112 held-out
tracks the student never saw**:

| Model | Dim | Params | Loss (first → final) | Held-out AUC | P@1 | MRR | Top-1 agreement w/ teacher |
|---|---|---|---|---|---|---|---|
| Teacher (synthetic) | 512 | — | — | 1.0000 | 1.0000 | 1.0000 | — |
| Student-128 | 128 | 132,224 | 0.8048 → 0.0048 | 1.0000 | 1.0000 | 1.0000 | **0.2321** |
| Student-256 | 256 | 165,120 | 0.7557 → 0.0027 | 1.0000 | 1.0000 | 1.0000 | 0.2143 |
| Student-512 | 512 | 230,912 | 0.7888 → 0.0018 | 1.0000 | 1.0000 | 1.0000 | 0.1250 |

**Reading this honestly.** Group-AUC, P@1 and MRR all saturate at 1.0
for every candidate, so **they do not discriminate between the three
dimensions at all** — the fixture's groups are too easy to separate.
The only column that separates them is top-1 agreement with the
teacher, where the smallest student happens to score highest.

That ordering must **not** be read as "128 is the best dimension". It
is a fixture artifact: lower-dimensional outputs concentrate cosine
mass, and the underlying task is synthetic. **No dimension was
selected**, exactly as the brief requires.

An initial version of this experiment trained and evaluated on the same
18 tracks and reported a perfect 1.0 everywhere including agreement —
a 230k-parameter model simply memorising 18 vectors. The held-out split
exists because that first result was meaningless.

### Step 8 — training is off-device

Training lives entirely in `scripts/phase19/` and runs under desktop
Python. The Android app is inference-only; no training code, tensor
library or optimiser was added to it. A test asserts this.

### Step 9 — student ONNX contract

Three ONNX graphs were exported and **verified to load and run** under
`onnxruntime`:

| Student | Input | Output | Verified |
|---|---|---|---|
| student-128 | `features [batch, 128]` f32 | `embedding [batch, 128]` | ✓ runs, ‖v‖ = 1.0 |
| student-256 | `features [batch, 128]` f32 | `embedding [batch, 256]` | ✓ runs, ‖v‖ = 1.0 |
| student-512 | `features [batch, 128]` f32 | `embedding [batch, 512]` | ✓ runs, ‖v‖ = 1.0 |

L2 normalisation is **inside the graph**, so the exported model cannot
be used without it. `onnx.checker` passes on all three.

Two export problems were found and fixed rather than worked around: the
default dynamo exporter split weights into an external `.onnx.data`
sidecar and failed opset-17 conversion. Shipping that would have given
Android a model whose weights live in a second file the loader is never
told about.

**Weights are not committed** (`.gitignore`). They are build outputs;
the script plus its recorded seed reproduces them exactly.

---

## 8. Android benchmark (Step 10)

**NOT MEASURED.** The brief conditions this on "a real student ONNX
model" existing. The three exported graphs are distilled from a
synthetic fixture, so benchmarking them would produce real timings for
a model with no musical meaning — precise numbers about nothing. No
device run was performed.

---

## 9. Memory (memory requirement)

| Checkpoint | YAMNet (Phase 17, device) | Teacher | Students |
|---|---|---|---|
| BEFORE LOAD | 333.3 MB | NOT MEASURED | NOT MEASURED |
| AFTER LOAD | 333.3 MB | NOT MEASURED | NOT MEASURED |
| AFTER N TRACKS | 333.3 MB | NOT MEASURED | NOT MEASURED |
| AFTER CLEANUP | 333.3 MB | NOT MEASURED | NOT MEASURED |
| AFTER IDLE | 333.3 MB | NOT MEASURED | NOT MEASURED |
| Net | +0.0 MB | — | — |
| **Classification** | **RELEASED** | **UNKNOWN** | **UNKNOWN** |

Nothing was loaded on device in Phase 19, so no new memory measurement
exists and the validated Phase 16 instrumentation was not modified. A
temporary PSS rise is not by itself called a leak; RETAINED requires
repeated evidence.

---

## 10. Comparison (Step 11)

| Model | Dim | Audio→Audio AUC | Text→Audio | Precision@K | MRR | Median inference | Memory | License |
|---|---|---|---|---|---|---|---|---|
| **YAMNet** | 1024 | **0.3125** (measured, Ph. 17) | NOT APPLICABLE | NOT MEASURED | NOT MEASURED | measured Ph. 17 | **RELEASED** | Apache-2.0 |
| LAION-CLAP | 512 | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | UNKNOWN | CC0 1.0 |
| DCLAP | 512 | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | UNKNOWN | **AGPL-3.0** |
| M2D-CLAP | UNKNOWN | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | UNKNOWN | UNKNOWN |
| Student-128 | 128 | NOT APPLICABLE (synthetic) | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT MEASURED | UNKNOWN | n/a |
| Student-256 | 256 | NOT APPLICABLE (synthetic) | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT MEASURED | UNKNOWN | n/a |
| Student-512 | 512 | NOT APPLICABLE (synthetic) | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT MEASURED | UNKNOWN | n/a |

Only the YAMNet row rests on real labelled music. The student rows are
marked NOT APPLICABLE rather than given their fixture numbers, because
placing a synthetic 1.0 beside a real 0.3125 in one table would invite
exactly the comparison that must not be made.

---

## 11. Licensing

| Model | License | Concern |
|---|---|---|
| LAION-CLAP | **CC0 1.0** (LICENSE file read directly) | **LICENSE REVIEW REQUIRED** for distillation |
| DCLAP | **AGPL-3.0** (LICENSE read via GitHub API) | **COPYLEFT BLOCKER** for a proprietary app |
| M2D-CLAP | UNKNOWN | LICENSE REVIEW REQUIRED |

**The distillation question is not settled.** CC0 places no restriction
on the teacher's outputs, which makes LAION-CLAP the most promising
route to an in-house student. But whether training on a model's outputs
creates obligations is a legal question with unsettled answers, and
this phase does **not** assume the permissive reading. **No commercial
compatibility is claimed.**

Distilling *from* DCLAP does not launder AGPL-3.0 — obligations attach
to the model being used.

---

## 12. Limitations

1. **Nothing musical was measured.** The dominant limitation.
2. Fixture results validate code only, and their group-AUC/P@1/MRR
   columns are saturated and therefore uninformative.
3. The real dataset has **5 unfilled placeholders**, including both
   `D_contrast` slots — the strongest contrast is missing.
4. The student consumes a fixed feature vector, not a log-mel trunk. A
   production student needs a real audio front end, which cannot be
   designed honestly without a teacher to distil from.
5. No device benchmark, no memory measurement, no ONNX-on-Android run.
6. Persian capability is unverified for every candidate.
7. `zenodo.org` is now blocked too, removing PANNs as a fallback.

---

## 13. Reproduction

```bash
# Environment (weights hosts are blocked; PyPI is not)
python3 -m venv /tmp/p19venv
/tmp/p19venv/bin/pip install torch numpy onnx onnxruntime onnxscript

# Dataset design
/tmp/p19venv/bin/python scripts/phase19/dataset/eval_dataset.py

# Pipeline unit tests (71 assertions, executed)
/tmp/p19venv/bin/python scripts/phase19/test_pipeline.py

# Distillation + ONNX export (artifacts are gitignored)
/tmp/p19venv/bin/python scripts/phase19/distillation/train_student.py \
    --epochs 400 --export-onnx-dir /tmp/p19onnx

# Registry / UI / honesty tests
npx tsx scripts/test-phase19-distillation.ts
```

Attempting a real teacher fails loudly, by design:

```bash
/tmp/p19venv/bin/python scripts/phase19/distillation/train_student.py \
    --teacher laion-clap-music        # raises TeacherUnavailable
```

---

## 14. Recommendation

**BLOCKED.** Awaiting human decision — no model selected.

**YAMNet stays.** It is still the only device-verified model, and its
measured AUC of 0.3125 still stands as the bar. Nothing in Phase 19
displaces it, because nothing in Phase 19 was measured on music.

Unblocking, in order:

1. Run from an environment with HuggingFace / GitHub-release-asset access.
2. Get a **legal** answer on (a) distilling from CC0 weights and
   (b) AGPL-3.0 before any DCLAP work.
3. Fill the 5 dataset placeholders, especially both `D_contrast` slots.
4. Re-run Steps 5–7 against the real teacher, then benchmark on device.
5. Only then compare against YAMNet and put a selection to a human.

**No production model was selected automatically.**
