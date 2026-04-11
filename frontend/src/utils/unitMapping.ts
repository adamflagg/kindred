/**
 * Unit mapping utility
 * Maps bunk/cabin names to camp unit names.
 *
 * Bunk naming convention:
 *   B-{n}  = Boys cabin n
 *   G-{n}  = Girls cabin n
 *   AG-{n} = Adventure Group cabin n
 *   Aleph / Bet = Nitzanim (youngest campers)
 *
 * Unit structure:
 *   Nitzanim    → Aleph, Bet
 *   Carmel      → cabins 1, 2
 *   Galil       → cabins 3, 4
 *   Eilat       → cabins 5, 6
 *   Haifa       → cabins 7, 8
 *   Chalutzim 1 → cabins 9, 10
 *   Chalutzim 2 → cabins 11, 12
 */

/** Map of cabin number to unit name */
const CABIN_NUMBER_TO_UNIT: Record<number, string> = {
  1: 'Carmel',
  2: 'Carmel',
  3: 'Galil',
  4: 'Galil',
  5: 'Eilat',
  6: 'Eilat',
  7: 'Haifa',
  8: 'Haifa',
  9: 'Chalutzim 1',
  10: 'Chalutzim 1',
  11: 'Chalutzim 2',
  12: 'Chalutzim 2',
}

/** Special name mappings (case-insensitive) */
const SPECIAL_NAME_TO_UNIT: Record<string, string> = {
  aleph: 'Nitzanim',
  bet: 'Nitzanim',
}

/** Regex to extract cabin number from gendered bunk names (B-5, G-12, AG-3) */
const BUNK_NUMBER_REGEX = /^(?:B|G|AG)-(\d+)$/i

/** Muted colors for unit-level grouping (distinct from bunk bubble colors) */
export const UNIT_COLORS: Record<string, string> = {
  Nitzanim: '#7c8a5e',
  Carmel: '#6b7b94',
  Galil: '#8b7355',
  Eilat: '#7a6b8a',
  Haifa: '#5e8a7c',
  'Chalutzim 1': '#8a6b6b',
  'Chalutzim 2': '#6b7b6b',
}

/** All unit names in age order (youngest to oldest) */
export const UNIT_NAMES = [
  'Nitzanim',
  'Carmel',
  'Galil',
  'Eilat',
  'Haifa',
  'Chalutzim 1',
  'Chalutzim 2',
] as const

/**
 * Get the unit name for a bunk name.
 * Handles gendered variants (B-, G-, AG-) mapping to the same unit.
 *
 * @param bunkName - The bunk name (e.g. "B-5", "G-12", "Aleph")
 * @returns The unit name, or null if the bunk name is not recognized
 */
export function getUnitForBunk(bunkName: string): string | null {
  if (!bunkName) return null

  // Check special names first (case-insensitive)
  const lower = bunkName.toLowerCase().trim()
  if (lower in SPECIAL_NAME_TO_UNIT) {
    return SPECIAL_NAME_TO_UNIT[lower] ?? null
  }

  // Try to extract cabin number from gendered pattern
  const match = bunkName.match(BUNK_NUMBER_REGEX)
  if (match?.[1]) {
    const cabinNumber = parseInt(match[1], 10)
    return CABIN_NUMBER_TO_UNIT[cabinNumber] ?? null
  }

  return null
}
