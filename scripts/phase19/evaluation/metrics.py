"""
SYSTEMA — Phase 19 ranking metrics (Steps 5, 6, 11).

Cosine, AUC, Precision@K, Recall@K and MRR, implemented once so the
teacher, the students and YAMNet are all scored by identical code.
Using the same implementation for every model is what makes the
Step 11 comparison apples-to-apples.

NO THRESHOLDS. Nothing here converts a cosine into a yes/no decision.
Every metric is rank-based, which is the property the brief asks for:
a model can have systematically high or low cosines and still rank
correctly, and ranking is what a search feature actually needs.

NOT RUN ON DEVICE. Offline evaluation tooling (Step 8).
"""

from __future__ import annotations

import math
from typing import Sequence


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def norm(a: Sequence[float]) -> float:
    return math.sqrt(dot(a, a))


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity. Raises on dimension mismatch rather than
    truncating — a silent zip() truncation would compare two different
    spaces and return a plausible number."""
    if len(a) != len(b):
        raise ValueError(
            f"dimension mismatch: {len(a)} vs {len(b)}. Refusing to compare "
            f"vectors from different spaces."
        )
    d = norm(a) * norm(b)
    if d == 0.0:
        return 0.0
    return dot(a, b) / d


def auc(positives: Sequence[float], negatives: Sequence[float]) -> float:
    """Rank-based AUC: P(random positive scores above random negative),
    ties counted 0.5. Returns NaN when a class is empty — NOT 0.5,
    because "undefined" and "chance" are different findings."""
    if not positives or not negatives:
        return float("nan")
    wins = 0.0
    for p in positives:
        for n in negatives:
            if p > n:
                wins += 1.0
            elif p == n:
                wins += 0.5
    return wins / (len(positives) * len(negatives))


def overlap_fraction(positives: Sequence[float], negatives: Sequence[float]) -> float:
    """Fraction of the two distributions' ranges that overlap.

    Reported alongside AUC because Phase 17's headline finding was
    HEAVY OVERLAP, and a single AUC number hides it.
    """
    if not positives or not negatives:
        return float("nan")
    lo = max(min(positives), min(negatives))
    hi = min(max(positives), max(negatives))
    if hi <= lo:
        return 0.0
    total_lo = min(min(positives), min(negatives))
    total_hi = max(max(positives), max(negatives))
    span = total_hi - total_lo
    return 0.0 if span == 0 else (hi - lo) / span


def rank_items(query: Sequence[float],
               items: Sequence[tuple[str, Sequence[float]]]) -> list[tuple[str, float]]:
    """Rank items by cosine, descending. Ties break by id for determinism."""
    scored = [(tid, cosine(query, vec)) for tid, vec in items]
    scored.sort(key=lambda kv: (-kv[1], kv[0]))
    return scored


def precision_at_k(ranked_ids: Sequence[str], relevant: set[str], k: int) -> float:
    if k <= 0:
        raise ValueError("k must be positive")
    top = ranked_ids[:k]
    if not top:
        return 0.0
    return sum(1 for t in top if t in relevant) / len(top)


def recall_at_k(ranked_ids: Sequence[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return float("nan")
    top = set(ranked_ids[:k])
    return len(top & relevant) / len(relevant)


def reciprocal_rank(ranked_ids: Sequence[str], relevant: set[str]) -> float:
    for i, t in enumerate(ranked_ids):
        if t in relevant:
            return 1.0 / (i + 1)
    return 0.0


def mean_reciprocal_rank(rankings: Sequence[tuple[Sequence[str], set[str]]]) -> float:
    if not rankings:
        return float("nan")
    return sum(reciprocal_rank(r, rel) for r, rel in rankings) / len(rankings)


def describe_distribution(values: Sequence[float]) -> dict:
    """Mean/median/min/max. Returns UNKNOWNs as NaN rather than 0."""
    if not values:
        return {"count": 0, "mean": float("nan"), "median": float("nan"),
                "min": float("nan"), "max": float("nan")}
    s = sorted(values)
    n = len(s)
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    return {
        "count": n,
        "mean": sum(s) / n,
        "median": median,
        "min": s[0],
        "max": s[-1],
    }
