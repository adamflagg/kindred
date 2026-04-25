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
  computeImpactedCabins,
  type SortableCamper,
  type BunkWithGender,
  type MovedEntry,
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

// ---------------------------------------------------------------------------
// computeImpactedCabins
// ---------------------------------------------------------------------------

describe('computeImpactedCabins', () => {
  // Helper to build a moved entry with the minimum fields needed.
  // Uses a counter rather than Math.random() for determinism.
  let moveCounter = 0
  const makeMove = (fromBunk: string, toBunk: string): MovedEntry => ({
    camper: { personCmId: ++moveCounter },
    fromBunk: { id: 'id-' + fromBunk, name: fromBunk },
    toBunk: { id: 'id-' + toBunk, name: toBunk },
  })

  it('returns empty array when moved list is empty', () => {
    expect(computeImpactedCabins([])).toEqual([])
  })

  it('collects distinct cabin names from both From and To columns', () => {
    const moved = [makeMove('Olive', 'Maple')]
    const chips = computeImpactedCabins(moved)
    expect(chips.map((c) => c.name)).toContain('Olive')
    expect(chips.map((c) => c.name)).toContain('Maple')
    expect(chips).toHaveLength(2)
  })

  it('counts each camper only once per cabin even if they touch it as both origin and destination', () => {
    // Camper A: Olive → Maple  (Olive = from, Maple = to)
    // Camper B: Maple → Olive  (Maple = from, Olive = to)
    // Each cabin has 2 campers affected — no double-count
    const moved = [makeMove('Olive', 'Maple'), makeMove('Maple', 'Olive')]
    const chips = computeImpactedCabins(moved)
    const olive = chips.find((c) => c.name === 'Olive')!
    const maple = chips.find((c) => c.name === 'Maple')!
    expect(olive.count).toBe(2)
    expect(maple.count).toBe(2)
  })

  it('counts a camper who moves from Olive to Maple exactly once for each cabin', () => {
    const moved = [makeMove('Olive', 'Maple')]
    const chips = computeImpactedCabins(moved)
    const olive = chips.find((c) => c.name === 'Olive')!
    const maple = chips.find((c) => c.name === 'Maple')!
    expect(olive.count).toBe(1)
    expect(maple.count).toBe(1)
  })

  it('does NOT double-count a camper who moves between two listed cabins (single move, both cabins listed)', () => {
    // 3 campers move Olive→Maple; Olive and Maple each have 3, not 6
    const moved = [
      makeMove('Olive', 'Maple'),
      makeMove('Olive', 'Maple'),
      makeMove('Olive', 'Maple'),
    ]
    const chips = computeImpactedCabins(moved)
    const olive = chips.find((c) => c.name === 'Olive')!
    const maple = chips.find((c) => c.name === 'Maple')!
    expect(olive.count).toBe(3)
    expect(maple.count).toBe(3)
  })

  it('returns cabins in alphabetical order', () => {
    const moved = [makeMove('Spruce', 'Alder'), makeMove('Birch', 'Fir')]
    const chips = computeImpactedCabins(moved)
    const names = chips.map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('deduplicates cabin names that appear in multiple rows', () => {
    const moved = [makeMove('Olive', 'Cedar'), makeMove('Maple', 'Olive')]
    const chips = computeImpactedCabins(moved)
    // Olive appears as both from and to — only one chip for Olive
    const oliveChips = chips.filter((c) => c.name === 'Olive')
    expect(oliveChips).toHaveLength(1)
  })

  it('accumulates counts across multiple moves touching the same cabin', () => {
    // 2 campers leave Olive; 1 camper arrives at Olive — 3 total affected
    const moved = [
      makeMove('Olive', 'Cedar'),
      makeMove('Olive', 'Maple'),
      makeMove('Birch', 'Olive'),
    ]
    const chips = computeImpactedCabins(moved)
    const olive = chips.find((c) => c.name === 'Olive')!
    expect(olive.count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// computeImpactedCabins — visibleCabinNames filter (gender area filter)
// ---------------------------------------------------------------------------

describe('computeImpactedCabins — visibleCabinNames filter', () => {
  // Each test builds its own counter so ordering is deterministic.
  let counter = 0
  const move = (fromBunk: string, toBunk: string): MovedEntry => ({
    camper: { personCmId: ++counter },
    fromBunk: { id: 'id-' + fromBunk, name: fromBunk },
    toBunk: { id: 'id-' + toBunk, name: toBunk },
  })

  it('returns all chips when visibleCabinNames is not provided (backwards compat)', () => {
    const moved = [move('B-Cedar', 'B-Oak'), move('G-Pine', 'G-Birch')]
    const chips = computeImpactedCabins(moved)
    expect(chips.map((c) => c.name)).toEqual(['B-Cedar', 'B-Oak', 'G-Birch', 'G-Pine'])
  })

  it('returns all chips when visibleCabinNames contains all cabin names', () => {
    const moved = [move('B-Cedar', 'B-Oak'), move('G-Pine', 'G-Birch')]
    const all = new Set(['B-Cedar', 'B-Oak', 'G-Pine', 'G-Birch'])
    const chips = computeImpactedCabins(moved, all)
    expect(chips).toHaveLength(4)
  })

  it('filters out chips for cabins outside the visible set (boys filter active)', () => {
    // Moves span both boys cabins (B-*) and girls cabins (G-*)
    const moved = [
      move('B-Cedar', 'B-Oak'), // boys move — both cabins visible under boys filter
      move('G-Pine', 'G-Birch'), // girls move — not visible under boys filter
    ]
    const boysCabins = new Set(['B-Cedar', 'B-Oak'])
    const chips = computeImpactedCabins(moved, boysCabins)
    expect(chips.map((c) => c.name)).toEqual(['B-Cedar', 'B-Oak'])
    expect(chips.find((c) => c.name === 'G-Pine')).toBeUndefined()
    expect(chips.find((c) => c.name === 'G-Birch')).toBeUndefined()
  })

  it('filters out chips for cabins outside the visible set (girls filter active)', () => {
    const moved = [move('B-Cedar', 'B-Oak'), move('G-Pine', 'G-Birch')]
    const girlsCabins = new Set(['G-Pine', 'G-Birch'])
    const chips = computeImpactedCabins(moved, girlsCabins)
    expect(chips.map((c) => c.name)).toEqual(['G-Birch', 'G-Pine'])
    expect(chips.find((c) => c.name === 'B-Cedar')).toBeUndefined()
  })

  it('handles cross-gender move: shows only the half visible in the active filter', () => {
    // Emma moves from a boys cabin (B-Cedar) to a girls cabin (G-Oak) — unusual but
    // should not crash. Under boys filter only B-Cedar is visible.
    const moved = [move('B-Cedar', 'G-Oak')]
    const boysCabins = new Set(['B-Cedar'])
    const chips = computeImpactedCabins(moved, boysCabins)
    expect(chips.map((c) => c.name)).toEqual(['B-Cedar'])
    expect(chips.find((c) => c.name === 'G-Oak')).toBeUndefined()
  })

  it('returns empty array when no moves touch visible cabins', () => {
    const moved = [move('G-Pine', 'G-Birch')]
    const boysCabins = new Set(['B-Cedar', 'B-Oak'])
    const chips = computeImpactedCabins(moved, boysCabins)
    expect(chips).toEqual([])
  })

  it('preserves correct counts after filtering', () => {
    // 2 boys campers move B-Cedar → B-Oak; 3 girls campers move G-Pine → G-Birch.
    // Boys filter: B-Cedar count=2, B-Oak count=2. Girls chips should be absent.
    const moved = [
      move('B-Cedar', 'B-Oak'),
      move('B-Cedar', 'B-Oak'),
      move('G-Pine', 'G-Birch'),
      move('G-Pine', 'G-Birch'),
      move('G-Pine', 'G-Birch'),
    ]
    const boysCabins = new Set(['B-Cedar', 'B-Oak'])
    const chips = computeImpactedCabins(moved, boysCabins)
    expect(chips).toHaveLength(2)
    expect(chips.find((c) => c.name === 'B-Cedar')!.count).toBe(2)
    expect(chips.find((c) => c.name === 'B-Oak')!.count).toBe(2)
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
