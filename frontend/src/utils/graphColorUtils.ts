/**
 * Deterministic graph color utilities for social network visualization.
 *
 * Covers feedback items:
 * #31 — One color per unit applied to all bunks in that unit
 * #33 — Deterministic/static colors (same set of units → same colors every render)
 */
import { getUnitForBunk, UNIT_NAMES } from './unitMapping'

/**
 * Palette of distinct colors for unit grouping.
 * Chosen to be visually distinct and accessible; cycles if more than 7 units.
 * Reuses the muted tone aesthetic already present in UNIT_COLORS from unitMapping.ts
 * but brighter for better visibility.
 */
export const UNIT_PALETTE: readonly string[] = [
  '#5b8fa8', // muted blue
  '#8a7355', // warm tan
  '#6b8a5e', // sage green
  '#8a5e7a', // muted mauve
  '#5e7a8a', // slate
  '#8a6b5e', // terracotta
  '#7a8a5e', // olive
  '#6b5e8a', // dusty violet
  '#5e8a7a', // teal-grey
]

/** Cache: sorted unit list key → (unit name → color) */
const _colorCache = new Map<string, Map<string, string>>()

/**
 * Build a stable unit-name → color mapping for a given set of unit names.
 * Unit names are sorted in canonical age order (youngest→oldest per UNIT_NAMES),
 * then assigned palette colors by sorted index so identical sets always map
 * to identical colors regardless of insertion order.
 */
function buildUnitColorMap(unitNames: Iterable<string>): Map<string, string> {
  const unique = new Set(unitNames)

  // Sort by canonical UNIT_NAMES order first; unknowns go alphabetically at end
  const sorted = [...unique].sort((a, b) => {
    const ia = UNIT_NAMES.indexOf(a as (typeof UNIT_NAMES)[number])
    const ib = UNIT_NAMES.indexOf(b as (typeof UNIT_NAMES)[number])
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })

  const map = new Map<string, string>()
  sorted.forEach((unitName, idx) => {
    map.set(unitName, UNIT_PALETTE[idx % UNIT_PALETTE.length] as string)
  })
  return map
}

/**
 * Get a stable color for a unit name, given the full list of unit names present.
 *
 * @param unitName  - The unit name (e.g. "Eilat")
 * @param allUnits  - All unit names present in the current graph
 */
export function getUnitColorByName(unitName: string, allUnits: string[]): string {
  const cacheKey = [...new Set(allUnits)].sort().join('|')
  let map = _colorCache.get(cacheKey)
  if (!map) {
    map = buildUnitColorMap(allUnits)
    _colorCache.set(cacheKey, map)
  }
  return map.get(unitName) ?? (UNIT_PALETTE[0] as string)
}

/**
 * Get a stable color for a bunk by resolving it to its unit, then looking up
 * the unit color within the palette assignment for the present bunk set.
 *
 * All bunks in the same unit get the same color.
 * Same set of bunk names → same mapping every time (deterministic).
 *
 * @param bunkName   - The bunk name (e.g. "B-5", "G-12", "Aleph")
 * @param allBunks   - All bunk names present in the current graph
 */
export function getUnitColorForBunk(bunkName: string, allBunks: string[]): string {
  // Derive the set of units present in this graph
  const unitSet = new Set<string>()
  for (const name of allBunks) {
    const unit = getUnitForBunk(name)
    if (unit) unitSet.add(unit)
  }

  const unit = getUnitForBunk(bunkName)
  if (!unit) {
    // Unknown bunk — use a neutral fallback color
    return '#888888'
  }

  return getUnitColorByName(unit, [...unitSet])
}
