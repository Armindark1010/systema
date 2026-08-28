"""
SYSTEMA — Phase 19 evaluation dataset design (Steps 3 & 4).

WHAT THIS IS
------------
The GROUP DESIGN for the Phase 19 evaluation set: which contrasts the
dataset must contain for a similarity measurement to be meaningful.

WHAT THIS IS NOT
----------------
It is NOT a set of labels. The groups below describe the intended
acoustic/semantic structure so a human can choose real tracks to fill
them. A group is a design slot; the ground truth is still the human
pair label recorded in the app.

THE RULE (Step 4)
-----------------
Pair labels are HUMAN judgements. They are never derived from artist
metadata, genre tags, filenames or folder structure. Doing so would
measure how tidy the metadata is and then report it as a claim about
the embedding — a different thing entirely, and the exact confusion
this project exists to avoid.

The `group` field here is used ONLY by the synthetic pipeline fixture,
which needs a known geometry to verify the training code against. It
is never used to label real music.

NOT RUN ON DEVICE. Offline tooling (Step 8).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DatasetTrack:
    """A slot in the evaluation design.

    track_id is "group/name" so the synthetic fixture can derive its
    geometry from the group. For real music, `real_track` names the
    actual file once a human has chosen it.
    """

    track_id: str
    group: str
    description: str
    real_track: str | None = None

    @property
    def is_placeholder(self) -> bool:
        """True when no real recording has been assigned yet."""
        return self.real_track is None


@dataclass(frozen=True)
class GroupSpec:
    group: str
    intent: str
    expected_within_group: str


@dataclass
class EvalDataset:
    tracks: list[DatasetTrack] = field(default_factory=list)
    groups: list[GroupSpec] = field(default_factory=list)

    @property
    def placeholder_count(self) -> int:
        return sum(1 for t in self.tracks if t.is_placeholder)

    @property
    def real_count(self) -> int:
        return sum(1 for t in self.tracks if not t.is_placeholder)


# The four contrast families required by Step 3.
GROUP_SPECS: list[GroupSpec] = [
    GroupSpec(
        group="A_same_recording",
        intent="Two encodes/copies of one recording.",
        expected_within_group="SAME",
    ),
    GroupSpec(
        group="B_same_artist_style",
        intent="Different songs by one artist with similar musical character.",
        expected_within_group="SIMILAR where a human agrees — not automatic.",
    ),
    GroupSpec(
        group="C1_calm_sad_persian_pop",
        intent="Calm/sad Persian pop across different artists.",
        expected_within_group="SIMILAR where a human agrees.",
    ),
    GroupSpec(
        group="C2_energetic_persian_pop",
        intent="Energetic/upbeat Persian pop across different artists.",
        expected_within_group="SIMILAR where a human agrees.",
    ),
    GroupSpec(
        group="C3_classical_iranian",
        intent="Traditional/classical Iranian music.",
        expected_within_group="SIMILAR where a human agrees.",
    ),
    GroupSpec(
        group="C4_instrumental_orchestral",
        intent="Instrumental / orchestral / soundtrack.",
        expected_within_group="SIMILAR where a human agrees.",
    ),
    GroupSpec(
        group="C5_electronic_remix",
        intent="Electronic / dance / remix.",
        expected_within_group="SIMILAR where a human agrees.",
    ),
    GroupSpec(
        group="D_contrast",
        intent=(
            "Deliberate far-apart pairings across the groups above "
            "(classical Iranian vs EDM, ballad vs aggressive, orchestral vs pop)."
        ),
        expected_within_group="DIFFERENT across groups — still human-confirmed.",
    ),
]


def build_dataset() -> EvalDataset:
    """The Phase 19 design.

    Tracks already present in the Phase 17 set are mapped to their real
    filenames; the rest are placeholders a human must fill. Placeholders
    are visible and counted rather than quietly padding the dataset.
    """
    tracks: list[DatasetTrack] = [
        # GROUP A — the one objectively-known relationship.
        DatasetTrack("A_same_recording/maste-cheshmat-a", "A_same_recording",
                     "Same recording, encode A.",
                     "maste Cheshmat [ GisoMusic.com ] — version A"),
        DatasetTrack("A_same_recording/maste-cheshmat-b", "A_same_recording",
                     "Same recording, encode B.",
                     "maste Cheshmat [ GisoMusic.com ] — version B"),

        # GROUP B — same artist / style.
        DatasetTrack("B_same_artist_style/moien-1", "B_same_artist_style",
                     "Artist with multiple tracks in the library.",
                     "moien - kabe (dj imi x dj ali zeylloos remix)"),
        DatasetTrack("B_same_artist_style/moien-2", "B_same_artist_style",
                     "Second track by the same artist — PLACEHOLDER."),

        # GROUP C1 — calm / sad Persian pop.
        DatasetTrack("C1_calm_sad_persian_pop/gharibe", "C1_calm_sad_persian_pop",
                     "Calm/sad candidate.", "Gharibe ~ Music-Fa.Com"),
        DatasetTrack("C1_calm_sad_persian_pop/ki-ashkato", "C1_calm_sad_persian_pop",
                     "Calm/sad candidate.", "Ki Ashkato Pak Mikone [ GisoMusic.com ]"),
        DatasetTrack("C1_calm_sad_persian_pop/bi-taabi", "C1_calm_sad_persian_pop",
                     "Calm/sad candidate.", "Bi Taabi"),

        # GROUP C2 — energetic Persian pop.
        DatasetTrack("C2_energetic_persian_pop/gholab", "C2_energetic_persian_pop",
                     "Energetic candidate.", "Gholab موزیکدل"),
        DatasetTrack("C2_energetic_persian_pop/gol-lale", "C2_energetic_persian_pop",
                     "Energetic candidate.", "Gol Lale Abbasi موزیکدل"),

        # GROUP C3 — classical / traditional Iranian.
        DatasetTrack("C3_classical_iranian/shame-mahtab", "C3_classical_iranian",
                     "Traditional candidate.", "01 Shame Mahtab"),
        DatasetTrack("C3_classical_iranian/chakavak", "C3_classical_iranian",
                     "Traditional candidate.", "Chakavak [ GisoMusic.com ]"),
        DatasetTrack("C3_classical_iranian/sayyad", "C3_classical_iranian",
                     "Traditional candidate.", "Sayyad"),

        # GROUP C4 — instrumental / orchestral.
        DatasetTrack("C4_instrumental_orchestral/got", "C4_instrumental_orchestral",
                     "Orchestral soundtrack.", "Game Of Thrones ~ UpMusic"),
        DatasetTrack("C4_instrumental_orchestral/second", "C4_instrumental_orchestral",
                     "Second orchestral/instrumental track — PLACEHOLDER."),

        # GROUP C5 — electronic / remix.
        DatasetTrack("C5_electronic_remix/remix-1", "C5_electronic_remix",
                     "Electronic/remix.", "To Make Eshghio Man"),
        DatasetTrack("C5_electronic_remix/remix-2", "C5_electronic_remix",
                     "Second electronic/EDM track — PLACEHOLDER."),

        # GROUP D — deliberate strong contrast.
        DatasetTrack("D_contrast/metal-or-edm", "D_contrast",
                     "Aggressive metal or hard EDM, maximal contrast — PLACEHOLDER."),
        DatasetTrack("D_contrast/acoustic-traditional", "D_contrast",
                     "Sparse acoustic traditional, maximal contrast — PLACEHOLDER."),
    ]
    return EvalDataset(tracks=tracks, groups=list(GROUP_SPECS))


# Step 6 query set. Human-written, spanning mood, tempo, style,
# instrumentation and combined natural language, in both scripts.
#
# The Persian queries are included because they are the actual product
# requirement, NOT because any teacher is known to handle them. Every
# Persian query is tagged so the report cannot imply verified support.
EVAL_QUERIES: list[dict] = [
    {"query": "calm sad Persian song", "lang": "en", "targets": ["C1_calm_sad_persian_pop"]},
    {"query": "energetic Persian pop", "lang": "en", "targets": ["C2_energetic_persian_pop"]},
    {"query": "traditional Iranian music", "lang": "en", "targets": ["C3_classical_iranian"]},
    {"query": "orchestral instrumental soundtrack", "lang": "en",
     "targets": ["C4_instrumental_orchestral"]},
    {"query": "electronic dance remix", "lang": "en", "targets": ["C5_electronic_remix"]},
    {"query": "slow emotional ballad with vocals", "lang": "en",
     "targets": ["C1_calm_sad_persian_pop"]},
    {"query": "غمگین و آروم", "lang": "fa", "targets": ["C1_calm_sad_persian_pop"],
     "support": "PERSIAN TEXT SUPPORT UNVERIFIED"},
    {"query": "موسیقی سنتی ایرانی", "lang": "fa", "targets": ["C3_classical_iranian"],
     "support": "PERSIAN TEXT SUPPORT UNVERIFIED"},
    {"query": "آهنگ شاد و پرانرژی", "lang": "fa", "targets": ["C2_energetic_persian_pop"],
     "support": "PERSIAN TEXT SUPPORT UNVERIFIED"},
    {"query": "آهنگ‌های کلاسیک ایرانی", "lang": "fa", "targets": ["C3_classical_iranian"],
     "support": "PERSIAN TEXT SUPPORT UNVERIFIED"},
]


if __name__ == "__main__":
    ds = build_dataset()
    print(f"groups : {len(ds.groups)}")
    print(f"tracks : {len(ds.tracks)} ({ds.real_count} real, {ds.placeholder_count} placeholder)")
    for g in ds.groups:
        members = [t for t in ds.tracks if t.group == g.group]
        real = sum(1 for t in members if not t.is_placeholder)
        print(f"  {g.group:34s} {real}/{len(members)} real")
    print(f"queries: {len(EVAL_QUERIES)} "
          f"({sum(1 for q in EVAL_QUERIES if q['lang'] == 'fa')} Persian, unverified)")
