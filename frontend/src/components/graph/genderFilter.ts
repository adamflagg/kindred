/**
 * Pure helpers for the gender/AG tab selector on the session social-network graph.
 *
 * Gender is derived from bunk names via the same `getBunkType` helper used by
 * BunkSocialGraphModal (and its predecessor) — no new classification logic.
 *
 * - B-* bunks  → "Boys"
 * - G-* bunks  → "Girls"
 * - AG* bunks  → "AG"
 */
import { getBunkType } from '../../utils/bunkNaming'

/** The four tabs shown in the gender/AG tab bar. */
export type GenderTab = 'All' | 'Boys' | 'Girls' | 'AG'

/**
 * A bunk summary that includes the lowercase bunk code used by the graph filter.
 * The `code` field is `bunk.name.toLowerCase()` — the same format stored in
 * `FilterState.bunks` and accepted by `addBunk` / `removeBunk`.
 */
export interface BunkSummaryWithGender {
  cmId: number
  name: string
  /** Lowercase bunk code (e.g. 'b-9') — matches FilterState.bunks encoding. */
  code: string
}

/**
 * Return the subset of bunk codes that match `tab`.
 *
 * "All" returns codes for every bunk.
 * "Boys" / "Girls" / "AG" filter by the bunk's type classification.
 *
 * The result is in the same order as the input `bunks` array so callers get
 * stable ordering without needing to sort.
 */
export function filterBunksByGender(bunks: BunkSummaryWithGender[], tab: GenderTab): string[] {
  if (tab === 'All') return bunks.map((b) => b.code)

  const typeTarget = tab === 'Boys' ? 'B' : tab === 'Girls' ? 'G' : 'AG'
  return bunks.filter((b) => getBunkType(b.name) === typeTarget).map((b) => b.code)
}

/** URL-facing gender scope value (lowercase). 'all' is the default/absent state. */
export type GenderScope = 'all' | 'boys' | 'girls' | 'ag'

/** Map a URL scope to its display tab label. */
export function scopeToTab(scope: GenderScope): GenderTab {
  switch (scope) {
    case 'all':
      return 'All'
    case 'boys':
      return 'Boys'
    case 'girls':
      return 'Girls'
    case 'ag':
      return 'AG'
  }
}

/** Map a display tab label to its URL scope. */
export function tabToScope(tab: GenderTab): GenderScope {
  switch (tab) {
    case 'All':
      return 'all'
    case 'Boys':
      return 'boys'
    case 'Girls':
      return 'girls'
    case 'AG':
      return 'ag'
  }
}
