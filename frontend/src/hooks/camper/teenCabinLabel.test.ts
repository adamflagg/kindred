/**
 * Q9 for CURRENT-YEAR rows (owner ruling 2026-09-22, late): a TLI/SCIT row's
 * cabin comes ONLY from the registry-resolved teen_cabins map, keyed (year,
 * session) — never the raw CampMinder bunk (usually a program group). Quest
 * never shows a cabin.
 */
import { describe, it, expect } from 'vitest'
import { cabinsByWeekend, currentYearCabin } from './teenCabinLabel'

describe('currentYearCabin', () => {
  it('hides a program-group bunk for an unresolved current-year SCIT row', () => {
    const teenCabins = cabinsByWeekend([])
    const result = currentYearCabin('scit', 2026, 700, 'SCIT A', teenCabins)
    expect(result.bunkName).toBeUndefined()
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('shows the registry name for a resolved current-year teen row, with the as-typed name on hover', () => {
    const teenCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 700, cabin_name: 'Village Cabin 2', cabin_name_raw: 'Teen 2' },
    ])
    const result = currentYearCabin('scit', 2026, 700, 'irrelevant raw bunk', teenCabins)
    expect(result.bunkName).toBe('Village Cabin 2')
    expect(result.bunkNameRecorded).toBe('Teen 2')
  })

  it('omits the hover string when the registry name already matches the as-typed one', () => {
    const teenCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 700, cabin_name: 'Teen 2', cabin_name_raw: 'Teen 2' },
    ])
    const result = currentYearCabin('tli', 2026, 700, undefined, teenCabins)
    expect(result.bunkName).toBe('Teen 2')
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('never shows a cabin for a current-year Quest row, even with an assigned bunk', () => {
    const teenCabins = cabinsByWeekend([
      { year: 2026, session_cm_id: 900, cabin_name: 'Village Cabin 2', cabin_name_raw: 'Teen 2' },
    ])
    const result = currentYearCabin('quest', 2026, 900, 'Trip Name', teenCabins)
    expect(result.bunkName).toBeUndefined()
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('keeps the raw bunk name for every other session type unchanged', () => {
    const teenCabins = cabinsByWeekend([])
    const result = currentYearCabin('main', 2026, 500, 'Cabin 5', teenCabins)
    expect(result.bunkName).toBe('Cabin 5')
    expect(result.bunkNameRecorded).toBeUndefined()
  })

  it('reports no bunk name for a non-teen/quest session with nothing assigned', () => {
    const teenCabins = cabinsByWeekend([])
    const result = currentYearCabin('main', 2026, 500, undefined, teenCabins)
    expect(result.bunkName).toBeUndefined()
  })
})
