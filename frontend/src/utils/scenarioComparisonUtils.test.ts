/**
 * Tests for scenario comparison page helpers.
 *
 * Covers:
 * - sortCampersByName: alphabetical sort (first name, then last name), locale-aware
 * - getAvailableBunkAreas: derives which area-filter buttons to show based on bunk genders
 * - diffGroups: classify locked groups as identical / unique-L / unique-R / modified
 */

import { describe, expect, it } from 'vitest'
import {
  compareCamperByName,
  sortCampersByName,
  getAvailableBunkAreas,
  diffGroups,
  type SortableCamper,
  type BunkWithGender,
  type LockGroupSummary,
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

// ---------------------------------------------------------------------------
// diffGroups
// ---------------------------------------------------------------------------

// Helpers to build minimal LockGroupSummary fixtures.
function grp(id: string, name: string, color: string, memberCmIds: number[]): LockGroupSummary {
  return { id, name, color, memberCmIds }
}

describe('diffGroups', () => {
  it('returns all zeros when both sides are empty', () => {
    const result = diffGroups([], [])
    expect(result.identical).toHaveLength(0)
    expect(result.uniqueL).toHaveLength(0)
    expect(result.uniqueR).toHaveLength(0)
    expect(result.modified).toHaveLength(0)
  })

  it('classifies groups with exactly the same CM_ID member set as identical', () => {
    // Emma Johnson (1001) and Liam Garcia (1002) are in group on both sides.
    const leftGroups = [grp('lg1', 'Alpha', '#ef4444', [1001, 1002])]
    const rightGroups = [grp('rg1', 'Alpha', '#ef4444', [1001, 1002])]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.identical).toHaveLength(1)
    expect(result.identical[0]!.left.id).toBe('lg1')
    expect(result.identical[0]!.right.id).toBe('rg1')
    expect(result.uniqueL).toHaveLength(0)
    expect(result.uniqueR).toHaveLength(0)
    expect(result.modified).toHaveLength(0)
  })

  it('is order-independent when matching identical sets', () => {
    // Members listed in different order — still identical.
    const leftGroups = [grp('lg1', 'Alpha', '#3b82f6', [1001, 1002, 1003])]
    const rightGroups = [grp('rg1', 'Alpha', '#3b82f6', [1003, 1001, 1002])]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.identical).toHaveLength(1)
    expect(result.uniqueL).toHaveLength(0)
    expect(result.uniqueR).toHaveLength(0)
    expect(result.modified).toHaveLength(0)
  })

  it('classifies groups with zero overlap as uniqueL and uniqueR', () => {
    // Olivia Chen (1010) and Riley Sam (1011) are in a left-only group.
    // Samuel Johnson (1020) and Emma Johnson (1001) form a right-only group.
    const leftGroups = [grp('lg1', 'Cabin Friends', '#22c55e', [1010, 1011])]
    const rightGroups = [grp('rg1', 'New Crew', '#a855f7', [1020, 1001])]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.uniqueL).toHaveLength(1)
    expect(result.uniqueL[0]!.id).toBe('lg1')
    expect(result.uniqueR).toHaveLength(1)
    expect(result.uniqueR[0]!.id).toBe('rg1')
    expect(result.identical).toHaveLength(0)
    expect(result.modified).toHaveLength(0)
  })

  it('classifies groups with partial overlap as modified', () => {
    // Left: Emma (1001) + Liam (1002). Right: Emma (1001) + Olivia (1003).
    // Overlap = {1001}, not zero and not identical → modified.
    const leftGroups = [grp('lg1', 'Pals', '#eab308', [1001, 1002])]
    const rightGroups = [grp('rg1', 'Pals', '#eab308', [1001, 1003])]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.modified).toHaveLength(1)
    expect(result.modified[0]!.left.id).toBe('lg1')
    expect(result.modified[0]!.right.id).toBe('rg1')
    expect(result.identical).toHaveLength(0)
    expect(result.uniqueL).toHaveLength(0)
    expect(result.uniqueR).toHaveLength(0)
  })

  it('handles mixed scenario: some identical, some unique, some modified', () => {
    // Identical: {1001, 1002} on both sides.
    // Unique to L: {1010, 1011} with no right counterpart.
    // Modified: Left has {1020, 1021}, Right has {1020, 1022} (overlap = {1020}).
    // Unique to R: {1030, 1031} with no left counterpart.
    const leftGroups = [
      grp('lg-identical', 'Steady', '#3b82f6', [1001, 1002]),
      grp('lg-unique', 'Gone', '#ef4444', [1010, 1011]),
      grp('lg-modified', 'Shifted', '#22c55e', [1020, 1021]),
    ]
    const rightGroups = [
      grp('rg-identical', 'Steady', '#3b82f6', [1001, 1002]),
      grp('rg-modified', 'Shifted', '#22c55e', [1020, 1022]),
      grp('rg-unique', 'New', '#a855f7', [1030, 1031]),
    ]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.identical).toHaveLength(1)
    expect(result.identical[0]!.left.id).toBe('lg-identical')
    expect(result.uniqueL).toHaveLength(1)
    expect(result.uniqueL[0]!.id).toBe('lg-unique')
    expect(result.modified).toHaveLength(1)
    expect(result.modified[0]!.left.id).toBe('lg-modified')
    expect(result.uniqueR).toHaveLength(1)
    expect(result.uniqueR[0]!.id).toBe('rg-unique')
  })

  it('counts correctly for summary header: leftCount and rightCount', () => {
    // 2 left groups, 3 right groups
    const leftGroups = [
      grp('lg1', 'A', '#ef4444', [1001, 1002]),
      grp('lg2', 'B', '#22c55e', [1010, 1011]),
    ]
    const rightGroups = [
      grp('rg1', 'A', '#ef4444', [1001, 1002]), // identical to lg1
      grp('rg2', 'B', '#22c55e', [1010, 1020]), // modified from lg2 (overlap={1010})
      grp('rg3', 'C', '#a855f7', [1030, 1031]), // unique to R
    ]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.leftCount).toBe(2)
    expect(result.rightCount).toBe(3)
    expect(result.identical).toHaveLength(1)
    expect(result.modified).toHaveLength(1)
    expect(result.uniqueL).toHaveLength(0)
    expect(result.uniqueR).toHaveLength(1)
  })

  // Finding 5: empty-member group edge case — an empty left group must land in
  // uniqueL, not be treated as "identical" to an empty right group.
  it('empty left group lands in uniqueL, not identical', () => {
    const leftGroups = [grp('lg-empty', 'Placeholder', '#6b7280', [])]
    const rightGroups = [grp('rg-empty', 'Placeholder', '#6b7280', [])]

    const result = diffGroups(leftGroups, rightGroups)
    expect(result.uniqueL).toHaveLength(1)
    expect(result.uniqueL[0]!.id).toBe('lg-empty')
    expect(result.identical).toHaveLength(0)
  })
})
