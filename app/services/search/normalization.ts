// ============================================================
// SYSTEMA — Multilingual Search Normalization & Fuzzy Helpers
// ============================================================
// Robust normalization for English, Persian, and mixed queries.
// Handles case folding, Persian/Arabic letter standardization,
// zero-width characters, punctuation, and Levenshtein fuzzy distance.
// ============================================================

/**
 * Standardize Persian & Arabic character variants into canonical Persian.
 * Converts:
 *   ي, ى  → ی
 *   ك    → ک
 *   ۀ, ة  → ه
 *   ؤ, إ, أ, آ → ا (for search matching purposes)
 *   ZWNJ (\u200C) → space (or stripped)
 *   Arabic diacritics (harakat / tanween) → removed
 */
export function normalizePersian(text: string): string {
  if (!text) return ''

  return text
    // Remove Arabic diacritics (Fathah, Dammah, Kasrah, Tanween, Sukun, Tashdid)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Standardize Yeh
    .replace(/[\u064A\u0649\u06CC]/g, 'ی')
    // Standardize Kaf
    .replace(/[\u0643]/g, 'ک')
    // Standardize Heh variants
    .replace(/[\u0629\u06C0]/g, 'ه')
    // Standardize Alef variants
    .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
    // Standardize Waw with Hamza
    .replace(/[\u0624]/g, 'و')
    // Zero-width non-joiner & zero-width space
    .replace(/[\u200C\u200B\u200D\uFEFF]/g, ' ')
}

/**
 * Complete query normalization for matching:
 * 1. Lowercase English
 * 2. Standardize Persian/Arabic glyphs
 * 3. Remove punctuation / noise characters
 * 4. Collapse consecutive whitespaces
 * 5. Trim
 */
export function normalizeQuery(query: string): string {
  if (!query) return ''

  const persianNormalized = normalizePersian(query)

  return persianNormalized
    .toLowerCase()
    // Replace punctuation with spaces to treat hyphenated or punctuated words cleanly
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»[\]\\]/g, ' ')
    // Collapse multiple spaces into one
    .replace(/\s+/g, ' ')
    .trim()
}

export const normalizeText = normalizeQuery

/**
 * Detect language of query: 'fa' | 'en' | 'mixed'
 */
export function detectLanguage(text: string): 'en' | 'fa' | 'mixed' {
  const hasPersian = /[\u0600-\u06FF]/.test(text)
  const hasLatin = /[a-zA-Z]/.test(text)

  if (hasPersian && hasLatin) return 'mixed'
  if (hasPersian) return 'fa'
  return 'en'
}

/**
 * Levenshtein distance calculation for fuzzy matching.
 * Optimized with two-row matrix for minimal memory allocation.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array(b.length + 1)

  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1
    const codeA = a.charCodeAt(i)

    for (let j = 0; j < b.length; j++) {
      const cost = codeA === b.charCodeAt(j) ? 0 : 1
      curr[j + 1] = Math.min(
        curr[j] + 1,        // insertion
        prev[j + 1] + 1,    // deletion
        prev[j] + cost      // substitution
      )
    }

    const temp = prev
    prev = curr
    curr = temp
  }

  return prev[b.length]!
}

/**
 * Fuzzy match score between 0 and 1.
 * 1 = exact match
 * 0 = completely different
 */
export function fuzzyScore(needle: string, haystack: string): number {
  if (haystack === needle) return 1.0
  if (haystack.includes(needle)) return 0.95

  const maxLen = Math.max(needle.length, haystack.length)
  if (maxLen === 0) return 1

  // Check if needle is close to any word in haystack
  const words = haystack.split(/\s+/)
  let bestScore = 0

  for (const word of words) {
    if (word === needle) return 1
    if (word.startsWith(needle)) return 0.9
    if (word.includes(needle)) return 0.85

    const dist = levenshtein(needle, word)
    const threshold = needle.length <= 4 ? 1 : needle.length <= 7 ? 2 : 3
    if (dist <= threshold) {
      const score = Math.max(0, 1 - dist / Math.max(needle.length, word.length))
      if (score > bestScore) bestScore = score
    }
  }

  // Also test against full haystack if short
  if (bestScore === 0 && Math.abs(needle.length - haystack.length) <= 3) {
    const dist = levenshtein(needle, haystack)
    if (dist <= 3) {
      bestScore = Math.max(0, 1 - dist / maxLen)
    }
  }

  return bestScore
}
