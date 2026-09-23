/**
 * The resolver's matching rule, restated for the admin screens.
 *
 * `sync.AliasLookupKey` matches a cabin string with outer whitespace and case
 * ignored, and two aliases whose year windows both contain a year make that
 * year Ambiguous: NEITHER resolves. These tests pin the same rule here, because
 * a screen that checked exact text would call "cabin a " new while the
 * resolver treats it as a clash.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingAliasRecord } from '../../../types/lodging'
import {
  aliasLookupKey,
  extendWindowToCover,
  findAliasConflicts,
  formatAliasYears,
  freeWindowAround,
  windowsOverlap,
} from './aliasRules'

function alias(id: string, s: string, from = 0, to = 0): LodgingAliasRecord {
  return {
    id,
    alias_string: s,
    member_units: ['u1'],
    valid_from_year: from,
    valid_to_year: to,
    source_field: '',
    notes: '',
  }
}

describe('aliasLookupKey', () => {
  it('ignores case and outer whitespace', () => {
    expect(aliasLookupKey('  Cabin A ')).toBe('cabin a')
  })

  it('keeps inner spacing, which the registry holds verbatim', () => {
    expect(aliasLookupKey('Cabin  A')).not.toBe(aliasLookupKey('Cabin A'))
  })
})

describe('windowsOverlap', () => {
  it.each([
    [0, 0, 0, 0, true],
    [0, 2024, 2025, 0, false],
    [0, 2024, 2024, 0, true],
    [2020, 2022, 0, 2021, true],
    [2020, 2022, 2023, 2025, false],
  ])('[%i,%i] vs [%i,%i] → %s', (aFrom, aTo, bFrom, bTo, want) => {
    expect(windowsOverlap(aFrom, aTo, bFrom, bTo)).toBe(want)
  })
})

describe('formatAliasYears', () => {
  it.each([
    [0, 0, 'All years'],
    [2025, 0, '2025 onwards'],
    [0, 2024, 'Up to 2024'],
    [2020, 2022, '2020–2022'],
  ])('[%i,%i] → %s', (from, to, want) => {
    expect(formatAliasYears(from, to)).toBe(want)
  })
})

describe('findAliasConflicts', () => {
  const ALIASES = [alias('a1', 'Cabin A', 0, 2024), alias('b1', 'Cabin B')]

  it('blocks a name that differs only in case and spaces when the years overlap', () => {
    const result = findAliasConflicts(ALIASES, {
      alias_string: ' cabin A  ',
      valid_from_year: 0,
      valid_to_year: 0,
    })
    expect(result.blocking.map((a) => a.id)).toEqual(['a1'])
    expect(result.separateYears).toEqual([])
  })

  it('only warns when the same name has separate years, which is how a rename is recorded', () => {
    const result = findAliasConflicts(ALIASES, {
      alias_string: 'Cabin A',
      valid_from_year: 2025,
      valid_to_year: 0,
    })
    expect(result.blocking).toEqual([])
    expect(result.separateYears.map((a) => a.id)).toEqual(['a1'])
  })

  it('never reports the alias being edited against itself', () => {
    const result = findAliasConflicts(
      ALIASES,
      { alias_string: 'Cabin A', valid_from_year: 0, valid_to_year: 0 },
      'a1'
    )
    expect(result.blocking).toEqual([])
    expect(result.separateYears).toEqual([])
  })

  it('reports nothing for a blank string', () => {
    const result = findAliasConflicts(ALIASES, {
      alias_string: '   ',
      valid_from_year: 0,
      valid_to_year: 0,
    })
    expect(result.blocking).toEqual([])
  })
})

describe('freeWindowAround', () => {
  it('is all years when nothing shares the name', () => {
    expect(freeWindowAround([alias('b1', 'Cabin B')], 'Cabin A', 2026)).toEqual({ from: 0, to: 0 })
  })

  it('starts after an earlier window and stays open when nothing follows', () => {
    expect(freeWindowAround([alias('a1', 'cabin a', 0, 2024)], 'Cabin A', 2026)).toEqual({
      from: 2025,
      to: 0,
    })
  })

  it('stops before a later window', () => {
    const aliases = [alias('a1', 'Cabin A', 0, 2024), alias('a2', 'Cabin A', 2028, 0)]
    expect(freeWindowAround(aliases, 'Cabin A', 2026)).toEqual({ from: 2025, to: 2027 })
  })

  it('is null when another alias already covers the year', () => {
    expect(freeWindowAround([alias('a1', 'Cabin A')], 'Cabin A', 2026)).toBeNull()
  })
})

describe('extendWindowToCover', () => {
  it('opens the end of a window that stopped before the year', () => {
    const old = alias('a1', 'Cabin A', 0, 2024)
    expect(extendWindowToCover(old, [old], 2026)).toEqual({ from: 0, to: 0 })
  })

  it('stops short of the next alias for the same name', () => {
    const old = alias('a1', 'Cabin A', 0, 2024)
    const next = alias('a2', 'cabin a', 2028, 0)
    expect(extendWindowToCover(old, [old, next], 2026)).toEqual({ from: 0, to: 2027 })
  })

  it('moves the start back when the year is before the window', () => {
    const old = alias('a1', 'Cabin A', 2028, 0)
    const earlier = alias('a0', 'Cabin A', 0, 2020)
    expect(extendWindowToCover(old, [earlier, old], 2026)).toEqual({ from: 2021, to: 0 })
  })

  it('is null when a different alias already covers the year', () => {
    const old = alias('a1', 'Cabin A', 0, 2020)
    const other = alias('a2', 'Cabin A', 2021, 0)
    expect(extendWindowToCover(old, [old, other], 2026)).toBeNull()
  })
})
