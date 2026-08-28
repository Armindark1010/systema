/**
 * SYSTEMA — Phase 18 production embedding candidate dossiers.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A RESEARCH RECORD. Every field is either (a) read out of a primary
 * source that was actually opened during Phase 18, or (b) explicitly
 * marked UNKNOWN. Nothing here is a measurement taken by SYSTEMA, with
 * exactly one exception: the YAMNet audio->audio numbers, which come
 * from the Phase 17 device run and are labelled as such.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * "Documented" and "verified" are different words. A candidate can
 * have a complete, well-sourced dossier and still have `deviceStatus:
 * NOT_TESTED`, because nobody ran it. The UI must never let a tidy row
 * of specifications read as evidence that a model works.
 *
 * WHY NOTHING BUT YAMNET WAS EXECUTED
 * -----------------------------------
 * Phase 18 was carried out in a sandbox where every host that serves
 * model weights is blocked at the network layer. This was tested, not
 * assumed — see NETWORK_PROBE below. Weight files simply cannot be
 * obtained here, so no candidate could be downloaded, converted,
 * loaded or run. That is a property of the environment, not a
 * judgement about the models, and it is recorded as BLOCKED_ENVIRONMENT
 * rather than as a quality finding.
 */

/** Whether SYSTEMA has ever run this model on the target device. */
export type DeviceStatus = 'DEVICE_VERIFIED' | 'NOT_TESTED'

/** Whether SYSTEMA has quality evidence for this model. */
export type QualityStatus =
  | 'MEASURED_ON_LABELLED_SET'
  | 'NOT_MEASURED'

/** The Phase 18 result vocabulary. No other value is permitted. */
export type CandidateVerdict =
  | 'PROMISING'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NOT_SUITABLE'
  | 'BLOCKED'

/** The 18Q overall verdict vocabulary. */
export type OverallVerdict =
  | 'READY_FOR_PRODUCTION'
  | 'PROMISING_NEEDS_MORE_DATA'
  | 'NOT_SUITABLE'
  | 'BLOCKED'

export type Modality = 'AUDIO_ONLY' | 'AUDIO_AND_TEXT'

export type OnnxStatus =
  | 'OFFICIAL_EXPORT'
  | 'COMMUNITY_EXPORT'
  | 'REQUIRES_CONVERSION'
  | 'UNKNOWN'

export type CommercialUse = 'PERMITTED' | 'ATTRIBUTION_REQUIRED' | 'COPYLEFT' | 'RESTRICTED' | 'UNKNOWN'

/**
 * How confident we are in a dossier field.
 *
 * PRIMARY  — read out of the package/repo/config itself during Phase 18.
 * SECONDARY— from a paper or model card, not independently checked here.
 * UNKNOWN  — not established. Never guessed.
 */
export type Confidence = 'PRIMARY' | 'SECONDARY' | 'UNKNOWN'

export interface CandidateDossier {
  candidateId: string
  displayName: string

  // ---- 18A architecture audit -----------------------------------
  architecture: string
  approxParams: string
  approximateSizeMb: number | null
  inputSampleRateHz: number | null
  /** Analysis window the model was trained on, in seconds. */
  windowSeconds: number | null
  /** The embedding actually used for similarity. */
  embeddingDimension: number | null
  modality: Modality
  /**
   * For AUDIO_AND_TEXT models: the dimension text and audio are
   * projected into. Must equal `embeddingDimension` for cosine to be
   * meaningful. Null for audio-only models.
   */
  sharedSpaceDimension: number | null
  textEncoder: string | null
  /** Whether the model was actually trained for MUSIC similarity. */
  trainedForMusicSimilarity: string

  // ---- 18D provenance -------------------------------------------
  checkpointIdentifier: string
  checkpointSource: string
  /** SHA / digest. UNKNOWN unless a file was actually obtained. */
  checkpointHash: string
  onnxStatus: OnnxStatus
  onnxNote: string

  // ---- Deployment -----------------------------------------------
  androidCpuFeasibility: string
  quantizationNote: string
  memoryNote: string

  // ---- Licensing ------------------------------------------------
  codeLicense: string
  weightsLicense: string
  commercialUse: CommercialUse
  licenseNote: string

  // ---- Evidence status ------------------------------------------
  deviceStatus: DeviceStatus
  qualityStatus: QualityStatus
  /** Populated ONLY from a real device run. */
  measuredAudioAudio: string
  measuredTextAudio: string
  verdict: CandidateVerdict
  verdictReason: string

  confidence: Confidence
  sources: string[]
}

/**
 * The network reality Phase 18 ran under, probed rather than assumed.
 * Each entry was requested with curl and a hard timeout.
 */
export const NETWORK_PROBE: ReadonlyArray<{ host: string, result: string }> = [
  { host: 'github.com', result: 'REACHABLE (200)' },
  { host: 'api.github.com', result: 'REACHABLE (200)' },
  { host: 'pypi.org / files.pythonhosted.org', result: 'REACHABLE (200)' },
  { host: 'huggingface.co', result: 'BLOCKED (no connection; DNS resolves)' },
  { host: 'cdn-lfs.huggingface.co', result: 'BLOCKED (no connection)' },
  { host: 'release-assets.githubusercontent.com', result: 'BLOCKED (no connection)' },
  { host: 'objects.githubusercontent.com', result: 'BLOCKED (no connection)' },
  { host: 'tfhub.dev', result: 'BLOCKED (no connection)' },
  { host: 'storage.googleapis.com', result: 'BLOCKED (no connection)' },
]

/**
 * The decisive consequence, stated once so the UI and the docs cannot
 * drift apart.
 *
 * GitHub's API answers, which is how the DCLAP release was found and
 * catalogued — but every release ASSET redirects to
 * release-assets.githubusercontent.com, which does not connect. So the
 * assets are known to exist, with names and byte sizes, and are still
 * unobtainable. Metadata was reachable; weights were not.
 */
export const WEIGHTS_AVAILABILITY_NOTE =
  'No model weights could be obtained in this environment. Package '
  + 'indexes (PyPI) and the GitHub API are reachable, which is how the '
  + 'input/output contracts below were read from primary sources — but '
  + 'every weight CDN (HuggingFace, googleapis, and GitHub release '
  + 'assets) refuses to connect. Consequence: no candidate other than '
  + 'YAMNet has been executed, and YAMNet only because Phase 17 already '
  + 'ran it on the device.'

const PHASE_17_BASELINE_NOTE =
  'Phase 17 device run, 10 tracks / 19 pairs (SAME 3, SIMILAR 8, '
  + 'DIFFERENT 8): SIMILAR-vs-DIFFERENT AUC 0.3125, pair overlap '
  + '56.25%, verdict HEAVY OVERLAP.'

export const CANDIDATES: ReadonlyArray<CandidateDossier> = [
  {
    candidateId: 'yamnet',
    displayName: 'YAMNet (MobileNetV1)',
    architecture: 'MobileNetV1 depthwise-separable CNN over log-mel patches',
    approxParams: '~3.7M',
    approximateSizeMb: 15.0,
    inputSampleRateHz: 16_000,
    windowSeconds: 0.96,
    embeddingDimension: 1024,
    modality: 'AUDIO_ONLY',
    sharedSpaceDimension: null,
    textEncoder: null,
    trainedForMusicSimilarity:
      'NO. Trained for AudioSet event tagging (521 classes). Music is a '
      + 'handful of those classes, so it separates "music vs speech vs dog" '
      + 'well and says little about whether two songs are alike. This is '
      + 'the most likely explanation of the Phase 17 result.',
    checkpointIdentifier: 'yamnet (AudioSet), community ONNX export',
    checkpointSource: 'tfhub.dev/google/yamnet (upstream); community ONNX re-export',
    checkpointHash: 'UNKNOWN — not re-obtained in Phase 18',
    onnxStatus: 'COMMUNITY_EXPORT',
    onnxNote:
      'Community exports keep the log-mel front end INSIDE the graph and '
      + 'take a raw dynamic-length 16 kHz mono waveform. The export '
      + 'determines the preprocessing contract, so the exact export must be '
      + 'identified before any adapter is trusted.',
    androidCpuFeasibility: 'PROVEN — already ran on the target device in Phase 17.',
    quantizationNote: 'Not attempted. Already small enough that it was not the bottleneck.',
    memoryNote:
      'Phase 17 device measurement: 333.3 MB before / 333.3 MB peak / '
      + '333.3 MB after, net +0.0 MB, RELEASED.',
    codeLicense: 'Apache-2.0',
    weightsLicense: 'Apache-2.0',
    commercialUse: 'PERMITTED',
    licenseNote: 'Cleanest licence of the set. No attribution or copyleft burden.',
    deviceStatus: 'DEVICE_VERIFIED',
    qualityStatus: 'MEASURED_ON_LABELLED_SET',
    measuredAudioAudio: PHASE_17_BASELINE_NOTE,
    measuredTextAudio: 'N/A — audio-only model, cannot accept text.',
    verdict: 'NOT_SUITABLE',
    verdictReason:
      'AUC 0.3125 is below 0.5, i.e. on this labelled set YAMNet ranked '
      + 'SIMILAR pairs as LESS similar than DIFFERENT pairs. With 19 pairs '
      + 'the confidence interval is wide and this should not be read as a '
      + 'precise score, but there is no reading of it in which YAMNet is a '
      + 'good music-similarity space. It stays as the reference baseline.',
    confidence: 'PRIMARY',
    sources: [
      'Phase 17 device run (SYSTEMA, recorded in docs/phase-17)',
      'AudioSet / YAMNet model documentation',
    ],
  },

  {
    candidateId: 'panns-cnn10',
    displayName: 'PANNs CNN10',
    architecture: 'VGG-like CNN over log-mel (PANNs family)',
    approxParams: '~4.9M (CNN10); CNN14 is ~79.7M',
    approximateSizeMb: null,
    inputSampleRateHz: 32_000,
    windowSeconds: null,
    embeddingDimension: 512,
    modality: 'AUDIO_ONLY',
    sharedSpaceDimension: null,
    textEncoder: null,
    trainedForMusicSimilarity:
      'NO. AudioSet tagging, same objective family as YAMNet. Stronger '
      + 'tagger than YAMNet, but "better at AudioSet" does not imply '
      + '"better at music similarity" — that is the assumption Phase 17 '
      + 'already falsified once.',
    checkpointIdentifier: 'Cnn10_mAP=0.380.pth (PANNs release)',
    checkpointSource: 'Zenodo record 3576403 (PANNs)',
    checkpointHash: 'UNKNOWN — weights unobtainable in this environment',
    onnxStatus: 'REQUIRES_CONVERSION',
    onnxNote:
      'No official ONNX. Conversion from PyTorch is plausible but the '
      + 'log-mel front end (torchlibrosa) would have to be either exported '
      + 'into the graph or reproduced exactly on device. Reproducing a '
      + 'filterbank approximately is the failure mode this project refuses.',
    androidCpuFeasibility:
      'PLAUSIBLE for CNN10 (small). CNN14 is NOT — a Raspberry Pi study '
      + 'found CNN14/Wavegram-Logmel hitting ~85 C thermal limits and '
      + 'called them unsuitable for resource-constrained real-time use.',
    quantizationNote: 'UNKNOWN — not attempted.',
    memoryNote: 'UNKNOWN — never loaded.',
    codeLicense: 'Apache-2.0 (PANNs code)',
    weightsLicense: 'CC BY 4.0 (Zenodo record 3576403)',
    commercialUse: 'ATTRIBUTION_REQUIRED',
    licenseNote:
      'CC BY 4.0 permits commercial use but obliges attribution in the '
      + 'shipped product. That is a real, if small, product requirement.',
    deviceStatus: 'NOT_TESTED',
    qualityStatus: 'NOT_MEASURED',
    measuredAudioAudio: 'NOT MEASURED — never executed.',
    measuredTextAudio: 'N/A — audio-only model.',
    verdict: 'INSUFFICIENT_EVIDENCE',
    verdictReason:
      'Cannot be obtained or run here, and even if it ran it addresses '
      + 'only audio->audio, leaving the natural-language requirement '
      + 'entirely unmet. Not rejected on merit — simply unevidenced.',
    confidence: 'SECONDARY',
    sources: [
      'Zenodo 3576403 (PANNs weights, CC BY 4.0)',
      'Raspberry Pi thermal study of PANNs variants',
      'ISMIR 2023 embedding-teacher comparison',
    ],
  },

  {
    candidateId: 'openl3-music',
    displayName: 'OpenL3 (music content type)',
    architecture: 'L3-Net self-supervised audio-visual correspondence CNN',
    approxParams: 'UNKNOWN precisely; comparable to a mid-size CNN',
    approximateSizeMb: null,
    inputSampleRateHz: 48_000,
    windowSeconds: 1.0,
    embeddingDimension: 512,
    modality: 'AUDIO_ONLY',
    sharedSpaceDimension: null,
    textEncoder: null,
    trainedForMusicSimilarity:
      'PARTIALLY. There is a dedicated "music" content-type weight set, '
      + 'and it is self-supervised rather than tag-supervised, which is a '
      + 'genuinely different and more promising objective than YAMNet. '
      + 'Still not trained on a similarity objective.',
    checkpointIdentifier: 'openl3 music, mel128 or mel256, 512 or 6144 dim',
    checkpointSource: 'openl3 package (weights hosted externally)',
    checkpointHash: 'UNKNOWN — weights unobtainable in this environment',
    onnxStatus: 'REQUIRES_CONVERSION',
    onnxNote:
      'Kapre/TensorFlow origin. Conversion is non-trivial and the mel '
      + 'front end is the same trap as PANNs.',
    androidCpuFeasibility:
      'QUESTIONABLE. 48 kHz input plus mel128/256 is a heavier front end '
      + 'than YAMNet, and the literature flags OpenL3 as complex for '
      + 'mobile deployment.',
    quantizationNote: 'UNKNOWN — not attempted.',
    memoryNote: 'UNKNOWN — never loaded. 6144-dim output would also inflate storage per track.',
    codeLicense: 'MIT',
    weightsLicense: 'CC BY 4.0',
    commercialUse: 'ATTRIBUTION_REQUIRED',
    licenseNote:
      'Code and weights are licensed differently — MIT code, CC BY 4.0 '
      + 'weights. The attribution obligation attaches to the weights, '
      + 'which are the part that ships.',
    deviceStatus: 'NOT_TESTED',
    qualityStatus: 'NOT_MEASURED',
    measuredAudioAudio: 'NOT MEASURED — never executed.',
    measuredTextAudio: 'N/A — audio-only model.',
    verdict: 'INSUFFICIENT_EVIDENCE',
    verdictReason:
      'A reasonable audio->audio candidate on paper, unobtainable here, '
      + 'and it cannot satisfy the text-search requirement at all.',
    confidence: 'SECONDARY',
    sources: [
      'OpenL3 documentation and licence terms',
      '2026 instrument-classification study (best clean timbral accuracy, worst under noise)',
    ],
  },

  {
    candidateId: 'laion-clap-music',
    displayName: 'LAION-CLAP (HTSAT-tiny + RoBERTa), music checkpoint',
    architecture: 'HTSAT-tiny audio tower + RoBERTa-base text tower, contrastive',
    approxParams: '~155M total (~30M audio, ~125M text)',
    approximateSizeMb: 2200,
    inputSampleRateHz: 48_000,
    windowSeconds: 10,
    embeddingDimension: 512,
    modality: 'AUDIO_AND_TEXT',
    sharedSpaceDimension: 512,
    textEncoder: 'RoBERTa-base, context length 77',
    trainedForMusicSimilarity:
      'YES, and this is the important one. It is trained contrastively to '
      + 'align audio with natural-language descriptions, and the music '
      + 'checkpoint is specialised on music. It is the only candidate '
      + 'whose training objective actually matches what SYSTEMA wants.',
    checkpointIdentifier: 'music_audioset_epoch_15_esc_90.14.pt (~2.2 GB)',
    checkpointSource: 'HuggingFace (LAION) — BLOCKED from this environment',
    checkpointHash: 'UNKNOWN — weights unobtainable in this environment',
    onnxStatus: 'REQUIRES_CONVERSION',
    onnxNote:
      'No official ONNX from LAION. Known checkpoint/architecture '
      + 'audio_projection shape-mismatch issues are reported upstream '
      + '(GitHub issues #162/#165), so even the PyTorch path is not '
      + 'frictionless.',
    androidCpuFeasibility:
      'NOT FEASIBLE AS-IS. ~111 GFLOPs/sample and a ~2.2 GB checkpoint '
      + 'rule out shipping this checkpoint to a handset. The idea is '
      + 'right; this artifact is the wrong size.',
    quantizationNote:
      'Would require aggressive quantisation AND distillation. '
      + 'Quantising a 2.2 GB checkpoint to phone scale is not a tuning '
      + 'exercise, it is a separate project.',
    memoryNote: 'UNKNOWN — never loaded. Would not fit the current budget.',
    codeLicense: 'CC0 1.0 (LICENSE file in the laion_clap wheel)',
    weightsLicense: 'CC0 1.0 for the LAION-CLAP-Music encoder, per third-party audit',
    commercialUse: 'PERMITTED',
    licenseNote:
      'RESOLVED IN PHASE 18. Earlier notes called this ambiguous because '
      + 'PyPI classifies the package Apache-2.0 while the bundled LICENSE '
      + 'file is CC0 1.0. The LICENSE file was read directly: it is CC0 '
      + '1.0. Both readings permit commercial use, so the ambiguity is '
      + 'not a blocker either way.',
    deviceStatus: 'NOT_TESTED',
    qualityStatus: 'NOT_MEASURED',
    measuredAudioAudio: 'NOT MEASURED — never executed.',
    measuredTextAudio: 'NOT MEASURED — never executed.',
    verdict: 'BLOCKED',
    verdictReason:
      'Blocked on two independent grounds: the weights cannot be obtained '
      + 'in this environment, and the full checkpoint is far too large for '
      + 'the device even if they could. The ARCHITECTURE remains the best '
      + 'match for the product goal, which is why the distilled variant '
      + 'below matters more than this row does.',
    confidence: 'PRIMARY',
    sources: [
      'laion_clap 1.1.7 wheel: model_configs/HTSAT-tiny.json, clap_module/model.py (joint_embed_shape=512), LICENSE (CC0 1.0)',
      'LAION-AI/open-clap-scaling WP1 (CLAP-HTSAT-tiny 111.20 GFLOPs)',
      'LAION-AI/CLAP GitHub issues #162, #165',
    ],
  },

  {
    candidateId: 'ms-clap-2023',
    displayName: 'Microsoft CLAP 2023 (HTSAT + GPT-2)',
    architecture: 'HTSAT audio tower + GPT-2 text tower, contrastive',
    approxParams: 'UNKNOWN total; GPT-2 base text tower ~124M',
    approximateSizeMb: null,
    inputSampleRateHz: 44_100,
    windowSeconds: 7,
    embeddingDimension: 1024,
    modality: 'AUDIO_AND_TEXT',
    sharedSpaceDimension: 1024,
    textEncoder: 'GPT-2, context length 77',
    trainedForMusicSimilarity:
      'PARTIALLY. Contrastive audio-language like LAION-CLAP, so the '
      + 'objective is right, but it is a general audio model with no '
      + 'music-specialised checkpoint in the set.',
    checkpointIdentifier: 'CLAP_weights_2023.pth',
    checkpointSource: 'HuggingFace via hf_hub_download in msclap — BLOCKED here',
    checkpointHash: 'UNKNOWN — weights unobtainable in this environment',
    onnxStatus: 'REQUIRES_CONVERSION',
    onnxNote: 'No official ONNX export located.',
    androidCpuFeasibility: 'UNLIKELY — a GPT-2-scale text tower on a handset is a poor fit.',
    quantizationNote: 'UNKNOWN — not attempted.',
    memoryNote: 'UNKNOWN — never loaded.',
    codeLicense: 'MIT',
    weightsLicense: 'UNKNOWN — not stated in the package metadata',
    commercialUse: 'UNKNOWN',
    licenseNote:
      'The msclap PACKAGE is MIT. That is the code. The weights license '
      + 'was not established, and MIT code does not imply MIT weights.',
    deviceStatus: 'NOT_TESTED',
    qualityStatus: 'NOT_MEASURED',
    measuredAudioAudio: 'NOT MEASURED — never executed.',
    measuredTextAudio: 'NOT MEASURED — never executed.',
    verdict: 'BLOCKED',
    verdictReason:
      'Weights unobtainable here and hosted only on a blocked host. '
      + 'Weights licensing also unresolved, which would need answering '
      + 'before shipping regardless of quality.',
    confidence: 'PRIMARY',
    sources: [
      'msclap 1.3.4 wheel: configs/config_2023.yml, CLAPWrapper.py (hf_hub_download), METADATA (MIT)',
    ],
  },

  {
    candidateId: 'dclap-student',
    displayName: 'AudioMuse-AI-DCLAP (distilled LAION-CLAP student)',
    architecture:
      'Distilled student audio tower (mn10as/EfficientAT init, ~7M params) '
      + 'paired with the ORIGINAL LAION-CLAP text tower, both as ONNX',
    approxParams: '~7M audio student; text tower unchanged from LAION-CLAP',
    approximateSizeMb: 524,
    inputSampleRateHz: 44_100,
    windowSeconds: 10,
    embeddingDimension: 512,
    modality: 'AUDIO_AND_TEXT',
    sharedSpaceDimension: 512,
    textEncoder: 'LAION-CLAP text encoder exported to ONNX (501.4 MB)',
    trainedForMusicSimilarity:
      'YES — distilled specifically from the LAION-CLAP MUSIC checkpoint '
      + '(music_audioset_epoch_15_esc_90.14.pt) to preserve text-to-music '
      + 'behaviour while shrinking the audio tower.',
    checkpointIdentifier:
      'model_epoch_36.onnx (1.2 MB) + model_epoch_36.onnx.data (21.2 MB) '
      + '+ clap_text_model.onnx (501.4 MB)',
    checkpointSource:
      'github.com/NeptuneHub/AudioMuse-AI-DCLAP release v1 — asset '
      + 'metadata READ successfully via the GitHub API; the downloads '
      + 'themselves redirect to a blocked CDN',
    checkpointHash:
      'UNKNOWN — the API reported exact byte sizes but the asset bodies '
      + 'could not be fetched, so no digest was computed',
    onnxStatus: 'COMMUNITY_EXPORT',
    onnxNote:
      'This is the only candidate that ships BOTH towers as ready-made '
      + 'ONNX, which removes the conversion risk that blocks every other '
      + 'CLAP row. Audio input is 10 s segments at 44.1 kHz with 50% '
      + 'overlap, 64 mel bands, n_fft 1024, hop 480, normalised as '
      + '(log_mel + 42.6) / 25.9. Text uses the laion/clap-htsat-unfused '
      + 'tokenizer padded to exactly 77 tokens.',
    androidCpuFeasibility:
      'AUDIO TOWER: plausible — 22 MB total and ~5-6x faster than the '
      + 'teacher (author benchmarked on a Raspberry Pi 5). TEXT TOWER: '
      + 'the 501 MB ONNX is the problem, though text embedding could in '
      + 'principle be precomputed or served off-device, which changes the '
      + 'shape of the problem. NOT TESTED either way.',
    quantizationNote:
      'The text tower is the obvious quantisation target. Not attempted.',
    memoryNote: 'UNKNOWN — never loaded.',
    codeLicense: 'AGPL-3.0',
    weightsLicense: 'AGPL-3.0 (repository LICENSE, read directly)',
    commercialUse: 'COPYLEFT',
    licenseNote:
      'THE BLOCKER. AGPL-3.0 is a strong copyleft licence. Shipping these '
      + 'weights inside SYSTEMA would raise obligations that a '
      + 'closed-source distributed app very likely cannot meet. This '
      + 'needs a legal answer, not an engineering one, and it applies '
      + 'even though the model is technically the best fit found.',
    deviceStatus: 'NOT_TESTED',
    qualityStatus: 'NOT_MEASURED',
    measuredAudioAudio: 'NOT MEASURED — never executed.',
    measuredTextAudio: 'NOT MEASURED — never executed.',
    verdict: 'BLOCKED',
    verdictReason:
      'Technically the most promising route found in Phase 18 — real '
      + 'shared 512-d space, real ONNX for both towers, phone-scale audio '
      + 'tower — but BLOCKED on AGPL-3.0 licensing, and unobtainable in '
      + 'this environment for independent verification. Licensing is the '
      + 'binding constraint, not capability.',
    confidence: 'PRIMARY',
    sources: [
      'github.com/NeptuneHub/AudioMuse-AI-DCLAP README + release v1 asset listing (GitHub API)',
      'Repository LICENSE file (AGPL-3.0), read via the GitHub API',
    ],
  },

  {
    candidateId: 'm2d-clap',
    displayName: 'M2D-CLAP',
    architecture: 'Masked Modeling Duo + CLAP-style contrastive alignment',
    approxParams: 'UNKNOWN',
    approximateSizeMb: null,
    inputSampleRateHz: null,
    windowSeconds: null,
    embeddingDimension: null,
    modality: 'AUDIO_AND_TEXT',
    sharedSpaceDimension: null,
    textEncoder: 'UNKNOWN',
    trainedForMusicSimilarity:
      'PARTIALLY — reports state-of-the-art GTZAN zero-shot (79.31), '
      + 'which is a genre task on music, so the signal is encouraging.',
    checkpointIdentifier: 'UNKNOWN — research checkpoint',
    checkpointSource: 'arXiv 2503.22104 / associated research release',
    checkpointHash: 'UNKNOWN',
    onnxStatus: 'UNKNOWN',
    onnxNote: 'No ONNX export located.',
    androidCpuFeasibility: 'UNKNOWN — not established.',
    quantizationNote: 'UNKNOWN.',
    memoryNote: 'UNKNOWN.',
    codeLicense: 'UNKNOWN',
    weightsLicense: 'UNKNOWN',
    commercialUse: 'UNKNOWN',
    licenseNote: 'Not established. A research checkpoint should be assumed restrictive until checked.',
    deviceStatus: 'NOT_TESTED',
    qualityStatus: 'NOT_MEASURED',
    measuredAudioAudio: 'NOT MEASURED — never executed.',
    measuredTextAudio: 'NOT MEASURED — never executed.',
    verdict: 'INSUFFICIENT_EVIDENCE',
    verdictReason:
      'Too many UNKNOWNs to evaluate. Listed because the reported music '
      + 'zero-shot numbers make it worth revisiting, not because anything '
      + 'about it has been established here.',
    confidence: 'SECONDARY',
    sources: ['arXiv 2503.22104 (M2D-CLAP)'],
  },
]

/** 18Q — the single overall verdict. Exactly one value, stated once. */
export const OVERALL_VERDICT: OverallVerdict = 'BLOCKED'

export const OVERALL_VERDICT_REASON =
  'Phase 18 could not execute a single candidate model. Every weight '
  + 'host is blocked in this environment, so the CLAP feasibility '
  + 'question was answered on architecture, licensing and availability '
  + 'evidence rather than on measurement. The one model with real '
  + 'numbers, YAMNet, remains NOT SUITABLE for music similarity '
  + '(AUC 0.3125). The most promising route found — a distilled CLAP '
  + 'with genuine shared-space ONNX for both towers — is blocked on '
  + 'AGPL-3.0 licensing. Nothing here is ready for production, and '
  + 'nothing here has been ruled out on measured quality either.'

/** Required by the brief, verbatim, and shown on the page. */
export const NO_AUTO_SELECTION_NOTICE =
  'No production model was selected automatically.'

/**
 * The concrete next actions that would unblock a real Phase 18
 * measurement. Written down so the BLOCKED verdict is actionable
 * rather than a dead end.
 */
export const UNBLOCK_STEPS: ReadonlyArray<string> = [
  'Run the evaluation from an environment with access to HuggingFace and GitHub release assets.',
  'Resolve the DCLAP AGPL-3.0 question with a legal answer before any integration work.',
  'If AGPL is unacceptable, distil a student from the CC0 LAION-CLAP-Music teacher in-house; the teacher licence permits it.',
  'Expand the labelled set well beyond 19 pairs before treating any AUC as a decision-grade number.',
  'Only then measure on device: load time, warm inference, RTF, peak and post-cleanup memory.',
]
