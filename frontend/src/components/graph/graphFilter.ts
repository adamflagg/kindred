import { UNIT_NAMES, getUnitForBunk } from '../../utils/unitMapping'

export type FilterEdgeMode = 'strict' | 'cross-scope'

export interface FilterState {
  units: string[]
  bunks: number[]
  edgeMode: FilterEdgeMode
}

export interface BunkSummary {
  cmId: number
  name: string
}

export function unitToSlug(unit: string): string {
  return unit.toLowerCase().replace(/\s+/g, '-')
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
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)

  const edgeMode: FilterEdgeMode = edgesRaw === 'cross' ? 'cross-scope' : 'strict'

  return { units, bunks, edgeMode }
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

  if (filter.units.length > 0) {
    next.set('units', filter.units.map(unitToSlug).join(','))
  }
  if (filter.bunks.length > 0) {
    next.set('bunks', filter.bunks.join(','))
  }
  if (filter.edgeMode === 'cross-scope') {
    next.set('edges', 'cross')
  }
  return next
}

/**
 * Drop any bunk whose unit is already in the included units list.
 * Unknown bunks (no matching unit, or not present in `allBunks`) are kept
 * — the caller decides whether unknown bunks should ever land in state.
 */
export function normalizeFilter(
  input: { units: string[]; bunks: number[] },
  allBunks: BunkSummary[]
): { units: string[]; bunks: number[] } {
  const includedUnits = new Set(input.units)
  if (includedUnits.size === 0) {
    return { units: [...input.units], bunks: [...input.bunks] }
  }
  const bunkById = new Map(allBunks.map((b) => [b.cmId, b]))
  const bunks = input.bunks.filter((cmId) => {
    const bunk = bunkById.get(cmId)
    if (!bunk) return true // unknown bunk: keep
    const unit = getUnitForBunk(bunk.name)
    if (unit && includedUnits.has(unit)) return false // absorbed
    return true
  })
  return { units: [...input.units], bunks }
}
