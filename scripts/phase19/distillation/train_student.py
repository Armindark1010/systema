"""
SYSTEMA — Phase 19 distillation experiment (Steps 7, 8, 9).

WHAT THIS DOES
--------------
Trains a small student to approximate a teacher's L2-normalised audio
embedding, at each candidate dimension (128 / 256 / 512), and reports
how much of the teacher's RANKING quality each student preserves.

Ranking retention is the metric that matters. A student can have a
mediocre cosine-to-teacher and still rank tracks identically, and it
is the ranking that a search or similarity feature consumes.

STEP 8 — NOT ON DEVICE
----------------------
This is offline tooling. It runs under a desktop Python with PyTorch
and never executes inside the Android app, which stays inference-only.

WHAT THIS RUN PROVES, AND WHAT IT DOES NOT
------------------------------------------
Executed against the SYNTHETIC teacher fixture, this proves the
pipeline is correct: losses converge, students learn, ranking metrics
are computed consistently, and an ONNX graph is exported with the
declared contract.

It proves NOTHING about music. The synthetic teacher has a known
constructed geometry; recovering it demonstrates working code, not a
working music embedding. Every artifact from a synthetic run is tagged
SYNTHETIC and `teacher_is_real: false`, so no number here may be
quoted as a music result.

Run:
    /tmp/p19venv/bin/python scripts/phase19/distillation/train_student.py
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "phase19"))

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402

from teacher.teacher_adapter import SyntheticTeacher  # noqa: E402
from evaluation.metrics import (  # noqa: E402
    auc, cosine, mean_reciprocal_rank, precision_at_k, rank_items,
)
from dataset.eval_dataset import build_dataset  # noqa: E402


# ------------------------------------------------------------------
# The student.
# ------------------------------------------------------------------

class StudentEncoder(nn.Module):
    """A deliberately small encoder over a fixed input feature vector.

    NOTE ON SCOPE: a production student would consume a log-mel
    spectrogram through a conv trunk. That trunk cannot be designed
    honestly without a real teacher to distil from, so this model
    takes a fixed-width input feature and focuses on the part the
    experiment can actually answer: how much ranking quality survives
    a dimensionality reduction to 128/256/512. The input contract is
    declared in the exported metadata either way.
    """

    def __init__(self, in_dim: int, out_dim: int, hidden: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
            nn.Linear(hidden, hidden),
            nn.GELU(),
            nn.Linear(hidden, out_dim),
        )
        self.out_dim = out_dim

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # L2 normalisation is INSIDE the graph so the exported ONNX
        # cannot be used without it. Leaving it to the caller is how
        # an un-normalised embedding reaches a cosine computation.
        return torch.nn.functional.normalize(self.net(x), p=2, dim=-1)


def distillation_loss(student_emb: torch.Tensor, teacher_emb: torch.Tensor,
                      use_mse: bool = True) -> torch.Tensor:
    """Cosine embedding loss, optionally plus MSE on normalised vectors.

    When dimensions differ the two cannot be compared directly, so the
    student is scored against the teacher's GRAM MATRIX instead: the
    pairwise similarity structure is what we want preserved, and it is
    dimension-independent. That is the honest way to distil across a
    dimensionality change — projecting the teacher down to match would
    itself be a modelling decision that biases the comparison.
    """
    s_gram = student_emb @ student_emb.T
    t_gram = teacher_emb @ teacher_emb.T
    loss = 1.0 - torch.nn.functional.cosine_similarity(
        s_gram.flatten().unsqueeze(0), t_gram.flatten().unsqueeze(0)
    ).mean()
    if use_mse:
        loss = loss + torch.nn.functional.mse_loss(s_gram, t_gram)
    return loss


def ranking_agreement(student_vecs: dict[str, list[float]],
                      teacher_vecs: dict[str, list[float]]) -> float:
    """Fraction of queries where the student's top-1 neighbour matches
    the teacher's top-1 neighbour. The most direct readout of
    'did the student keep the teacher's ranking?'."""
    ids = sorted(student_vecs)
    if len(ids) < 2:
        return float("nan")
    agree = 0
    for q in ids:
        others = [(i, teacher_vecs[i]) for i in ids if i != q]
        t_top = rank_items(teacher_vecs[q], others)[0][0]
        others_s = [(i, student_vecs[i]) for i in ids if i != q]
        s_top = rank_items(student_vecs[q], others_s)[0][0]
        if t_top == s_top:
            agree += 1
    return agree / len(ids)


def group_auc(vecs: dict[str, list[float]], groups: dict[str, str]) -> float:
    """AUC separating same-group from different-group pairs."""
    pos, neg = [], []
    ids = sorted(vecs)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            c = cosine(vecs[a], vecs[b])
            (pos if groups[a] == groups[b] else neg).append(c)
    return auc(pos, neg)


def retrieval_metrics(vecs: dict[str, list[float]], groups: dict[str, str]) -> dict:
    """Precision@1/@3 and MRR using same-group membership as relevance."""
    ids = sorted(vecs)
    p1, p3, rankings = [], [], []
    for q in ids:
        relevant = {i for i in ids if i != q and groups[i] == groups[q]}
        if not relevant:
            continue
        others = [(i, vecs[i]) for i in ids if i != q]
        ranked = [tid for tid, _ in rank_items(vecs[q], others)]
        p1.append(precision_at_k(ranked, relevant, 1))
        p3.append(precision_at_k(ranked, relevant, 3))
        rankings.append((ranked, relevant))
    return {
        "precision_at_1": sum(p1) / len(p1) if p1 else float("nan"),
        "precision_at_3": sum(p3) / len(p3) if p3 else float("nan"),
        "mrr": mean_reciprocal_rank(rankings),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--teacher", default="synthetic",
                    help="'synthetic' (pipeline fixture) or a real teacher id")
    ap.add_argument("--weights", default=None, help="path to real teacher weights")
    ap.add_argument("--epochs", type=int, default=400)
    ap.add_argument("--seed", type=int, default=19)
    ap.add_argument("--jitter", type=float, default=0.9,
                    help="fixture difficulty: higher = groups overlap more, "
                         "so a trivially-correct result is not guaranteed")
    ap.add_argument("--out", default=str(ROOT / "docs" / "phase19-distillation-results.json"))
    ap.add_argument("--export-onnx-dir", default=None)
    ap.add_argument("--fixture-tracks-per-group", type=int, default=40,
                    help="synthetic cohort size per group; the 18-slot real "
                         "design is far too small to measure generalisation")
    ap.add_argument("--holdout-frac", type=float, default=0.35)
    args = ap.parse_args()

    torch.manual_seed(args.seed)

    if args.teacher != "synthetic":
        from teacher.teacher_adapter import TeacherOutputContract, load_teacher
        contract = TeacherOutputContract(args.teacher, None, None, True, True)
        # Raises TeacherUnavailable when weights are missing. Deliberate:
        # the run must stop rather than fall back to the fixture.
        load_teacher(args.teacher, args.weights, contract)
        return 2

    teacher = SyntheticTeacher(dim=512, jitter=args.jitter)
    dataset = build_dataset()
    real_group_names = sorted({t.group for t in dataset.tracks})

    # The real design has 18 slots. A 230k-parameter student memorises
    # 18 vectors outright, which makes every candidate score a perfect
    # 1.0 and tells us nothing about which dimension is better. So the
    # FIXTURE cohort is enlarged and split, and all reported metrics
    # come from tracks the student never saw.
    track_ids, groups = [], {}
    for g in real_group_names:
        for k in range(args.fixture_tracks_per_group):
            tid = f"{g}/fixture-{k:03d}"
            track_ids.append(tid)
            groups[tid] = g

    rng = torch.Generator().manual_seed(args.seed)
    perm = torch.randperm(len(track_ids), generator=rng).tolist()
    n_hold = max(2, int(len(track_ids) * args.holdout_frac))
    hold_idx = set(perm[:n_hold])
    train_ids = [t for i, t in enumerate(track_ids) if i not in hold_idx]
    held_ids = [t for i, t in enumerate(track_ids) if i in hold_idx]

    print(f"teacher      : {teacher.teacher_id} (SYNTHETIC FIXTURE — not a music model)")
    print(f"fixture jitter: {args.jitter} (higher = harder/overlapping groups)")
    print(f"tracks       : {len(track_ids)} across {len(set(groups.values()))} groups")

    teacher_vecs = {tid: teacher.embed_audio(tid) for tid in track_ids}
    T = torch.tensor([teacher_vecs[t] for t in train_ids], dtype=torch.float32)

    # Student input: a fixed feature per track, deterministic and
    # independent of the teacher's output space, so the student cannot
    # trivially copy the target.
    feat_dim = 128
    featgen = SyntheticTeacher(dim=feat_dim, jitter=0.6)
    X = torch.tensor([featgen.embed_audio(t) for t in train_ids], dtype=torch.float32)
    X_held = torch.tensor([featgen.embed_audio(t) for t in held_ids], dtype=torch.float32)

    held_teacher = {t: teacher_vecs[t] for t in held_ids}
    t_auc = group_auc(held_teacher, groups)
    t_ret = retrieval_metrics(held_teacher, groups)
    print(f"train={len(train_ids)}  held-out={len(held_ids)} (all metrics are HELD-OUT)")
    print(f"\nTEACHER  auc={t_auc:.4f}  P@1={t_ret['precision_at_1']:.4f}  "
          f"MRR={t_ret['mrr']:.4f}")

    results = {
        "teacher_is_real": teacher.is_real_teacher,
        "teacher_id": teacher.teacher_id,
        "warning": (
            "SYNTHETIC TEACHER. These numbers validate the distillation "
            "PIPELINE only. They are not a music-similarity result and must "
            "never be quoted as one."
        ),
        "fixture_jitter": args.jitter,
        "metrics_are_held_out": True,
        "fixture_tracks_total": len(track_ids),
        "fixture_train": len(train_ids),
        "fixture_heldout": len(held_ids),
        "dataset_tracks": len(dataset.tracks),
        "dataset_groups": sorted(set(groups.values())),
        "teacher": {"dim": 512, "auc": t_auc, **t_ret},
        "students": {},
    }

    for dim in (128, 256, 512):
        model = StudentEncoder(feat_dim, dim)
        opt = torch.optim.Adam(model.parameters(), lr=1e-3)
        losses = []
        for ep in range(args.epochs):
            opt.zero_grad()
            out = model(X)
            loss = distillation_loss(out, T)
            loss.backward()
            opt.step()
            losses.append(loss.detach().item())

        model.eval()
        with torch.no_grad():
            S = model(X_held)
        student_vecs = {t: S[i].tolist() for i, t in enumerate(held_ids)}

        s_auc = group_auc(student_vecs, groups)
        s_ret = retrieval_metrics(student_vecs, groups)
        agree = ranking_agreement(student_vecs, held_teacher)
        params = sum(p.numel() for p in model.parameters())

        results["students"][f"student-{dim}"] = {
            "dim": dim,
            "params": params,
            "first_loss": losses[0],
            "final_loss": losses[-1],
            "auc": s_auc,
            "top1_agreement_with_teacher": agree,
            **s_ret,
        }
        print(f"STUDENT-{dim:<4} auc={s_auc:.4f}  P@1={s_ret['precision_at_1']:.4f}  "
              f"MRR={s_ret['mrr']:.4f}  top1-agree={agree:.4f}  "
              f"loss {losses[0]:.4f}->{losses[-1]:.4f}  params={params:,}")

        if args.export_onnx_dir:
            outdir = Path(args.export_onnx_dir)
            outdir.mkdir(parents=True, exist_ok=True)
            path = outdir / f"student-{dim}.onnx"
            # dynamo=False keeps the legacy exporter, which emits a
            # single self-contained file at opset 17. The dynamo path
            # split weights into an external .onnx.data sidecar and
            # failed opset conversion, which would ship a model whose
            # weights live in a second file the Android loader is not
            # told about.
            torch.onnx.export(
                model, X[:1], str(path),
                input_names=["features"], output_names=["embedding"],
                dynamic_axes={"features": {0: "batch"}, "embedding": {0: "batch"}},
                opset_version=17, dynamo=False,
            )
            results["students"][f"student-{dim}"]["onnx_path"] = str(path)
            results["students"][f"student-{dim}"]["onnx_bytes"] = path.stat().st_size

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(results, indent=2))
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
