"""
SYSTEMA — Phase 19 teacher adapter (Steps 2 & 5).

WHAT THIS IS
------------
The boundary between the distillation pipeline and a real teacher
model. It defines the contract, validates it, and REFUSES to proceed
when a teacher cannot honestly be loaded.

THE RULE THIS FILE ENFORCES
---------------------------
When weights are unavailable, this module raises TeacherUnavailable.
It does NOT return random vectors that happen to have the right shape.

That distinction is the whole point. Random 512-d vectors would flow
through the rest of the pipeline perfectly: they normalise, they
produce a cosine matrix, they yield an AUC near 0.5, and they would
render in the UI as a completed experiment. The output would be
indistinguishable from a real result to anyone reading the report.
So the refusal has to happen HERE, at the source, not be left to
someone downstream noticing.

THE SYNTHETIC TEACHER IS NOT A FAKE TEACHER
-------------------------------------------
`SyntheticTeacher` exists and is used, but it is not a stand-in for a
music model and is never reported as one. It is a PIPELINE TEST
FIXTURE with a known, deliberately-constructed geometry: embeddings
are generated from group identity, so a correct implementation MUST
recover near-perfect ranking. If the pipeline scores poorly on it, the
pipeline is broken. It says nothing whatsoever about music, it is
labelled SYNTHETIC everywhere it appears, and `is_real_teacher` is
False so no result derived from it can be mistaken for a measurement.

NOT RUN ON DEVICE. This is offline tooling (Step 8).
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Protocol, Sequence


class TeacherUnavailable(RuntimeError):
    """Raised when a teacher cannot be loaded. Never substituted for."""


@dataclass(frozen=True)
class TeacherOutputContract:
    """See Step 2 of the brief."""

    teacher_id: str
    audio_dim: int | None
    text_dim: int | None
    l2_normalized: bool
    supports_text: bool

    def validate(self) -> int:
        """Return the shared dimension, or raise.

        Refuses to project one space into the other to force agreement.
        """
        if self.audio_dim is None or self.text_dim is None:
            raise TeacherUnavailable(
                f"{self.teacher_id}: dimensions not both known "
                f"(audio={self.audio_dim}, text={self.text_dim}); a shared "
                f"space cannot be asserted from unknowns."
            )
        if self.audio_dim <= 0 or self.text_dim <= 0:
            raise ValueError(f"{self.teacher_id}: non-positive dimension.")
        if not self.supports_text:
            raise ValueError(
                f"{self.teacher_id}: declares no text encoder, so it has no "
                f"shared audio/text space to validate."
            )
        if self.audio_dim != self.text_dim:
            raise ValueError(
                f"{self.teacher_id}: audio dim {self.audio_dim} != text dim "
                f"{self.text_dim}. These are different spaces. Refusing to "
                f"insert a projection to make them agree — the resulting "
                f"cosine would be a meaningless number that looks valid."
            )
        if not self.l2_normalized:
            raise ValueError(
                f"{self.teacher_id}: embeddings must be L2-normalised before "
                f"cosine comparison."
            )
        return self.audio_dim


def l2_normalize(vec: Sequence[float]) -> list[float]:
    """L2-normalise. A zero vector is returned unchanged, not divided by 0."""
    n = math.sqrt(sum(v * v for v in vec))
    if n == 0.0:
        return list(vec)
    return [v / n for v in vec]


class Teacher(Protocol):
    teacher_id: str
    is_real_teacher: bool

    def embed_audio(self, track_id: str) -> list[float]: ...
    def embed_text(self, text: str) -> list[float]: ...


class RealTeacher:
    """A teacher backed by actual downloaded weights.

    Constructing one without weights raises. There is deliberately no
    fallback path: an unavailable teacher must stop the experiment.
    """

    is_real_teacher = True

    def __init__(self, teacher_id: str, weights_path: str | None, contract: TeacherOutputContract):
        if not weights_path:
            raise TeacherUnavailable(
                f"BLOCKED — WEIGHTS UNAVAILABLE for {teacher_id}. No inference "
                f"will be attempted and no substitute embeddings will be "
                f"generated."
            )
        self.teacher_id = teacher_id
        self.weights_path = weights_path
        self.shared_dim = contract.validate()

    def embed_audio(self, track_id: str) -> list[float]:  # pragma: no cover
        raise TeacherUnavailable(
            "Real teacher inference is unimplemented because no weights could "
            "be obtained to develop or verify it against."
        )

    def embed_text(self, text: str) -> list[float]:  # pragma: no cover
        raise TeacherUnavailable(
            "Real teacher inference is unimplemented because no weights could "
            "be obtained to develop or verify it against."
        )


class SyntheticTeacher:
    """PIPELINE TEST FIXTURE — not a music model. See module docstring.

    Embeddings are a deterministic function of the GROUP a track
    belongs to plus a small per-track perturbation. That gives a known
    ground-truth geometry: same group => high cosine, different group
    => low. It exists so the training/evaluation code can be proven
    correct in the absence of a teacher.
    """

    is_real_teacher = False

    def __init__(self, dim: int = 512, jitter: float = 0.25):
        self.teacher_id = f"SYNTHETIC-{dim}"
        self.dim = dim
        self.jitter = jitter

    def _seeded(self, key: str, dim: int) -> list[float]:
        """Deterministic pseudo-random unit vector from a string key."""
        out: list[float] = []
        counter = 0
        while len(out) < dim:
            h = hashlib.sha256(f"{key}:{counter}".encode()).digest()
            for i in range(0, len(h), 4):
                if len(out) >= dim:
                    break
                v = int.from_bytes(h[i:i + 4], "big") / 0xFFFFFFFF
                out.append(v * 2.0 - 1.0)
            counter += 1
        return out

    def embed_audio(self, track_id: str) -> list[float]:
        """track_id must be "group/name" so the group defines the geometry."""
        group = track_id.split("/", 1)[0]
        base = self._seeded(f"group:{group}", self.dim)
        noise = self._seeded(f"track:{track_id}", self.dim)
        mixed = [b + self.jitter * n for b, n in zip(base, noise)]
        return l2_normalize(mixed)

    def embed_text(self, text: str) -> list[float]:
        """Text maps to the group it names, so text->audio is checkable."""
        return l2_normalize(self._seeded(f"group:{text}", self.dim))


def load_teacher(teacher_id: str, weights_path: str | None,
                 contract: TeacherOutputContract) -> Teacher:
    """Load a real teacher or raise TeacherUnavailable. Never silently
    downgrades to the synthetic fixture."""
    return RealTeacher(teacher_id, weights_path, contract)
