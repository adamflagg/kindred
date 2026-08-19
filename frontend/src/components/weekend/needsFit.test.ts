/**
 * kindred#1912 — does this space meet the dragged family's needs?
 *
 * Advisory, never a block: the board still accepts every drop (see
 * `LodgingUnitCard`'s own comment on `useDroppable`) — not because cabins are
 * unconfirmed (measured against the production snapshot of 2026-08-06, cabins
 * were 118/118 confirmed) but because staff routinely place families against
 * the machine's opinion and are right to. Deliberately a DIFFERENT mechanism
 * from the invalid merge target's hard block, which is a refusal. #2087's
 * block on a written-into space used to be the other example here; kindred#2432
 * struck it, so the merge target is now the only thing on the refusal channel.
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
    has_fridge: false,
    has_shared_fridge: false,
    fridge_coverage: 'none',
    has_ramp: '',
    ramp_coverage: 'none',
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

describe('resolveNeedsFit — the fridge dimension (kindred#2224)', () => {
  /*
   * Dimension two, and the issue's own claim about dimension one: a second
   * criterion is a further entry in `NEEDS_DIMENSIONS` and nothing else. It
   * arrives with no new glyph, no new colour and no new chip — the card's
   * visual treatment of needs belongs to kindred#2072.
   *
   * The demand it answers was invisible: `needs_accommodation` is a GATE
   * question and the substance landed in free text nothing read. Six of the 42
   * accommodation-gated 2026 households name a refrigerator, against 12 of 118
   * units carrying one. 2026 is only 16% placed, so 6 is the SHAPE of the
   * demand, not a rate.
   */
  it('marks a space where no room has a fridge as unmet', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_fridge: true } }), unit({ fridge_coverage: 'none' }))
    ).toBe('unmet')
  })

  it('marks a space where only some rooms have one as partial', () => {
    // Advisory-softer, the same reading power takes: a building where some
    // rooms have a fridge is a real improvement on one where none do. This is
    // NOT the `is_accessible` shape, where SOME is worse than NONE because it
    // invites the placement that lands in one of the other rooms — the owner's
    // 2026-08-15 ruling that a SHARED fridge satisfies the need is what
    // settles that, since a fridge one room over is still a fridge.
    expect(
      resolveNeedsFit(party({ flags: { needs_fridge: true } }), unit({ fridge_coverage: 'some' }))
    ).toBe('partial')
  })

  it('marks nothing when every room has one', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_fridge: true } }), unit({ fridge_coverage: 'all' }))
    ).toBe('fits')
  })

  it('marks nothing when nobody has recorded the amenity', () => {
    expect(
      resolveNeedsFit(
        party({ flags: { needs_fridge: true } }),
        unit({ fridge_coverage: 'unknown' })
      )
    ).toBe('fits')
  })

  it('never reads the raw row — the shared-fridge ruling lives server-side', () => {
    // A SHARED FRIDGE IS A FRIDGE (owner, 2026-08-15), and the OR that says so
    // is in `_resolve_fridge_coverage`. Re-deriving it here off `has_fridge`
    // would put a second implementation of one ruling on the client, where it
    // could disagree.
    expect(
      resolveNeedsFit(
        party({ flags: { needs_fridge: true } }),
        unit({ has_fridge: false, has_shared_fridge: true, fridge_coverage: 'all' })
      )
    ).toBe('fits')
  })

  it('leaves a family that did not ask for one unmarked', () => {
    expect(resolveNeedsFit(party(), unit({ fridge_coverage: 'none' }))).toBe('fits')
  })

  it('takes the WORSE of two dimensions, in either order', () => {
    // With two real entries the loop can finally run twice, so this is the
    // first assertion through `resolveNeedsFit` that can distinguish
    // "worst wins" from "the last dimension wins".
    const powerUnmet = unit({ power_coverage: 'none', fridge_coverage: 'all' })
    const fridgeUnmet = unit({ power_coverage: 'all', fridge_coverage: 'none' })
    const both = party({ flags: { needs_power: true, needs_fridge: true } })

    expect(resolveNeedsFit(both, powerUnmet)).toBe('unmet')
    expect(resolveNeedsFit(both, fridgeUnmet)).toBe('unmet')
    expect(resolveNeedsFit(both, unit({ power_coverage: 'some', fridge_coverage: 'all' }))).toBe(
      'partial'
    )
  })

  it('keeps the two dimensions independent — one need never reads the other coverage', () => {
    expect(
      resolveNeedsFit(
        party({ flags: { needs_power: true } }),
        unit({ power_coverage: 'all', fridge_coverage: 'none' })
      )
    ).toBe('fits')
    expect(
      resolveNeedsFit(
        party({ flags: { needs_fridge: true } }),
        unit({ power_coverage: 'none', fridge_coverage: 'all' })
      )
    ).toBe('fits')
  })
})

describe('resolveNeedsFit — the step-free dimension (kindred#2438)', () => {
  /*
   * Dimension three, and the first one whose supply column is NOT a boolean.
   * `has_ramp` is a three-value select (`yes` / `no` / `partial`, blank = NOT
   * ASSESSED, migration 1500000131), which is why `ramp_coverage` carries a
   * fifth grade the other two do not.
   *
   * Measured on the 2026 snapshot, household grain, both housing narratives:
   * 14 of the 86 households carrying any narrative describe a mobility or
   * step-free need, against 6 naming a fridge — more than twice the signal that
   * justified shipping the fridge dimension. Supply: 14 of 118 units carry a
   * staff assessment (5 yes / 5 partial / 4 no), which a BOOLEAN read of the
   * select reports as 0 of 118. 2026 is only 16% placed, so 14 is the SHAPE of
   * the demand, not a rate.
   */
  it('marks a space where no room is step-free as unmet', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'none' }))
    ).toBe('unmet')
  })

  it('marks a space where only SOME rooms are step-free as unmet, not partial', () => {
    // ⚠️ NOT the fridge reading. This is the `is_accessible` reasoning the
    // module doc already spells out: a building advertising two step-free
    // rooms out of ten invites precisely the placement that lands in one of
    // the other eight. A fridge one room over is still a fridge a family can
    // use; a ramp one room over is not.
    expect(
      resolveNeedsFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'some' }))
    ).toBe('unmet')
  })

  it('marks a space whose best room is a QUALIFIED ramp as partial', () => {
    // The fifth grade, and the reason the supply column is a select. Three of
    // the five production `partial` units carry the ramp qualifier in `notes`
    // — "look at this one" is exactly what the softer hatch says.
    expect(
      resolveNeedsFit(
        party({ flags: { needs_step_free: true } }),
        unit({ ramp_coverage: 'partial' })
      )
    ).toBe('partial')
  })

  it('marks nothing when every room is step-free', () => {
    expect(
      resolveNeedsFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'all' }))
    ).toBe('fits')
  })

  it('marks nothing when nobody has assessed the space', () => {
    // 104 of 118 production units are blank. Marking them would assert "no
    // ramp" about cabins nobody has looked at — the exact inversion the select
    // exists to prevent, and the reason the server resolves `unknown`.
    expect(
      resolveNeedsFit(
        party({ flags: { needs_step_free: true } }),
        unit({ ramp_coverage: 'unknown' })
      )
    ).toBe('fits')
  })

  it('never reads the raw has_ramp — a truthy string would invert the mark', () => {
    // `has_ramp` is a STRING, so `'no'` is TRUTHY. Any consumer filtering on
    // truthiness renders "step-free" on the four cabins staff assessed as
    // explicitly having NO ramp. The resolved field is the only safe read, and
    // this pins that the dimension takes it.
    expect(
      resolveNeedsFit(
        party({ flags: { needs_step_free: true } }),
        unit({ has_ramp: 'no', ramp_coverage: 'all' })
      )
    ).toBe('fits')
    expect(
      resolveNeedsFit(
        party({ flags: { needs_step_free: true } }),
        unit({ has_ramp: 'yes', ramp_coverage: 'none' })
      )
    ).toBe('unmet')
  })

  it('leaves a family that did not ask unmarked', () => {
    expect(resolveNeedsFit(party(), unit({ ramp_coverage: 'none' }))).toBe('fits')
  })

  it('keeps the three dimensions independent', () => {
    expect(
      resolveNeedsFit(
        party({ flags: { needs_step_free: true } }),
        unit({ power_coverage: 'none', fridge_coverage: 'none', ramp_coverage: 'all' })
      )
    ).toBe('fits')
    expect(
      resolveNeedsFit(
        party({ flags: { needs_power: true } }),
        unit({ power_coverage: 'all', ramp_coverage: 'none' })
      )
    ).toBe('fits')
  })

  it('takes the WORSE of a soft ramp verdict and a hard one', () => {
    expect(
      resolveNeedsFit(
        party({ flags: { needs_power: true, needs_step_free: true } }),
        unit({ power_coverage: 'none', ramp_coverage: 'partial' })
      )
    ).toBe('unmet')
    expect(
      resolveNeedsFit(
        party({ flags: { needs_power: true, needs_step_free: true } }),
        unit({ power_coverage: 'all', ramp_coverage: 'partial' })
      )
    ).toBe('partial')
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
