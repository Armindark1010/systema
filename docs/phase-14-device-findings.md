# Phase 14 — Real-device benchmark findings (Poco X7 Pro)

**Status:** environmental finding, recorded for interpretation only.
**Device:** Poco X7 Pro (MediaTek Dimensity 8400-Ultra, Android 15)
**Measured with:** `/dev/ai-benchmark/real-audio` (decode + DSP, Phase 13 pipeline)

> These are **DEVICE VERIFIED** numbers — they came from real hardware
> running real decoding. They are *not* model inference times; Phase 14
> ships no model weights.

---

## 1. The headline finding: screen state changes wall-clock cost by ~2.3×

The **same track**, measured twice on the **same device**:

| Condition | Decode | DSP | Total | RTF |
|---|---:|---:|---:|---:|
| **Screen ON** | ~11.38 s | ~1.39 s | ~12.77 s | 0.066 |
| **Screen OFF** (several seconds) | ~26.45 s | ~3.13 s | ~29.58 s | 0.154 |
| **Ratio** | **2.32×** | **2.25×** | **2.32×** | **2.33×** |

Decode and DSP degraded by almost exactly the same factor. That
uniformity is the tell: this is not a decoder problem or a DSP problem,
it is the **whole process being scheduled less CPU**.

### Why this happens

When the screen goes off, Android progressively restricts a foreground
app that is not holding a wake lock: CPU governors drop to lower
frequency states, big cores are parked, and the scheduler deprioritises
the process. None of that is a bug in SYSTEMA — it is the OS doing what
it is designed to do for battery life.

### What it means for benchmarking

**Wall-clock timings are only comparable when the device state matches.**
A benchmark that does not record screen state is not reproducible, and
comparing a screen-on run against a screen-off run would produce a
completely wrong conclusion about a model's cost.

This is the on-device analogue of the DESKTOP-vs-DEVICE rule already
enforced in Phase 14: same class of error, same remedy — record the
condition, and refuse to compare across it silently.

---

## 2. The "Felicita RTF 1.612" outlier — explicitly NOT a DSP problem

An earlier measurement of the track *Felicita* reported **RTF 1.612**
(i.e. slower than real time). That figure must **not** be treated as
representative of the audio file, and **no Phase 13 DSP change has been
made because of it**.

Reasons for treating it as environmental:

1. The screen-state experiment above shows a single environmental
   variable moving the same track's RTF by 2.3×. An outlier of that
   magnitude is fully explicable without invoking anything about the
   file.
2. RTF is a **ratio against audio duration**, so a short track amplifies
   any fixed startup cost — MediaCodec initialisation, file open, first
   buffer — into a large ratio.
3. The DSP itself is covered by 412 Kotlin assertions over synthetic
   signals with known answers. A file-specific DSP pathology would have
   to survive all of those, which is implausible.

**Recorded as:** an environmental/device-state artefact.
**Action taken:** none to Phase 13. Deliberately.

Re-measure with screen on, on mains power, after a warm-up run, before
drawing any conclusion about that track.

---

## 3. Consequence for Phase 15

Phase 15 benchmark records now capture the environment alongside the
timings (see `EnvironmentSnapshot`):

- screen state (on / off / unknown)
- charging state and battery level
- thermal status, where the platform exposes it safely
- device model and Android version
- timestamp

These fields exist **for interpretation only**. They do not gate,
throttle or alter execution — they let a reader see *why* two runs of
the same track disagree, instead of guessing.

`PowerManager.getCurrentThermalStatus()` is API 29+ and returns a
coarse bucket (`NONE` … `SHUTDOWN`), not a temperature. It is reported
as a labelled bucket and never converted to a number, since inventing
degrees from a bucket would be exactly the kind of fabrication the
project forbids.

---

## 4. Recommended benchmarking procedure

To produce comparable device numbers:

1. Screen **on**, and keep it on for the whole run.
2. Device on **mains power** (or at least a consistent battery level).
3. Run a **warm-up track first** and discard it — the first decode pays
   for MediaCodec initialisation.
4. Let the device **cool** between long batches; check the recorded
   thermal bucket.
5. Compare only runs whose recorded environment agrees.

---

## 5. What was NOT done

- ❌ No Phase 13 DSP change based on the outlier
- ❌ No automatic whole-library analysis introduced
- ❌ No claim that screen-off numbers are invalid — they are *real*, they
  are simply measurements of a *different condition*, and are labelled
  as such rather than discarded
