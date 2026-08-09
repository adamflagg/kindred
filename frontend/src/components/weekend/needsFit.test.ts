/**
 * kindred#1912 — does this space meet the dragged family's needs?
 *
 * Advisory, never a block: the board still accepts every drop (see
 * `LodgingUnitCard`'s own comment on `useDroppable`), because every cabin is
 * unconfirmed until staff walk the property and staff routinely place families
 * against the machine's opinion and are right to. Deliberately a DIFFERENT
 * mechanism from #2087's hard block on a held space, which is a refusal.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { resolveNeedsFit, worseOf } from './needsFit'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'ridge-1',
    name: 'Ridge 1',
    has_power: false,
    power_coverage: 'none',
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    ...overrides,
  }
}

describe('resolveNeedsFit', () => {
  it('marks nothing for a family that asked for nothing', () => {
    expect(resolveNeedsFit(party(), unit({ power_coverage: 'none' }))).toBe('fits')
  })

  it('marks a space where no room meets the need as unmet', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_power: true } }), unit({ power_coverage: 'none' }))
    ).toBe('unmet')
  })

  it('marks a space where only some rooms meet it as partial', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_power: true } }), unit({ power_coverage: 'some' }))
    ).toBe('partial')
  })

  it('marks nothing when every room meets the need', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_power: true } }), unit({ power_coverage: 'all' }))
    ).toBe('fits')
  })

  it('marks nothing when nobody has recorded the amenity', () => {
    // `unknown` is the absence of evidence, and the mark STATES something
    // about a space. "Nothing here has power" is not a claim an unconfirmed
    // row supports — the same bar `rosterAttention` applies to the roster's
    // own fit check.
    expect(
      resolveNeedsFit(party({ flags: { needs_power: true } }), unit({ power_coverage: 'unknown' }))
    ).toBe('fits')
  })

  it('treats a payload with no coverage field at all as unrecorded', () => {
    const bare = unit()
    delete (bare as { power_coverage?: string }).power_coverage
    expect(resolveNeedsFit(party({ flags: { needs_power: true } }), bare)).toBe('fits')
  })

  it('never reads the raw row — a building with no power but powered rooms fits', () => {
    // The 12-of-14 trap: twelve of the fourteen 2026 family-pool containers
    // record `has_power = 0` while every leaf beneath them has power. The
    // server resolves that; this must not second-guess it off the raw flag.
    expect(
      resolveNeedsFit(
        party({ flags: { needs_power: true } }),
        unit({ has_power: false, power_coverage: 'all' })
      )
    ).toBe('fits')
  })

  it('ignores a need no dimension answers yet', () => {
    // `needs_private_bathroom` is a real flag with no entry in the table, so
    // it contributes nothing and the power verdict stands alone. This does
    // NOT pin the combining rule — with one dimension the loop can only ever
    // run once, so `worseOf` below is where that rule is actually pinned.
    expect(
      resolveNeedsFit(
        party({ flags: { needs_power: true, needs_private_bathroom: true } }),
        unit({ power_coverage: 'none' })
      )
    ).toBe('unmet')
  })
})

describe('worseOf', () => {
  /*
   * The combining rule, tested directly rather than through
   * `resolveNeedsFit`, because `NEEDS_DIMENSIONS` holds ONE entry: a
   * `resolveNeedsFit` assertion would pass just as happily against a
   * combiner that kept the LAST verdict rather than the worst, and so would
   * pin nothing. The issue's whole claim is that dimension two is a constant
   * in the table and not a design exercise; this is what makes that true.
   */
  it('keeps the worse verdict whichever side it arrives on', () => {
    expect(worseOf('unmet', 'fits')).toBe('unmet')
    expect(worseOf('fits', 'unmet')).toBe('unmet')
    expect(worseOf('partial', 'fits')).toBe('partial')
    expect(worseOf('fits', 'partial')).toBe('partial')
    expect(worseOf('unmet', 'partial')).toBe('unmet')
    expect(worseOf('partial', 'unmet')).toBe('unmet')
  })

  it('returns the shared verdict when both agree', () => {
    expect(worseOf('fits', 'fits')).toBe('fits')
    expect(worseOf('partial', 'partial')).toBe('partial')
    expect(worseOf('unmet', 'unmet')).toBe('unmet')
  })
})
