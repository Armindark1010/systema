/**
 * SYSTEMA — Phase 19 teacher-model registry (Steps 1 & 2).
 *
 * WHAT THIS FILE IS
 * -----------------
 * A registry of candidate TEACHER models for distillation, plus the
 * explicit output contract a teacher must satisfy before any
 * distillation experiment is allowed to run.
 *
 * THE EVIDENCE RULE
 * -----------------
 * Every field carries an `Evidence` grade, and the grades are not
 * decoration — they are the point:
 *
 *   FACT       — read from a primary source (package config, LICENSE
 *                file, repository API) during Phase 18/19.
 *   MEASURED   — SYSTEMA executed something and recorded the number.
 *   UNVERIFIED — published or claimed, never checked here.
 *   BLOCKED    — could not be established because something prevented it.
 *
 * A published figure NEVER becomes MEASURED by being copied into a
 * tidy table. Phase 17 already demonstrated the cost of that
 * conflation: YAMNet is a "strong" model on paper and scored AUC
 * 0.3125 on real labelled music.
 *
 * NOTHING IN THIS FILE EXECUTES A MODEL.
 */

export type Evidence = 'FACT' | 'MEASURED' | 'UNVERIFIED' | 'BLOCKED'

/** A value plus how we know it. The grade travels with the value. */
export interface Graded<T> {
  readonly value: T
  readonly evidence: Evidence
  readonly note?: string
}

export function graded<T>(value: T, evidence: Evidence, note?: string): Graded<T> {
  return note === undefined ? { value, evidence } : { value, evidence, note }
}

/** Whether the weights can actually be fetched in this environment. */
export type WeightsAvailability =
  | 'OBTAINABLE'
  | 'BLOCKED_NETWORK'
  | 'BLOCKED_LICENSE'
  | 'UNKNOWN'

/** Whether the model can serve as a distillation teacher at all. */
export type TeacherViability =
  | 'VIABLE'
  | 'VIABLE_PENDING_LEGAL_REVIEW'
  | 'BLOCKED'
  | 'UNKNOWN'

export type LicenseConcern =
  | 'NONE'
  | 'ATTRIBUTION_REQUIRED'
  | 'COPYLEFT_BLOCKER'
  | 'LICENSE_REVIEW_REQUIRED'
  | 'UNKNOWN'

/**
 * Persian text support. Phase 19 explicitly refuses to claim this
 * without evidence: a CLAP trained on English audio captions has no
 * established Persian capability, and asserting one because the
 * tokenizer accepts the bytes would be a fabrication.
 */
export type PersianSupport = 'SUPPORTED' | 'EXPERIMENTAL' | 'UNVERIFIED' | 'NOT_SUPPORTED'

export interface TeacherModel {
  readonly teacherId: string
  readonly displayName: string
  readonly checkpoint: Graded<string>
  readonly audioEmbeddingDim: Graded<number | null>
  readonly textEmbeddingDim: Graded<number | null>
  readonly sharedEmbeddingDim: Graded<number | null>
  readonly inputSampleRateHz: Graded<number | null>
  readonly audioWindowSeconds: Graded<number | null>
  readonly license: Graded<string>
  readonly modelSizeMb: Graded<number | null>
  readonly onnxAvailable: Graded<string>
  readonly officialSource: string
  readonly weightsAvailability: WeightsAvailability
  readonly weightsNote: string
  readonly teacherViability: TeacherViability
  readonly distillable: Graded<string>
  readonly licenseConcern: LicenseConcern
  readonly persianTextSupport: PersianSupport
  readonly persianNote: string
  /** Populated ONLY by a real run. */
  readonly measuredAudioAudio: string
  readonly measuredTextAudio: string
}

/**
 * Re-probed at the start of Phase 19 rather than copied from Phase 18,
 * because "it was blocked last time" is an assumption, not a result.
 * Zenodo was reachable-in-principle in Phase 18 research but is
 * blocked here too, which removes the PANNs fallback.
 */
export const PHASE_19_NETWORK_PROBE: ReadonlyArray<{ host: string, result: string }> = [
  { host: 'pypi.org', result: 'REACHABLE (200)' },
  { host: 'github.com', result: 'REACHABLE (200)' },
  { host: 'api.github.com', result: 'REACHABLE (200)' },
  { host: 'huggingface.co', result: 'BLOCKED (000)' },
  { host: 'cdn-lfs.huggingface.co', result: 'BLOCKED (000)' },
  { host: 'release-assets.githubusercontent.com', result: 'BLOCKED (000)' },
  { host: 'objects.githubusercontent.com', result: 'BLOCKED (000)' },
  { host: 'zenodo.org', result: 'BLOCKED (000)' },
  { host: 'download.pytorch.org', result: 'BLOCKED (TLS EOF)' },
]

/**
 * The decisive Phase 19 finding, stated once.
 *
 * Two direct weight fetches were attempted and both returned zero
 * bytes: the LAION-CLAP music checkpoint (connection refused) and the
 * DCLAP ONNX (302 to a blocked CDN). So no teacher inference of any
 * kind was possible, and Steps 5, 6, 10 of the brief are BLOCKED —
 * not skipped, not estimated.
 */
export const TEACHER_WEIGHTS_STATUS =
  'BLOCKED — WEIGHTS UNAVAILABLE. Two direct fetches were attempted '
  + 'and both returned 0 bytes: the LAION-CLAP music checkpoint '
  + '(huggingface.co, connection refused) and the DCLAP audio ONNX '
  + '(github.com release asset, 302 to the blocked '
  + 'release-assets.githubusercontent.com). Package indexes remain '
  + 'reachable, so architecture contracts could be read from source, '
  + 'but no teacher could be loaded or executed.'

export const TEACHERS: ReadonlyArray<TeacherModel> = [
  {
    teacherId: 'laion-clap-music',
    displayName: 'LAION-CLAP (HTSAT-tiny + RoBERTa), music checkpoint',
    checkpoint: graded('music_audioset_epoch_15_esc_90.14.pt', 'FACT',
      'Named in the LAION-CLAP hook and widely referenced as the music checkpoint.'),
    audioEmbeddingDim: graded(512, 'FACT',
      'Audio tower output is projected to joint_embed_shape.'),
    textEmbeddingDim: graded(512, 'FACT',
      'Text tower projected to the same joint_embed_shape.'),
    sharedEmbeddingDim: graded(512, 'FACT',
      'clap_module/model.py: joint_embed_shape: int = 512. Note this is '
      + 'NOT the 768 that HTSAT-tiny.json lists as embed_dim — that is the '
      + 'pre-projection width. Using 768 would break the contract.'),
    inputSampleRateHz: graded(48_000, 'FACT', 'model_configs/HTSAT-tiny.json'),
    audioWindowSeconds: graded(10, 'FACT', 'clip_samples 480000 at 48 kHz.'),
    license: graded('CC0 1.0', 'FACT',
      'LICENSE file bundled in the laion_clap 1.1.7 wheel was read directly.'),
    modelSizeMb: graded(2200, 'UNVERIFIED', 'Commonly cited ~2.2 GB; not weighed here.'),
    onnxAvailable: graded('NO — requires conversion', 'FACT',
      'No official ONNX published by LAION.'),
    officialSource: 'github.com/LAION-AI/CLAP · PyPI laion_clap',
    weightsAvailability: 'BLOCKED_NETWORK',
    weightsNote:
      'Direct fetch of the music checkpoint returned 0 bytes '
      + '(huggingface.co unreachable).',
    teacherViability: 'VIABLE_PENDING_LEGAL_REVIEW',
    distillable: graded(
      'YES in principle — CC0 imposes no restriction on training a student '
      + 'on its outputs. This is the single most valuable option found, '
      + 'because a CC0 teacher is the clean route to an in-house student. '
      + 'The legal effect of distillation is NOT assumed to be settled and '
      + 'requires review before any real training run.',
      'UNVERIFIED',
    ),
    licenseConcern: 'LICENSE_REVIEW_REQUIRED',
    persianTextSupport: 'UNVERIFIED',
    persianNote:
      'Trained on English audio-caption pairs (LAION-Audio-630K). The '
      + 'RoBERTa tokenizer will accept Persian bytes and return a vector, '
      + 'but that vector has no established meaning. No Persian claim is '
      + 'made.',
    measuredAudioAudio: 'NOT MEASURED — weights unavailable.',
    measuredTextAudio: 'NOT MEASURED — weights unavailable.',
  },

  {
    teacherId: 'dclap-student',
    displayName: 'AudioMuse-AI-DCLAP (distilled LAION-CLAP)',
    checkpoint: graded(
      'model_epoch_36.onnx (1.2 MB) + model_epoch_36.onnx.data (21.2 MB) '
      + '+ clap_text_model.onnx (501.4 MB)',
      'FACT',
      'Exact asset names and byte sizes read from the GitHub releases API.',
    ),
    audioEmbeddingDim: graded(512, 'FACT', 'Student projects into the teacher space.'),
    textEmbeddingDim: graded(512, 'FACT', 'Reuses the LAION-CLAP text tower.'),
    sharedEmbeddingDim: graded(512, 'FACT',
      'Author states both towers project to a shared 512-d space.'),
    inputSampleRateHz: graded(44_100, 'FACT', 'Repository README preprocessing spec.'),
    audioWindowSeconds: graded(10, 'FACT', '10 s segments, 50% overlap.'),
    license: graded('AGPL-3.0', 'FACT',
      'Repository LICENSE file read directly through the GitHub API.'),
    modelSizeMb: graded(524, 'FACT',
      '22.4 MB audio tower + 501.4 MB text tower, from the release listing.'),
    onnxAvailable: graded('YES — both towers already ONNX', 'FACT',
      'The only candidate needing no conversion work.'),
    officialSource: 'github.com/NeptuneHub/AudioMuse-AI-DCLAP',
    weightsAvailability: 'BLOCKED_NETWORK',
    weightsNote:
      'Release assets exist and are catalogued, but every download 302s '
      + 'to release-assets.githubusercontent.com, which does not connect. '
      + 'Fetch returned 0 bytes.',
    teacherViability: 'BLOCKED',
    distillable: graded(
      'Distilling FROM an AGPL-3.0 model does not clear the licence — the '
      + 'obligations attach to the model being used. Technically the best '
      + 'fit found; legally the worst.',
      'UNVERIFIED',
    ),
    licenseConcern: 'COPYLEFT_BLOCKER',
    persianTextSupport: 'UNVERIFIED',
    persianNote: 'Inherits the LAION-CLAP text tower, so the same caveat applies.',
    measuredAudioAudio: 'NOT MEASURED — weights unavailable.',
    measuredTextAudio: 'NOT MEASURED — weights unavailable.',
  },

  {
    teacherId: 'm2d-clap',
    displayName: 'M2D-CLAP',
    checkpoint: graded('UNKNOWN — research checkpoint', 'UNVERIFIED'),
    audioEmbeddingDim: graded(null, 'UNVERIFIED'),
    textEmbeddingDim: graded(null, 'UNVERIFIED'),
    sharedEmbeddingDim: graded(null, 'UNVERIFIED'),
    inputSampleRateHz: graded(null, 'UNVERIFIED'),
    audioWindowSeconds: graded(null, 'UNVERIFIED'),
    license: graded('UNKNOWN', 'UNVERIFIED',
      'Not established. A research checkpoint is assumed restrictive until checked.'),
    modelSizeMb: graded(null, 'UNVERIFIED'),
    onnxAvailable: graded('UNKNOWN', 'UNVERIFIED'),
    officialSource: 'arXiv 2503.22104',
    weightsAvailability: 'UNKNOWN',
    weightsNote: 'Not attempted — hosting was not established and HF is blocked regardless.',
    teacherViability: 'UNKNOWN',
    distillable: graded('UNKNOWN — licence unknown, so distillation rights unknown.', 'UNVERIFIED'),
    licenseConcern: 'LICENSE_REVIEW_REQUIRED',
    persianTextSupport: 'UNVERIFIED',
    persianNote: 'No information.',
    measuredAudioAudio: 'NOT MEASURED — weights unavailable.',
    measuredTextAudio: 'NOT MEASURED — weights unavailable.',
  },
]

// ====================================================================
// STEP 2 — TEACHER OUTPUT CONTRACT
// ====================================================================

/**
 * The contract a teacher must satisfy before it may be used.
 *
 * The critical clause is `sharedSpace`: audio and text embeddings must
 * occupy the SAME space with the SAME dimension. If they do not, the
 * experiment must FAIL LOUDLY.
 *
 * It is deliberately easy to make the numbers agree by inserting a
 * projection, and that would be a fabrication: it manufactures a
 * cosine value between two unrelated spaces, and the value would look
 * entirely plausible. `validateTeacherContract` therefore refuses
 * rather than adapting.
 */
export interface TeacherContract {
  readonly teacherId: string
  readonly audioDim: number | null
  readonly textDim: number | null
  readonly l2Normalized: boolean
}

export type ContractResult =
  | { ok: true, sharedDim: number }
  | { ok: false, reason: string }

export function validateTeacherContract(c: TeacherContract): ContractResult {
  if (c.audioDim === null || c.textDim === null) {
    return {
      ok: false,
      reason:
        `${c.teacherId}: embedding dimensions are not both known `
        + `(audio=${c.audioDim}, text=${c.textDim}). A shared space cannot be `
        + 'asserted from unknown dimensions.',
    }
  }
  if (c.audioDim <= 0 || c.textDim <= 0) {
    return { ok: false, reason: `${c.teacherId}: non-positive dimension.` }
  }
  if (c.audioDim !== c.textDim) {
    return {
      ok: false,
      reason:
        `${c.teacherId}: audio dimension ${c.audioDim} != text dimension `
        + `${c.textDim}. These are different spaces. Refusing to project one `
        + 'into the other to force agreement — the resulting cosine would be '
        + 'a number without meaning.',
    }
  }
  if (!c.l2Normalized) {
    return {
      ok: false,
      reason:
        `${c.teacherId}: embeddings must be L2-normalised before cosine `
        + 'comparison, otherwise magnitude leaks into the similarity.',
    }
  }
  return { ok: true, sharedDim: c.audioDim }
}

// ====================================================================
// STEP 9 — STUDENT ONNX CONTRACT
// ====================================================================

/**
 * What a distilled student must declare. The dimension is a variable,
 * not a constant: Phase 19 evaluates 128/256/512 and the brief
 * explicitly forbids hardcoding a winner.
 */
export interface StudentContract {
  readonly studentId: string
  readonly inputName: string
  readonly inputSampleRateHz: number
  readonly inputChannels: number
  /** [batch, samples]; -1 means dynamic. */
  readonly inputShape: readonly number[]
  readonly outputName: string
  readonly outputShape: readonly number[]
  readonly embeddingDimension: number
  readonly l2Normalized: boolean
  readonly pooling: 'MEAN' | 'ATTENTION' | 'CLS'
}

export const STUDENT_DIMENSION_CANDIDATES: readonly number[] = [128, 256, 512]

export function makeStudentContract(dim: number): StudentContract {
  if (!STUDENT_DIMENSION_CANDIDATES.includes(dim)) {
    throw new Error(
      `Student dimension ${dim} is not one of the evaluated candidates `
      + `(${STUDENT_DIMENSION_CANDIDATES.join(', ')}). Phase 19 does not `
      + 'pick a dimension by assumption.',
    )
  }
  return {
    studentId: `student-${dim}`,
    inputName: 'waveform',
    inputSampleRateHz: 48_000,
    inputChannels: 1,
    inputShape: [1, -1],
    outputName: 'embedding',
    outputShape: [1, dim],
    embeddingDimension: dim,
    l2Normalized: true,
    pooling: 'MEAN',
  }
}

// ====================================================================
// STEP 12 — PRODUCTION DECISION
// ====================================================================

export type Phase19Decision = 'PROMISING' | 'INCONCLUSIVE' | 'BLOCKED' | 'NOT_VIABLE'

export const PHASE_19_DECISION: Phase19Decision = 'BLOCKED'

export const PHASE_19_DECISION_REASON =
  'No teacher model could be obtained, so no teacher inference, no '
  + 'text-to-audio retrieval and no real distillation run were possible. '
  + 'The distillation PIPELINE was built and executed end-to-end against '
  + 'a synthetic teacher to prove the machinery is correct, but a '
  + 'synthetic teacher proves nothing about music. YAMNet therefore '
  + 'remains in place, still carrying its measured AUC of 0.3125, and no '
  + 'replacement has earned the right to displace it.'

export const NO_AUTO_SELECTION_NOTICE =
  'No production model was selected automatically.'

/** The ten questions the brief requires answering, with honest answers. */
export const PHASE_19_ANSWERS: ReadonlyArray<{ q: string, a: string, status: Evidence }> = [
  {
    q: 'Can we obtain a usable teacher?',
    a: 'NO — not in this environment. Every weight host is blocked; two direct fetches returned 0 bytes.',
    status: 'BLOCKED',
  },
  {
    q: 'Is its license acceptable for SYSTEMA?',
    a: 'LAION-CLAP is CC0 1.0, which is the most permissive option and is promising. '
      + 'DCLAP is AGPL-3.0 and is a blocker for a proprietary app. The legal effect of '
      + 'distillation itself is NOT settled and needs review.',
    status: 'FACT',
  },
  {
    q: 'Does it actually outperform YAMNet on music similarity?',
    a: 'UNKNOWN — never executed. No comparison exists, and none is implied.',
    status: 'BLOCKED',
  },
  {
    q: 'Can it perform text->audio retrieval?',
    a: 'Architecturally yes (verified 512-d shared space, read from source). '
      + 'Empirically NOT MEASURED.',
    status: 'FACT',
  },
  {
    q: 'Can we distill it into a much smaller student?',
    a: 'The pipeline exists and runs end-to-end (dataset -> teacher adapter -> '
      + 'student training -> evaluation -> ONNX-shaped contract), verified against a '
      + 'synthetic teacher. Whether a REAL teacher distills well is NOT MEASURED.',
    status: 'MEASURED',
  },
  {
    q: 'Does the student retain useful ranking quality?',
    a: 'UNKNOWN for music. Against the synthetic teacher the pipeline recovers '
      + 'ranking as expected, which validates the CODE, not any musical claim.',
    status: 'BLOCKED',
  },
  {
    q: 'Is the student fast enough for the target Android device?',
    a: 'NOT MEASURED — no student ONNX was produced from a real teacher, so nothing was benchmarked on device.',
    status: 'BLOCKED',
  },
  {
    q: 'Does the student release memory correctly?',
    a: 'NOT MEASURED — nothing was loaded on device in this phase.',
    status: 'BLOCKED',
  },
  {
    q: 'Is the result strong enough to justify replacing YAMNet?',
    a: 'NO. Nothing measured beats YAMNet because nothing was measured at all. YAMNet stays.',
    status: 'BLOCKED',
  },
  {
    q: 'If not, what is the exact blocker?',
    a: 'Network egress to every model-weight host (huggingface.co, cdn-lfs, '
      + 'release-assets.githubusercontent.com, zenodo.org, download.pytorch.org). '
      + 'Secondary blocker: AGPL-3.0 on the one phone-sized CLAP.',
    status: 'FACT',
  },
]
