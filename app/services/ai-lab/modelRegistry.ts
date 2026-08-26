// ============================================================
// SYSTEMA — Phase 14: candidate model registry
// ============================================================
// The catalogue of audio models SYSTEMA might eventually use, with
// enough metadata to compare them before any weights exist on the
// device.
//
// Why a registry rather than a hard-coded model
// ---------------------------------------------
// §4 is explicit: do not blindly choose CLAP. The whole point of
// Phase 14 is that the production model is an OUTCOME of measurement,
// not an assumption. So the benchmark runner takes a ModelDefinition
// and knows nothing about which one it is; adding a candidate means
// adding an entry here and nothing else.
//
// Honesty about what is in this file
// ----------------------------------
// The sizes, embedding dimensions and sample rates below come from the
// models' own documentation and papers (sources cited per entry). They
// are METADATA, not SYSTEMA measurements. Nothing here has been run on
// the target device; every entry is NOT_INSTALLED until someone
// side-loads weights. The dashboard shows that state explicitly rather
// than implying these numbers were benchmarked.
//
// Research date: 2026-08-26.
// ============================================================

import type { ModelDefinition, ExecutionProvider, PreprocessingConfig } from './types'

/**
 * Default preprocessing.
 *
 * 48 kHz mono, 10-second windows: the convention most AudioSet-derived
 * audio models were trained on, and the input contract CLAP-family
 * models expect. Individual models override what they must, and any
 * difference is recorded per run so comparisons cannot silently mix
 * incompatible preprocessing (§6).
 */
export const DEFAULT_PREPROCESSING: PreprocessingConfig = {
  sampleRate: 48_000,
  channels: 1,
  windowSec: 10,
  overlapSec: 0,
  normalization: 'peak',
  aggregation: 'mean',
}

/**
 * The candidates.
 *
 * Ordered roughly from lightest to heaviest, because on a mid-range
 * phone that ordering is the most decision-relevant one.
 */
export const MODEL_REGISTRY: readonly ModelDefinition[] = Object.freeze([
  // ---- The harness reference ---------------------------------
  {
    modelId: 'reference-dsp-v1',
    modelName: 'Reference DSP Embedding',
    version: '1.0.0',
    source: 'SYSTEMA (in-project)',
    sourceUrl: '',
    license: 'Project-internal',
    modelFormat: 'none',
    sizeMb: 0,
    sizeConfidence: 'MEASURED',
    checksum: null,
    inputSampleRate: 22_050,
    inputChannels: 1,
    inputDurationSec: 10,
    embeddingDimension: 64,
    runtime: 'reference',
    quantization: 'none',
    availability: 'SYNTHETIC',
    rationale:
      'Not a candidate for production. A deterministic, weight-free '
      + 'embedding derived from spectral statistics, used to prove the '
      + 'benchmark harness itself measures correctly — timing, memory, '
      + 'failure handling, determinism and aggregation. Without it, a '
      + 'zero-model device could not exercise the pipeline at all.',
    limitations: [
      'Carries no learned semantics — it cannot be used for search or tagging.',
      'Its speed says nothing about a real neural model.',
      'Exists to validate the measurement path, not to be selected.',
    ],
  },

  // ---- Genuinely lightweight candidates ----------------------
  {
    modelId: 'yamnet-1024',
    modelName: 'YAMNet (MobileNetV1)',
    version: '1.0',
    source: 'Google Research / AudioSet',
    sourceUrl: 'https://github.com/tensorflow/models/tree/master/research/audioset/yamnet',
    license: 'Apache-2.0',
    modelFormat: 'tflite',
    sizeMb: 15,
    sizeConfidence: 'ESTIMATED',
    checksum: null,
    inputSampleRate: 16_000,
    inputChannels: 1,
    inputDurationSec: 0.96,
    embeddingDimension: 1024,
    runtime: 'onnxruntime',
    quantization: 'fp32',
    availability: 'NOT_INSTALLED',
    rationale:
      'The lightest credible option. A MobileNetV1 backbone built for '
      + 'mobile inference, and repeatedly identified in the literature as '
      + 'the practical choice for phones — one 2026 instrument-'
      + 'classification study recommends it specifically for mobile '
      + 'devices while noting OpenL3 is more precise but far heavier.',
    limitations: [
      'Audio-event embeddings from AudioSet, not music-specific representations.',
      'Very short 0.96 s frames, so a track needs many inferences plus aggregation.',
      'No text encoder — cannot support text-to-audio search on its own.',
      'Reported to confuse similar instrument timbres on short windows.',
    ],
  },
  {
    modelId: 'vggish-128',
    modelName: 'VGGish',
    version: '1.0',
    source: 'Google Research / AudioSet',
    sourceUrl: 'https://github.com/tensorflow/models/tree/master/research/audioset/vggish',
    license: 'Apache-2.0',
    modelFormat: 'tflite',
    sizeMb: 280,
    sizeConfidence: 'ESTIMATED',
    checksum: null,
    inputSampleRate: 16_000,
    inputChannels: 1,
    inputDurationSec: 0.96,
    embeddingDimension: 128,
    runtime: 'onnxruntime',
    quantization: 'fp32',
    availability: 'NOT_INSTALLED',
    rationale:
      'A long-standing baseline with the smallest embedding of the set '
      + '(128-d), which keeps any future vector index cheap. Included as '
      + 'a reference point rather than a favourite.',
    limitations: [
      'Large on disk relative to its capability; a poor size/benefit ratio on mobile.',
      '128-d embeddings are less discriminative than newer models.',
      'Superseded in most benchmarks by YAMNet and PANNs.',
    ],
  },
  {
    modelId: 'panns-cnn10',
    modelName: 'PANNs CNN10',
    version: '1.0',
    source: 'Kong et al., PANNs (audioset_tagging_cnn)',
    sourceUrl: 'https://github.com/qiuqiangkong/audioset_tagging_CNN',
    license: 'MIT',
    modelFormat: 'onnx',
    sizeMb: 100,
    sizeConfidence: 'ESTIMATED',
    checksum: null,
    inputSampleRate: 32_000,
    inputChannels: 1,
    inputDurationSec: 10,
    embeddingDimension: 512,
    runtime: 'onnxruntime',
    quantization: 'fp32',
    availability: 'NOT_INSTALLED',
    rationale:
      'The mid-size PANNs variant. A 2025 evaluation of audio-tagging '
      + 'models on constrained hardware found the lighter PANNs (CNN6, '
      + 'CNN10) preferable for continuous inference, while CNN14 and '
      + 'Wavegram-Logmel pushed CPU temperature toward thermal limits — '
      + 'directly relevant to a phone with no active cooling.',
    limitations: [
      'Heavier than YAMNet; thermal behaviour on a phone is unmeasured.',
      'Audio-tagging embeddings, not language-aligned.',
      'Requires 32 kHz input, differing from the 48 kHz default preprocessing.',
    ],
  },
  {
    modelId: 'openl3-music-512',
    modelName: 'OpenL3 (music, mel256, 512-d)',
    version: '0.4.2',
    source: 'Cramer et al. / Essentia model zoo',
    sourceUrl: 'https://essentia.upf.edu/models.html',
    license: 'CC-BY-NC-SA-4.0',
    modelFormat: 'onnx',
    sizeMb: 190,
    sizeConfidence: 'ESTIMATED',
    checksum: null,
    inputSampleRate: 48_000,
    inputChannels: 1,
    inputDurationSec: 1,
    embeddingDimension: 512,
    runtime: 'onnxruntime',
    quantization: 'fp32',
    availability: 'NOT_INSTALLED',
    rationale:
      'Has a music-specific variant, which matters for a music app. '
      + 'The 2026 comparison found it the most precise of the classic '
      + 'embedding models and robust under noise, at a clear compute cost.',
    limitations: [
      'NON-COMMERCIAL licence (CC-BY-NC-SA) — a blocking issue if SYSTEMA is ever distributed commercially.',
      'Uncompressed 2D-CNN with no mobile optimisation; the same study flags it as hard to run on modest hardware.',
      '1-second frames mean many inferences per track.',
    ],
  },

  // ---- Language-aligned candidates ---------------------------
  {
    modelId: 'laion-clap-htsat-tiny',
    modelName: 'LAION-CLAP (HTSAT-tiny, music)',
    version: 'music_audioset_epoch_15_esc_90.14',
    source: 'LAION-AI/CLAP',
    sourceUrl: 'https://github.com/LAION-AI/CLAP',
    license: 'Apache-2.0',
    modelFormat: 'onnx',
    sizeMb: 620,
    sizeConfidence: 'ESTIMATED',
    checksum: null,
    inputSampleRate: 48_000,
    inputChannels: 1,
    inputDurationSec: 10,
    embeddingDimension: 512,
    runtime: 'onnxruntime',
    quantization: 'fp32',
    availability: 'NOT_INSTALLED',
    rationale:
      'The obvious candidate, included so it can be measured rather than '
      + 'assumed. Its real appeal is the shared audio/text space, which '
      + 'is what would eventually enable text-to-audio search. LAION '
      + 'publishes a music-specific checkpoint.',
    limitations: [
      'By far the largest candidate. The audio tower alone is ~30M params (~111 GFLOPs/sample); the full checkpoint including the RoBERTa text encoder (~125M params) is very large for a phone.',
      'Shipping the text encoder on-device may be unnecessary if text embeddings are precomputed — this needs deciding before any size claim is final.',
      'Export to ONNX is non-trivial and unverified here.',
      'Quantization would likely be mandatory, and its quality cost is unmeasured.',
    ],
  },
  {
    modelId: 'm2d-clap-2025',
    modelName: 'M2D-CLAP',
    version: '2025',
    source: 'Niizumi et al. (arXiv:2503.22104)',
    sourceUrl: 'https://arxiv.org/html/2503.22104',
    license: 'See upstream (research release)',
    modelFormat: 'onnx',
    sizeMb: 350,
    sizeConfidence: 'ESTIMATED',
    checksum: null,
    inputSampleRate: 16_000,
    inputChannels: 1,
    inputDurationSec: 10,
    embeddingDimension: 768,
    runtime: 'onnxruntime',
    quantization: 'fp32',
    availability: 'NOT_INSTALLED',
    rationale:
      'A stronger CLAP-family alternative worth measuring rather than '
      + 'defaulting to LAION-CLAP. Reports SOTA-level results on music '
      + 'tasks (79.31 zero-shot GTZAN) and general audio, and later work '
      + 'uses it as the CLAP baseline to beat.',
    limitations: [
      'Research release; packaging and licensing for an app are unclear.',
      'No published mobile/ONNX deployment path found during research.',
      'Still transformer-scale — unlikely to be small enough without heavy quantization.',
    ],
  },
])

/** All registered models. */
export function listModels(): readonly ModelDefinition[] {
  return MODEL_REGISTRY
}

/** Lookup by id. Null rather than throwing: callers handle absence. */
export function getModel(modelId: string): ModelDefinition | null {
  return MODEL_REGISTRY.find(m => m.modelId === modelId) ?? null
}

/** Models that could actually be benchmarked right now. */
export function listRunnableModels(): readonly ModelDefinition[] {
  return MODEL_REGISTRY.filter(
    m => m.availability === 'SYNTHETIC' || m.availability === 'AVAILABLE',
  )
}

/** Registry integrity check, exercised by the tests. */
export function validateRegistry(models: readonly ModelDefinition[] = MODEL_REGISTRY): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const model of models) {
    if (seen.has(model.modelId)) problems.push(`duplicate modelId: ${model.modelId}`)
    seen.add(model.modelId)

    if (!model.modelId.trim()) problems.push('a model has an empty modelId')
    if (!model.version.trim()) problems.push(`${model.modelId}: missing version`)
    if (model.embeddingDimension <= 0) problems.push(`${model.modelId}: invalid embeddingDimension`)
    if (model.inputSampleRate <= 0) problems.push(`${model.modelId}: invalid inputSampleRate`)
    if (model.inputDurationSec <= 0) problems.push(`${model.modelId}: invalid inputDurationSec`)
    if (model.sizeMb < 0) problems.push(`${model.modelId}: negative sizeMb`)

    // A real candidate must state its limitations. This is a
    // documentation guarantee, enforced.
    if (model.availability !== 'SYNTHETIC' && model.limitations.length === 0) {
      problems.push(`${model.modelId}: real candidates must declare limitations`)
    }
    if (!model.rationale.trim()) problems.push(`${model.modelId}: missing rationale`)
  }
  return problems
}

// ---- Execution providers ---------------------------------------

/**
 * What can actually be used for inference here.
 *
 * The notes are the research conclusions and are shown verbatim in the
 * UI, because "we did not test the NPU" and "the NPU is unsupported"
 * are very different statements and must not be conflated.
 */
export function listExecutionProviders(platform: 'android' | 'web'): ExecutionProvider[] {
  if (platform === 'web') {
    return [
      {
        id: 'none',
        label: 'None (browser)',
        available: true,
        note: 'No native inference runtime in the browser. Only the reference harness runs here.',
      },
    ]
  }

  return [
    {
      id: 'cpu',
      label: 'CPU',
      available: true,
      note: 'Always available. The baseline every other provider must beat.',
    },
    {
      id: 'nnapi',
      label: 'NNAPI',
      available: false,
      note:
        'DEPRECATED in Android 15, which is the OS the target Poco X7 Pro ships with. '
        + 'Google now expects most devices to fall back to CPU and advises against it for '
        + 'performance-critical work. Registered so it can be measured if ever enabled, '
        + 'but not assumed to be faster.',
    },
    {
      id: 'gpu',
      label: 'GPU',
      available: false,
      note:
        'Not wired up. The target device uses a Mali-G720 (MediaTek Dimensity 8400 Ultra), '
        + 'so Qualcomm\'s QNN execution provider does not apply to it. Any GPU path would '
        + 'have to be validated separately before being claimed.',
    },
  ]
}
