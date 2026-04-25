/**
 * Deterministic graph color utilities for social network visualization.
 *
 * Covers feedback items:
 * #31 — One color per unit applied to all bunks in that unit
 * #33 — Globally stable colors keyed on canonical unit name. The same unit
 *       (e.g. "Chalutzim 1") gets the same color across every session/scenario,
 *       regardless of which other units happen to be present in the current graph.
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

/**
 * Fallback color for unit names not in UNIT_NAMES. Stable hash → palette index
 * so unknown units still get a consistent color across renders.
 */
function hashStringToPaletteIndex(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % UNIT_PALETTE.length
}

/**
 * Get a stable color for a unit name. The color depends ONLY on the canonical
 * unit name — not on which other units are present in the current graph.
 *
 * `allUnits` is accepted for backward compatibility but ignored (#33).
 *
 * @param unitName  - The unit name (e.g. "Eilat")
 * @param _allUnits - Unused. Retained for API compatibility with prior per-session impl.
 */
export function getUnitColorByName(unitName: string, _allUnits?: string[]): string {
  void _allUnits
  const idx = UNIT_NAMES.indexOf(unitName as (typeof UNIT_NAMES)[number])
  if (idx !== -1) {
    return UNIT_PALETTE[idx % UNIT_PALETTE.length] as string
  }
  return UNIT_PALETTE[hashStringToPaletteIndex(unitName)] as string
}

/**
 * Get a stable color for a bunk by resolving it to its unit, then looking up
 * the canonical unit color (#33: globally stable, not per-bunk-set).
 *
 * All bunks in the same unit get the same color across all sessions.
 *
 * @param bunkName   - The bunk name (e.g. "B-5", "G-12", "Aleph")
 * @param _allBunks  - Unused. Retained for API compatibility.
 */
export function getUnitColorForBunk(bunkName: string, _allBunks?: string[]): string {
  void _allBunks
  const unit = getUnitForBunk(bunkName)
  if (!unit) {
    // Unknown bunk — use a neutral fallback color
    return '#888888'
  }
  return getUnitColorByName(unit)
}
