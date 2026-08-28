/**
 * SYSTEMA — Phase 20 report export (§12).
 *
 * The results screen is long and painful to copy by hand. This turns
 * a completed evaluation into JSON / Markdown / plain text, plus a
 * short decision summary intended for pasting into another tool.
 *
 * HONESTY RULE
 * ------------
 * Absent measurements are rendered as NOT MEASURED, never as 0 and
 * never omitted. A missing AUC that prints as "0.000" would look like
 * a catastrophic result; a missing memory figure that is silently
 * dropped would look like it was never required. Both are worse than
 * an explicit gap, especially in a report designed to be pasted
 * somewhere else and read without the surrounding context.
 */

export interface ReportClassStats {
  label: string
  count: number
  mean?: number | null
  median?: number | null
  min?: number | null
  max?: number | null
  p25?: number | null
  p75?: number | null
  stdDev?: number | null
}

export interface ReportPairRow {
  pairId?: string
  trackA: string
  trackB: string
  label: string
  cosine?: number | null
}

export interface ReportMemory {
  baselinePssMb?: number | null
  peakPssMb?: number | null
  postCleanupPssMb?: number | null
  retainedMb?: number | null
  classification?: string | null
}

export interface EvaluationReportInput {
  phase: string
  timestamp: string
  modelId?: string | null
  modelName?: string | null
  deviceLabel?: string | null
  osVersion?: string | null
  /** True only when this came from a real device run. */
  deviceVerified: boolean
  datasetVersion?: string
  trackCount: number
  pairCount: number
  counts: { same: number, similar: number, different: number }
  sameVsDifferentAuc?: number | null
  similarVsDifferentAuc?: number | null
  sameVsSimilarAuc?: number | null
  overlapPercent?: number | null
  classStats?: ReportClassStats[]
  pairs?: ReportPairRow[]
  embeddingDimension?: number | null
  pooling?: string | null
  timings?: Record<string, number | null>
  memory?: ReportMemory
  verdict?: string | null
  warnings?: string[]
  blockers?: string[]
  nextAction?: string | null
}

const NM = 'NOT MEASURED'

function num(v: number | null | undefined, digits = 4): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : NM
}
function txt(v: unknown): string {
  // Coerces rather than assuming a string. This renderer is the last
  // step before a human pastes the result somewhere; a type surprise
  // in one field must not take down the whole export.
  if (v === null || v === undefined) return NM
  const s = typeof v === 'string' ? v : String(v)
  return s.trim() ? s : NM
}

export function toJson(r: EvaluationReportInput): string {
  return JSON.stringify(r, null, 2)
}

export function toMarkdown(r: EvaluationReportInput): string {
  const L: string[] = []
  L.push(`# SYSTEMA ${r.phase} — Labelled Evaluation Report`)
  L.push('')
  L.push(`- Timestamp: ${r.timestamp}`)
  L.push(`- Model: ${txt(r.modelName ?? r.modelId)}`)
  L.push(`- Device: ${txt(r.deviceLabel)} ${r.osVersion ? `(${r.osVersion})` : ''}`.trim())
  L.push(`- Device verified: ${r.deviceVerified ? 'YES' : 'NO — NOT DEVICE VERIFIED'}`)
  L.push(`- Dataset version: ${txt(r.datasetVersion)}`)
  L.push(`- Embedding dimension: ${r.embeddingDimension ?? NM}`)
  L.push(`- Pooling: ${txt(r.pooling)}`)
  L.push('')
  L.push('## Dataset')
  L.push('')
  L.push(`| Field | Value |`)
  L.push(`|---|---|`)
  L.push(`| Tracks | ${r.trackCount} |`)
  L.push(`| Pairs | ${r.pairCount} |`)
  L.push(`| SAME | ${r.counts.same} |`)
  L.push(`| SIMILAR | ${r.counts.similar} |`)
  L.push(`| DIFFERENT | ${r.counts.different} |`)
  L.push('')
  L.push('## Separation')
  L.push('')
  L.push(`| Metric | Value |`)
  L.push(`|---|---|`)
  L.push(`| SAME vs DIFFERENT AUC | ${num(r.sameVsDifferentAuc)} |`)
  L.push(`| SIMILAR vs DIFFERENT AUC | ${num(r.similarVsDifferentAuc)} |`)
  L.push(`| SAME vs SIMILAR AUC | ${num(r.sameVsSimilarAuc)} |`)
  L.push(`| Overlap % | ${num(r.overlapPercent, 2)} |`)
  L.push('')

  if (r.classStats?.length) {
    L.push('## Class distributions')
    L.push('')
    L.push('| Class | n | mean | median | P25 | P75 | min | max | sd |')
    L.push('|---|---|---|---|---|---|---|---|---|')
    for (const c of r.classStats) {
      L.push(`| ${c.label} | ${c.count} | ${num(c.mean)} | ${num(c.median)} `
        + `| ${num(c.p25)} | ${num(c.p75)} | ${num(c.min)} | ${num(c.max)} `
        + `| ${num(c.stdDev)} |`)
    }
    L.push('')
  }

  if (r.timings && Object.keys(r.timings).length) {
    L.push('## Performance')
    L.push('')
    L.push('| Stage | ms |')
    L.push('|---|---|')
    for (const [k, v] of Object.entries(r.timings)) {
      L.push(`| ${k} | ${num(v, 1)} |`)
    }
    L.push('')
  }

  L.push('## Memory')
  L.push('')
  const m = r.memory ?? {}
  L.push('| Checkpoint | MB |')
  L.push('|---|---|')
  L.push(`| Baseline PSS | ${num(m.baselinePssMb, 1)} |`)
  L.push(`| Peak PSS | ${num(m.peakPssMb, 1)} |`)
  L.push(`| Post-cleanup PSS | ${num(m.postCleanupPssMb, 1)} |`)
  L.push(`| Retained | ${num(m.retainedMb, 1)} |`)
  L.push(`| Classification | ${txt(m.classification)} |`)
  L.push('')

  if (r.pairs?.length) {
    L.push('## Pair results')
    L.push('')
    L.push('| Track A | Track B | Label | Cosine |')
    L.push('|---|---|---|---|')
    for (const p of r.pairs) {
      L.push(`| ${p.trackA} | ${p.trackB} | ${p.label} | ${num(p.cosine)} |`)
    }
    L.push('')
  }

  L.push('## Verdict')
  L.push('')
  L.push(txt(r.verdict))
  if (r.warnings?.length) {
    L.push('')
    L.push('### Warnings')
    for (const w of r.warnings) L.push(`- ${w}`)
  }
  if (r.blockers?.length) {
    L.push('')
    L.push('### Blockers')
    for (const b of r.blockers) L.push(`- ${b}`)
  }
  if (r.nextAction) {
    L.push('')
    L.push(`### Next action`)
    L.push(r.nextAction)
  }
  L.push('')
  L.push('_No production model was selected automatically._')
  return L.join('\n')
}

export function toPlainText(r: EvaluationReportInput): string {
  return toMarkdown(r)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^_/gm, '')
    .replace(/_$/gm, '')
    .replace(/\|/g, ' ')
}

/**
 * The short decision summary (§12 COPY SUMMARY): only what is needed
 * to make or discuss a call. Deliberately excludes per-pair rows.
 */
export function toSummary(r: EvaluationReportInput): string {
  const m = r.memory ?? {}
  const L: string[] = []
  L.push(`SYSTEMA ${r.phase} — SUMMARY`)
  L.push(`Timestamp: ${r.timestamp}`)
  L.push(`Model: ${txt(r.modelName ?? r.modelId)}`)
  L.push(`Device verified: ${r.deviceVerified ? 'YES' : 'NO'}`)
  L.push('')
  L.push(`Tracks: ${r.trackCount}`)
  L.push(`Pairs: ${r.pairCount}`)
  L.push(`SAME/SIMILAR/DIFFERENT: ${r.counts.same}/${r.counts.similar}/${r.counts.different}`)
  L.push('')
  L.push(`SAME vs DIFFERENT AUC: ${num(r.sameVsDifferentAuc)}`)
  L.push(`SIMILAR vs DIFFERENT AUC: ${num(r.similarVsDifferentAuc)}`)
  L.push(`SAME vs SIMILAR AUC: ${num(r.sameVsSimilarAuc)}`)
  L.push(`Overlap: ${num(r.overlapPercent, 2)}%`)
  L.push('')
  L.push(`Peak PSS: ${num(m.peakPssMb, 1)} MB`)
  L.push(`Retained: ${num(m.retainedMb, 1)} MB`)
  L.push(`Memory classification: ${txt(m.classification)}`)
  L.push('')
  L.push(`Result: ${txt(r.verdict)}`)
  if (r.blockers?.length) L.push(`Blockers: ${r.blockers.join('; ')}`)
  else L.push('Blockers: none recorded')
  L.push(`Next action: ${txt(r.nextAction)}`)
  L.push('')
  L.push('No production model was selected automatically.')
  return L.join('\n')
}

/** Triggers a browser download. No-op outside the client. */
export function downloadText(filename: string, content: string, mime = 'application/json') {
  if (!import.meta.client) return
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!import.meta.client) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  }
  catch {
    // Clipboard API is unavailable over plain http and in some
    // WebViews. Fall back rather than silently doing nothing.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    }
    catch {
      return false
    }
  }
}
