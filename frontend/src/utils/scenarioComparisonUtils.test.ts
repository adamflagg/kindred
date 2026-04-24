/**
 * Tests for scenario comparison page helpers.
 *
 * Covers:
 * - sortCampersByName: alphabetical sort (first name, then last name), locale-aware
 * - getAvailableBunkAreas: derives which area-filter buttons to show based on bunk genders
 */

import { describe, expect, it } from 'vitest'
import {
  compareCamperByName,
  sortCampersByName,
  getAvailableBunkAreas,
  type SortableCamper,
  type BunkWithGender,
} from './scenarioComparisonUtils'

describe('compareCamperByName', () => {
  it('sorts by first name first', () => {
    const a: SortableCamper = { firstName: 'Ada', lastName: 'Zimmerman' }
    const b: SortableCamper = { firstName: 'Zed', lastName: 'Adams' }
    expect(compareCamperByName(a, b)).toBeLessThan(0)
    expect(compareCamperByName(b, a)).toBeGreaterThan(0)
  })

  it('breaks ties by last name', () => {
    const a: SortableCamper = { firstName: 'Emma', lastName: 'Chen' }
    const b: SortableCamper = { firstName: 'Emma', lastName: 'Johnson' }
    expect(compareCamperByName(a, b)).toBeLessThan(0)
    expect(compareCamperByName(b, a)).toBeGreaterThan(0)
  })

  it('returns 0 for identical names', () => {
    const a: SortableCamper = { firstName: 'Olivia', lastName: 'Chen' }
    const b: SortableCamper = { firstName: 'Olivia', lastName: 'Chen' }
    expect(compareCamperByName(a, b)).toBe(0)
  })

  it('is locale-aware and case-insensitive (accented chars collate correctly)', () => {
    // 'Álvarez' should sort after 'Alvarez' in locale-aware compare (or at least
    // not throw; sensitivity:'base' treats them as equal)
    const base: SortableCamper = { firstName: 'Liam', lastName: 'Alvarez' }
    const accented: SortableCamper = { firstName: 'Liam', lastName: 'Álvarez' }
    // sensitivity:'base' treats base and accented as equal → result is 0
    expect(compareCamperByName(base, accented)).toBe(0)
  })

  it('handles empty strings without throwing', () => {
    const a: SortableCamper = { firstName: '', lastName: '' }
    const b: SortableCamper = { firstName: 'Emma', lastName: 'Johnson' }
    expect(() => compareCamperByName(a, b)).not.toThrow()
    expect(() => compareCamperByName(b, a)).not.toThrow()
  })
})

describe('sortCampersByName', () => {
  it('sorts campers alphabetically by first name then last name', () => {
    const campers: SortableCamper[] = [
      { firstName: 'Liam', lastName: 'Garcia' },
      { firstName: 'Emma', lastName: 'Johnson' },
      { firstName: 'Olivia', lastName: 'Chen' },
      { firstName: 'Adam', lastName: 'Johnson' },
    ]
    const sorted = sortCampersByName(campers)
    expect(sorted.map((c) => `${c.firstName} ${c.lastName}`)).toEqual([
      'Adam Johnson',
      'Emma Johnson',
      'Liam Garcia',
      'Olivia Chen',
    ])
  })

  it('is case-insensitive (locale-aware compare)', () => {
    const campers: SortableCamper[] = [
      { firstName: 'Emma', lastName: 'johnson' },
      { firstName: 'Adam', lastName: 'Johnson' },
      { firstName: 'Bob', lastName: 'JOHNSON' },
    ]
    const sorted = sortCampersByName(campers)
    // All three have same last name (case-insensitive); first names Adam < Bob < Emma
    expect(sorted.map((c) => c.firstName)).toEqual(['Adam', 'Bob', 'Emma'])
  })

  it('is a pure function (does not mutate input)', () => {
    const campers: SortableCamper[] = [
      { firstName: 'Zed', lastName: 'Zimmerman' },
      { firstName: 'Ada', lastName: 'Adams' },
    ]
    const original = campers.slice()
    sortCampersByName(campers)
    expect(campers).toEqual(original)
  })

  it('returns empty array when given empty input', () => {
    expect(sortCampersByName([])).toEqual([])
  })

  it('preserves unrelated fields on sorted output', () => {
    interface Extended extends SortableCamper {
      personCmId: number
      bunkName: string
    }
    const campers: Extended[] = [
      { firstName: 'Liam', lastName: 'Garcia', personCmId: 2, bunkName: 'B-Cedar' },
      { firstName: 'Emma', lastName: 'Johnson', personCmId: 1, bunkName: 'G-Oak' },
    ]
    const sorted = sortCampersByName(campers)
    // First-name primary: Emma (E) sorts before Liam (L)
    expect(sorted[0]).toEqual({
      firstName: 'Emma',
      lastName: 'Johnson',
      personCmId: 1,
      bunkName: 'G-Oak',
    })
    expect(sorted[1]).toEqual({
      firstName: 'Liam',
      lastName: 'Garcia',
      personCmId: 2,
      bunkName: 'B-Cedar',
    })
  })

  it('produces the same order regardless of input order (deterministic)', () => {
    const a: SortableCamper[] = [
      { firstName: 'Emma', lastName: 'Johnson' },
      { firstName: 'Olivia', lastName: 'Chen' },
      { firstName: 'Liam', lastName: 'Garcia' },
    ]
    const b: SortableCamper[] = [
      { firstName: 'Liam', lastName: 'Garcia' },
      { firstName: 'Emma', lastName: 'Johnson' },
      { firstName: 'Olivia', lastName: 'Chen' },
    ]
    expect(sortCampersByName(a)).toEqual(sortCampersByName(b))
  })
})

describe('getAvailableBunkAreas', () => {
  it('returns only "all" when there are no bunks', () => {
    expect(getAvailableBunkAreas([])).toEqual(['all'])
  })

  it('omits "ag" when no AG (Mixed-gender) bunks are present', () => {
    const bunks: BunkWithGender[] = [{ gender: 'M' }, { gender: 'F' }]
    expect(getAvailableBunkAreas(bunks)).toEqual(['all', 'boys', 'girls'])
  })

  it('includes "ag" when at least one AG bunk is present', () => {
    const bunks: BunkWithGender[] = [{ gender: 'M' }, { gender: 'F' }, { gender: 'Mixed' }]
    expect(getAvailableBunkAreas(bunks)).toEqual(['all', 'boys', 'girls', 'ag'])
  })

  it('omits "boys" when no male-gender bunks are present', () => {
    const bunks: BunkWithGender[] = [{ gender: 'F' }, { gender: 'Mixed' }]
    const areas = getAvailableBunkAreas(bunks)
    expect(areas).toContain('all')
    expect(areas).toContain('girls')
    expect(areas).toContain('ag')
    expect(areas).not.toContain('boys')
  })

  it('omits "girls" when no female-gender bunks are present', () => {
    const bunks: BunkWithGender[] = [{ gender: 'M' }, { gender: 'Mixed' }]
    const areas = getAvailableBunkAreas(bunks)
    expect(areas).toContain('all')
    expect(areas).toContain('boys')
    expect(areas).toContain('ag')
    expect(areas).not.toContain('girls')
  })

  it('always keeps "all" as the first option', () => {
    const bunks: BunkWithGender[] = [{ gender: 'Mixed' }]
    const areas = getAvailableBunkAreas(bunks)
    expect(areas[0]).toBe('all')
  })

  it('returns filter options in stable order: all, boys, girls, ag', () => {
    const bunks: BunkWithGender[] = [{ gender: 'Mixed' }, { gender: 'F' }, { gender: 'M' }]
    expect(getAvailableBunkAreas(bunks)).toEqual(['all', 'boys', 'girls', 'ag'])
  })
})
