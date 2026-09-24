/**
 * Q9 for CURRENT-YEAR rows (owner ruling 2026-09-22, late): a TLI/SCIT row's
 * cabin comes ONLY from the registry-resolved teen_cabins map, keyed (year,
 * session) — never the raw CampMinder bunk (usually a program group). Quest
 * never shows a cabin. kindred#2812: an adult-program row's comes ONLY from
 * the attributed adult_cabins map, the same way — and a family weekend's
 * from the household's family_cabins map (owner ruling 2026-09-24, on #2814).
 */
import { describe, it, expect } from 'vitest'
import { cabinsByWeekend, currentYearCabin, type ServerCabins } from './teenCabinLabel'

const NONE = cabinsByWeekend([])

/** The three server-named cabin maps, empty unless a test fills one. */
function cabins(filled: Partial<ServerCabins> = {}): ServerCabins {
  return { teen: NONE, adult: NONE, family: NONE, ...filled }
}

describe('currentYearCabin', () => {
  it('hides a program-group bunk for an unresolved current-year SCIT row', () => {
    const teenCabins = cabinsByWeekend([])
    const result = currentYearCabin('scit', 2026, 700, 'SCIT A', cabins({ teen: teenCabins }))
    expect(result.bunkName).toBeUndefined()
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('shows the registry name for a resolved current-year teen row, with the as-typed name on hover', () => {
    const teenCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 700, cabin_name: 'Village Cabin 2', cabin_name_raw: 'Teen 2' },
    ])
    const result = currentYearCabin(
      'scit',
      2026,
      700,
      'irrelevant raw bunk',
      cabins({ teen: teenCabins })
    )
    expect(result.bunkName).toBe('Village Cabin 2')
    expect(result.bunkNameRecorded).toBe('Teen 2')
  })

  it('omits the hover string when the registry name already matches the as-typed one', () => {
    const teenCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 700, cabin_name: 'Teen 2', cabin_name_raw: 'Teen 2' },
    ])
    const result = currentYearCabin('tli', 2026, 700, undefined, cabins({ teen: teenCabins }))
    expect(result.bunkName).toBe('Teen 2')
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('never shows a cabin for a current-year Quest row, even with an assigned bunk', () => {
    const teenCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 900, cabin_name: 'Village Cabin 2', cabin_name_raw: 'Teen 2' },
    ])
    const result = currentYearCabin('quest', 2026, 900, 'Trip Name', cabins({ teen: teenCabins }))
    expect(result.bunkName).toBeUndefined()
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('keeps the raw bunk name for every other session type unchanged', () => {
    const teenCabins = cabinsByWeekend([])
    const result = currentYearCabin('main', 2026, 500, 'Cabin 5', cabins({ teen: teenCabins }))
    expect(result.bunkName).toBe('Cabin 5')
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  // kindred#2812: the adult half of the same rule — the cabin the server
  // attributed to THIS weekend (field 223823, or the per-weekend live row),
  // today's registry name with the as-typed string on hover. Never the raw
  // CampMinder bunk.
  it('shows the attributed registry name for a current-year adult row, never its raw bunk', () => {
    const adultCabins = cabinsByWeekend([
      {
        year: 2026,
        session_cm_id: 1001,
        cabin_name: 'Meadow House 1',
        cabin_name_raw: 'Old Meadow 1',
      },
    ])
    const result = currentYearCabin('adult', 2026, 1001, 'Raw Bunk', cabins({ adult: adultCabins }))
    expect(result.bunkName).toBe('Meadow House 1')
    expect(result.bunkNameRecorded).toBe('Old Meadow 1')
  })

  it('shows no cabin for a current-year adult row nobody has typed a cabin for yet', () => {
    const adultCabins = cabinsByWeekend([
      { year: 2025, session_cm_id: 1001, cabin_name: 'River F', cabin_name_raw: 'River F' },
    ])
    const result = currentYearCabin('adult', 2026, 1001, 'Raw Bunk', cabins({ adult: adultCabins }))
    expect(result).toEqual({})
  })

  it('never reads an adult cabin for a non-adult row', () => {
    const adultCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 500, cabin_name: 'River F', cabin_name_raw: 'River F' },
    ])
    const result = currentYearCabin('main', 2026, 500, 'Cabin 5', cabins({ adult: adultCabins }))
    expect(result.bunkName).toBe('Cabin 5')
  })

  // Owner ruling 2026-09-24 (on #2814): a child's current-year family-camp
  // row shows the household cabin — "there's no reason not to" — today's
  // registry name, the as-typed string on hover (kindred#2332). Never the raw
  // bunk: for a family session that is the CampMinder day group (kindred#2466).
  it("shows the household's cabin for a current-year family row, never its raw bunk", () => {
    const family = cabinsByWeekend([
      {
        year: 2026,
        session_cm_id: 106,
        cabin_name: 'Meadow House 1',
        cabin_name_raw: 'Old Meadow 1',
      },
    ])
    const result = currentYearCabin('family', 2026, 106, 'Acorns', cabins({ family }))
    expect(result).toEqual({ bunkName: 'Meadow House 1', bunkNameRecorded: 'Old Meadow 1' })
  })

  it('shows no cabin for a current-year family weekend the household has no cabin for', () => {
    const family = cabinsByWeekend([
      { year: 2026, session_cm_id: 101, cabin_name: 'Cedar Lodge', cabin_name_raw: 'Cedar Lodge' },
    ])
    const result = currentYearCabin('family', 2026, 106, 'Acorns', cabins({ family }))
    expect(result).toEqual({})
  })

  it('never reads a family cabin for an adult or summer row', () => {
    const family = cabinsByWeekend([
      { year: 2026, session_cm_id: 500, cabin_name: 'Cedar Lodge', cabin_name_raw: 'Cedar Lodge' },
    ])
    expect(currentYearCabin('adult', 2026, 500, undefined, cabins({ family }))).toEqual({})
    expect(currentYearCabin('main', 2026, 500, 'Cabin 5', cabins({ family })).bunkName).toBe(
      'Cabin 5'
    )
  })

  it('reports no bunk name for a non-teen/quest session with nothing assigned', () => {
    const teenCabins = cabinsByWeekend([])
    const result = currentYearCabin('main', 2026, 500, undefined, cabins({ teen: teenCabins }))
    expect(result.bunkName).toBeUndefined()
  })
})
