import { UNIT_NAMES, getUnitForBunk } from '../../utils/unitMapping'
import type { GenderScope } from './genderFilter'

export type FilterEdgeMode = 'strict' | 'cross-scope'

export interface FilterState {
  units: string[]
  /** Lowercase bunk codes (e.g. 'b-9'). Match server expectation. */
  bunks: string[]
  /** Active gender scope. 'all' = no gender filter (manual units/bunks apply). */
  gender: GenderScope
  edgeMode: FilterEdgeMode
}

export interface BunkSummary {
  cmId: number
  name: string
}

export function unitToSlug(unit: string): string {
  return unit.toLowerCase().replace(/\s+/g, '-')
}

/** Convert a bunk's display name to its URL/scope code. */
export function bunkToCode(name: string): string {
  return name.toLowerCase()
}

const SLUG_TO_UNIT: Record<string, string> = Object.fromEntries(
  UNIT_NAMES.map((u) => [unitToSlug(u), u])
)

export function parseFilterFromSearchParams(params: URLSearchParams): FilterState {
  const unitsRaw = params.get('units') ?? ''
  const bunksRaw = params.get('bunks') ?? ''
  const edgesRaw = params.get('edges') ?? ''

  const units = unitsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((slug) => SLUG_TO_UNIT[slug])
    .filter((u): u is string => Boolean(u))

  const bunks = bunksRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const edgeMode: FilterEdgeMode = edgesRaw === 'cross' ? 'cross-scope' : 'strict'

  const genderRaw = params.get('gender') ?? ''
  const gender: GenderScope =
    genderRaw === 'boys' || genderRaw === 'girls' || genderRaw === 'ag' ? genderRaw : 'all'

  return { units, bunks, gender, edgeMode }
}

/**
 * Build a new URLSearchParams from `base` with the filter encoded into the
 * `units`, `bunks`, and `edges` keys. Empty filter omits all three keys
 * entirely so the URL stays clean. Unrelated keys in `base` are preserved.
 */
export function serializeFilterToSearchParams(
  filter: FilterState,
  base: URLSearchParams
): URLSearchParams {
  const next = new URLSearchParams(base)
  next.delete('units')
  next.delete('bunks')
  next.delete('edges')
  next.delete('gender')

  if (filter.units.length > 0) {
    next.set('units', filter.units.map(unitToSlug).join(','))
  }
  if (filter.bunks.length > 0) {
    next.set('bunks', filter.bunks.join(','))
  }
  if (filter.edgeMode === 'cross-scope') {
    next.set('edges', 'cross')
  }
  if (filter.gender !== 'all') {
    next.set('gender', filter.gender)
  }
  return next
}

/**
 * Drop any bunk whose unit is already in the included units list.
 * Unknown bunks (no matching unit, or not present in `allBunks`) are kept
 * — the caller decides whether unknown bunks should ever land in state.
 *
 * Bunk identifiers are lowercase codes (e.g. 'b-9') matched case-insensitively
 * against bunk names in `allBunks`.
 */
export function normalizeFilter(
  input: { units: string[]; bunks: string[] },
  allBunks: BunkSummary[]
): { units: string[]; bunks: string[] } {
  const includedUnits = new Set(input.units)
  if (includedUnits.size === 0) {
    return {
      units: [...input.units],
      bunks: input.bunks.map((c) => c.toLowerCase()),
    }
  }
  const bunkByCode = new Map(allBunks.map((b) => [bunkToCode(b.name), b]))
  const bunks = input.bunks
    .map((c) => c.toLowerCase())
    .filter((code) => {
      const bunk = bunkByCode.get(code)
      if (!bunk) return true // unknown bunk: keep
      const unit = getUnitForBunk(bunk.name)
      if (unit && includedUnits.has(unit)) return false // absorbed
      return true
    })
  return { units: [...input.units], bunks }
}
