/**
 * Which adult Jotform filing a typed write-in name looks like (kindred#2839
 * follow-up). The board's "From Jotform" picker uses it to suggest the filer
 * as staff type.
 *
 * The filer's side is the SERVER's: each filing arrives with its folded names
 * in `suggest_write_in`'s exact tiers (`name_tiers`, api/services/jotform_queue.py),
 * so the rules for which names a filer answers to -- nametag parsing, "prefer
 * just ..." -- live in one place. This file folds only what staff typed, scores
 * it with the same Jaro-Winkler, and decides:
 *
 *   1. exact: the first tier any filing's names contain the typed name decides,
 *      and it picks only when exactly ONE filer is in it;
 *   2. similar: otherwise the one filer whose closest name scores at least
 *      SIMILAR_THRESHOLD, strictly above every other filer (`_similar_write_in`).
 *
 * One filer's several filings (`same_filer`: the same folded first + last
 * name) are one filer here, answered by the first of them: linking any one
 * links the rest (one filer, one decision).
 *
 * `tests/fixtures/jotform_filer_match_cases.json` pins all of it against the
 * server; `filerMatch.parity.test.ts` and its Python twin read the same file.
 */

/** Mirrors `jotform_queue.SIMILAR_THRESHOLD`; the parity test holds them together. */
export const SIMILAR_THRESHOLD = 0.85

export interface FilerNames {
  submissionId: string
  /** The server's `name_tiers`: four tiers of folded names, best first. */
  nameTiers: ReadonlyArray<readonly string[]>
}

export interface FilerMatch {
  kind: 'exact' | 'similar'
  submissionId: string
}

/** Case- and accent-folded, whitespace collapsed: `jotform_bunking.fold`. */
export function foldName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .join(' ')
}

function jaro(a: string, b: string): number {
  if (a === b) return 1
  if (a === '' || b === '') return 0
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aHit = new Array<boolean>(a.length).fill(false)
  const bHit = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const end = Math.min(i + window + 1, b.length)
    for (let j = Math.max(0, i - window); j < end; j++) {
      if (bHit[j] === true || a[i] !== b[j]) continue
      aHit[i] = true
      bHit[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (aHit[i] !== true) continue
    while (bHit[k] !== true) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
}

/** Jaro-Winkler as rapidfuzz scores it: prefix up to 4, weight 0.1, boost above 0.7. */
export function jaroWinkler(a: string, b: string): number {
  const score = jaro(a, b)
  if (score <= 0.7) return score
  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  return score + prefix * 0.1 * (1 - score)
}

/** Who filed: `same_filer`'s folded first + last name, or the filing alone. */
function filerOf(filing: FilerNames): string {
  return filing.nameTiers[0]?.[0] ?? `filing:${filing.submissionId}`
}

/** The first filing of each filer, in the order given. */
function firstPerFiler(filings: readonly FilerNames[]): FilerNames[] {
  const seen = new Map<string, FilerNames>()
  for (const filing of filings) {
    const filer = filerOf(filing)
    if (!seen.has(filer)) seen.set(filer, filing)
  }
  return [...seen.values()]
}

export function matchFiler(typed: string, filings: readonly FilerNames[]): FilerMatch | null {
  const name = foldName(typed)
  if (name === '') return null
  const filers = firstPerFiler(filings)

  const tiers = Math.max(0, ...filers.map((filing) => filing.nameTiers.length))
  for (let tier = 0; tier < tiers; tier++) {
    const hits = filers.filter((filing) => (filing.nameTiers[tier] ?? []).includes(name))
    const [only] = hits
    if (only === undefined) continue
    return hits.length === 1 ? { kind: 'exact', submissionId: only.submissionId } : null
  }

  const scored = filers
    .map((filing) => ({
      filing,
      score: Math.max(0, ...filing.nameTiers.flat().map((variant) => jaroWinkler(name, variant))),
    }))
    .sort((a, b) => b.score - a.score)
  const [best, next] = scored
  if (best === undefined || best.score < SIMILAR_THRESHOLD) return null
  if (next !== undefined && next.score >= best.score) return null
  return { kind: 'similar', submissionId: best.filing.submissionId }
}
