"""
SYSTEMA — Phase 19 pipeline tests (executed, not grepped).

These run the actual Python that the distillation pipeline uses, so
that behaviour is proven rather than described. The most important
assertions are the REFUSALS: an unavailable teacher must raise, and a
dimension mismatch must fail loudly instead of being projected away.

Run:
    /tmp/p19venv/bin/python scripts/phase19/test_pipeline.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from teacher.teacher_adapter import (  # noqa: E402
    RealTeacher, SyntheticTeacher, TeacherOutputContract, TeacherUnavailable,
    l2_normalize, load_teacher,
)
from evaluation.metrics import (  # noqa: E402
    auc, cosine, mean_reciprocal_rank, overlap_fraction, precision_at_k,
    rank_items, recall_at_k, reciprocal_rank, describe_distribution,
)
from dataset.eval_dataset import EVAL_QUERIES, build_dataset  # noqa: E402

passed = 0
failed = 0
failures: list[str] = []


def ok(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        failures.append(f"{name} — {detail}" if detail else name)


def section(t: str) -> None:
    print(f"\n── {t}")


# ------------------------------------------------------------------
section("1. Teacher contract validation (Step 2)")

good = TeacherOutputContract("t", 512, 512, True, True)
ok("matching dims validate", good.validate() == 512)

try:
    TeacherOutputContract("t", 512, 768, True, True).validate()
    ok("mismatched dims raise", False, "no exception")
except ValueError as e:
    ok("mismatched dims raise", True)
    ok("refusal explains why projecting is wrong", "Refusing" in str(e), str(e)[:80])

try:
    TeacherOutputContract("t", 512, 512, False, True).validate()
    ok("unnormalised raises", False)
except ValueError:
    ok("unnormalised raises", True)

try:
    TeacherOutputContract("t", None, 512, True, True).validate()
    ok("unknown dim raises", False)
except TeacherUnavailable:
    ok("unknown dim raises", True)

try:
    TeacherOutputContract("t", 512, 512, True, False).validate()
    ok("audio-only model cannot claim a shared space", False)
except ValueError:
    ok("audio-only model cannot claim a shared space", True)

try:
    TeacherOutputContract("t", 0, 0, True, True).validate()
    ok("non-positive dim raises", False)
except ValueError:
    ok("non-positive dim raises", True)

# ------------------------------------------------------------------
section("2. Missing weights BLOCK rather than fabricate (failure rules)")

try:
    load_teacher("laion-clap-music", None, good)
    ok("missing weights raise", False, "returned a teacher")
except TeacherUnavailable as e:
    ok("missing weights raise", True)
    ok("message says WEIGHTS UNAVAILABLE", "WEIGHTS UNAVAILABLE" in str(e))
    ok("message promises no substitute embeddings",
       "no substitute" in str(e).lower())

try:
    load_teacher("t", "", good)
    ok("empty path also raises", False)
except TeacherUnavailable:
    ok("empty path also raises", True)

ok("RealTeacher declares itself real", RealTeacher.is_real_teacher is True)
ok("SyntheticTeacher declares itself NOT real",
   SyntheticTeacher.is_real_teacher is False)

rt = RealTeacher("t", "/nonexistent/weights.pt", good)
for meth, label in ((rt.embed_audio, "audio"), (rt.embed_text, "text")):
    try:
        meth("x")
        ok(f"unimplemented real {label} inference raises", False)
    except TeacherUnavailable:
        ok(f"unimplemented real {label} inference raises", True)

# ------------------------------------------------------------------
section("3. L2 normalisation")

v = l2_normalize([3.0, 4.0])
ok("unit norm", abs(math.sqrt(sum(x * x for x in v)) - 1.0) < 1e-12)
ok("direction preserved", abs(cosine([3.0, 4.0], v) - 1.0) < 1e-12)
ok("zero vector unchanged", l2_normalize([0.0, 0.0]) == [0.0, 0.0])
ok("already-normal stays normal",
   abs(math.sqrt(sum(x * x for x in l2_normalize(v))) - 1.0) < 1e-12)

# ------------------------------------------------------------------
section("4. Cosine")

ok("identical", abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-12)
ok("opposite", abs(cosine([1, 0], [-1, 0]) + 1) < 1e-12)
ok("orthogonal", abs(cosine([1, 0], [0, 1])) < 1e-12)
ok("zero-safe", cosine([0, 0], [1, 1]) == 0.0)
try:
    cosine([1, 2], [1, 2, 3])
    ok("dimension mismatch raises", False)
except ValueError as e:
    ok("dimension mismatch raises", True)
    ok("mismatch refuses cross-space comparison", "different spaces" in str(e))

# ------------------------------------------------------------------
section("5. AUC / overlap")

ok("perfect", auc([1.0, 0.9], [0.1, 0.0]) == 1.0)
ok("inverted", auc([0.0, 0.1], [0.9, 1.0]) == 0.0)
ok("ties", auc([0.5], [0.5]) == 0.5)
ok("empty -> NaN", math.isnan(auc([], [1.0])))
ok("below chance", auc([0.1], [0.9]) < 0.5)
ok("phase17 granularity", abs(20 / 64 - 0.3125) < 1e-12)
ok("disjoint distributions do not overlap",
   overlap_fraction([0.9, 1.0], [0.0, 0.1]) == 0.0)
ok("identical distributions overlap fully",
   abs(overlap_fraction([0.0, 1.0], [0.0, 1.0]) - 1.0) < 1e-12)

# ------------------------------------------------------------------
section("6. Ranking / retrieval metrics")

items = [("a", [1.0, 0.0]), ("b", [0.7, 0.7]), ("c", [-1.0, 0.0])]
r = rank_items([1.0, 0.0], items)
ok("descending", r[0][1] >= r[1][1] >= r[2][1])
ok("best first", r[0][0] == "a")
ok("worst last", r[-1][0] == "c")
ok("empty ranking", rank_items([1.0, 0.0], []) == [])

ids = ["a", "b", "c", "d", "e"]
ok("P@1 hit", precision_at_k(ids, {"a"}, 1) == 1.0)
ok("P@1 miss", precision_at_k(ids, {"b"}, 1) == 0.0)
ok("P@3", abs(precision_at_k(ids, {"a", "c"}, 3) - 2 / 3) < 1e-12)
ok("P@K empty list", precision_at_k([], {"a"}, 3) == 0.0)
try:
    precision_at_k(ids, {"a"}, 0)
    ok("k<=0 raises", False)
except ValueError:
    ok("k<=0 raises", True)

ok("recall@5 full", recall_at_k(ids, {"a", "b"}, 5) == 1.0)
ok("recall@1 partial", recall_at_k(ids, {"a", "b"}, 1) == 0.5)
ok("recall with no relevant -> NaN", math.isnan(recall_at_k(ids, set(), 3)))

ok("RR first", reciprocal_rank(ids, {"a"}) == 1.0)
ok("RR third", abs(reciprocal_rank(ids, {"c"}) - 1 / 3) < 1e-12)
ok("RR none", reciprocal_rank(ids, {"z"}) == 0.0)
ok("MRR averages", abs(mean_reciprocal_rank(
    [(ids, {"a"}), (ids, {"c"})]) - (1 + 1 / 3) / 2) < 1e-12)
ok("MRR of nothing -> NaN", math.isnan(mean_reciprocal_rank([])))

d = describe_distribution([1.0, 2.0, 3.0])
ok("distribution mean", abs(d["mean"] - 2.0) < 1e-12)
ok("distribution median", abs(d["median"] - 2.0) < 1e-12)
ok("empty distribution -> NaN not 0", math.isnan(describe_distribution([])["mean"]))

# ------------------------------------------------------------------
section("7. Dataset design (Steps 3-4)")

ds = build_dataset()
groups = {t.group for t in ds.tracks}
ok("all four contrast families present",
   {"A_same_recording", "B_same_artist_style", "D_contrast"} <= groups)
ok("mood groups present", sum(1 for g in groups if g.startswith("C")) >= 4)
ok("dataset has tracks", len(ds.tracks) >= 15)
ok("placeholders are reported honestly", ds.placeholder_count > 0)
ok("real tracks counted separately", ds.real_count > 0)
ok("real + placeholder == total",
   ds.real_count + ds.placeholder_count == len(ds.tracks))
ok("same-recording group has exactly two members",
   sum(1 for t in ds.tracks if t.group == "A_same_recording") == 2)
ok("placeholder detection is per-track",
   any(t.is_placeholder for t in ds.tracks)
   and any(not t.is_placeholder for t in ds.tracks))

fa = [q for q in EVAL_QUERIES if q["lang"] == "fa"]
en = [q for q in EVAL_QUERIES if q["lang"] == "en"]
ok("Persian queries exist", len(fa) >= 4)
ok("English queries exist", len(en) >= 5)
ok("every Persian query is marked unverified",
   all("UNVERIFIED" in q.get("support", "") for q in fa))
ok("every query names its target group", all(q["targets"] for q in EVAL_QUERIES))

# ------------------------------------------------------------------
section("8. Synthetic fixture is a fixture, not a teacher")

st = SyntheticTeacher(dim=64)
e1 = st.embed_audio("G1/track-a")
e2 = st.embed_audio("G1/track-b")
e3 = st.embed_audio("G2/track-c")
ok("fixture output is unit norm",
   abs(math.sqrt(sum(x * x for x in e1)) - 1.0) < 1e-9)
ok("fixture output has requested dim", len(e1) == 64)
ok("fixture is deterministic", st.embed_audio("G1/track-a") == e1)
ok("same group is closer than different group",
   cosine(e1, e2) > cosine(e1, e3),
   f"same={cosine(e1, e2):.3f} diff={cosine(e1, e3):.3f}")
ok("fixture never claims to be real", st.is_real_teacher is False)
ok("fixture id is labelled SYNTHETIC", "SYNTHETIC" in st.teacher_id)

# ------------------------------------------------------------------
print("\n" + "─" * 52)
print(f"{passed} passed, {failed} failed")
if failures:
    print("\nFailures:")
    for f in failures:
        print(f"  ✗ {f}")
sys.exit(0 if failed == 0 else 1)
