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
import { hasNoRoom, resolveDragFit, worseOf } from './needsFit'

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
    // A real size. Capacity now gates the match, so a party of nobody would
    // fit everywhere and quietly hide every capacity assertion below.
    party_size: 2,
    ...overrides,
  }
}

describe('worseOf', () => {
  /*
   * The combining rule, tested directly rather than through
   * `resolveDragFit`: a `resolveDragFit` assertion would pass just as
   * happily against a combiner that kept the LAST verdict rather than the
   * worst, and so would pin nothing.
   *
   * ⚠️ This used to say the reason was that `NEEDS_DIMENSIONS` holds ONE
   * entry. That symbol was deleted by kindred#2072, and the claim had already
   * been false since kindred#2224 added the fridge entry. The table is
   * `needGlyphs.NEED_GLYPHS` now and carries four, and `resolveDragFit`
   * grades all four — the `HATCHED_NEEDS` subset that once narrowed it to
   * three is gone (kindred#2528). The direct test stays for the reason its
   * twin in `needsFit.ts` gives: it is the one that still holds if the scope
   * ever shrinks back to one.
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

/**
 * kindred#2528 — the drag-time signal's THREE-VALUED state.
 *
 * `resolveNeedsFit` answered one question ("how badly does this space miss?")
 * and the board asked it to serve two marks pointing in opposite directions.
 * `resolveDragFit` answers the whole question once: is this cabin a conflict,
 * a match, or neither.
 *
 * These are NOT adapted from the tests above. The specification changed —
 * `unknown` coverage used to read as `fits` and now makes no claim at all, and
 * capacity has entered a grading that never saw it — so the old assertions
 * pin an invariant that no longer holds. See CLAUDE.md §4 on rewriting rather
 * than adapting a test when the spec moves.
 *
 * Fictional data throughout.
 */
describe('resolveDragFit — the three states', () => {
  const roomy = { known: true, free: 6 } as const

  it('is neutral for a family that asked for nothing, however good the cabin', () => {
    // The withhold rule. Every empty cabin fits a family with no requirements,
    // so a mark saying so carries nothing — and the board must not switch out
    // of its resting state at all. 368 of 479 2026 registrations are this family.
    expect(resolveDragFit(party(), unit({ power_coverage: 'all' }), roomy).state).toBe('neutral')
  })

  it('is a conflict when an asked need is unmet, and reports the severity', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'none' }),
      roomy
    )
    expect(fit.state).toBe('conflict')
    expect(fit.severity).toBe('unmet')
  })

  it('carries `partial` severity through, so the hatch can draw a sparser grade', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'some' }),
      roomy
    )
    expect(fit.state).toBe('conflict')
    expect(fit.severity).toBe('partial')
  })

  it('is a match when every asked need is met and the party fits the free beds', () => {
    expect(
      resolveDragFit(
        party({ flags: { needs_power: true } }),
        unit({ power_coverage: 'all' }),
        roomy
      ).state
    ).toBe('match')
  })

  it('takes the WORSE severity across two failing needs, in either order', () => {
    const both = { flags: { needs_power: true, needs_fridge: true } }
    const a = resolveDragFit(
      party(both),
      unit({ power_coverage: 'some', fridge_coverage: 'none' }),
      roomy
    )
    const b = resolveDragFit(
      party(both),
      unit({ power_coverage: 'none', fridge_coverage: 'some' }),
      roomy
    )
    expect(a.severity).toBe('unmet')
    expect(b.severity).toBe('unmet')
  })
})

describe('resolveDragFit — capacity gates the match and never causes a conflict', () => {
  it('withholds the match when the party does not fit, without hatching the card', () => {
    // The owner ruling: a full cabin is not a bad cabin, it is a cabin with
    // nothing left in it. Measured before it was settled — letting capacity
    // hatch took a six-person family asking NOTHING to 45 of 73 cards.
    const fit = resolveDragFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'all' }),
      { known: true, free: 1 }
    )
    expect(fit.state).toBe('neutral')
  })

  it('withholds the match when capacity was never measured', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'all' }),
      { known: false, free: 0 }
    )
    expect(fit.state).toBe('neutral')
  })

  it('still reports the conflict when the cabin both misses a need and has no room', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'none' }),
      { known: true, free: 0 }
    )
    expect(fit.state).toBe('conflict')
  })
})

describe('resolveDragFit — step-free is a parsed hint and makes NEITHER claim (owner ruling 2026-08-31, kindred#2639)', () => {
  /*
   * ⚠️ THIS BLOCK USED TO BE "a cabin that is not accessible DOES hatch
   * (kindred#2327)" AND ASSERTED THE OPPOSITE. That was correct for #2327's
   * own change (grading from `is_accessible` instead of `has_ramp`) but the
   * OWNER'S FOLLOW-UP RULING on #2639 struck the hatch/match entirely for
   * this one need, verbatim: *"we should not hatch on accessibility since
   * its not an explicit requestion we ask people, its parsed out of other
   * accomm, and this one is only 'short distances', not a wheelchair. so, no
   * hatch, and otherwise good to go."*
   *
   * `needs_step_free` is not a question CampMinder asks families — the Go
   * sync derives it by keyword-matching the free-text `accommodation_explain`
   * narrative, and the signal behind it is a MOBILITY HINT ("short
   * distances"), not a wheelchair requirement. So the hatch's evidence bar
   * (rule 2's "unrecorded coverage makes neither claim") is applied to this
   * need UNCONDITIONALLY rather than only when the cabin's own coverage is
   * unresolved: the ambiguity here is in what the family actually meant, not
   * in what the cabin's data says, so it cannot be cured by the cabin being
   * confirmed either way.
   *
   * This is a REGRESSION TEST for #2327's own behaviour, deliberately kept
   * rather than deleted: it pins the exact case (`ramp_coverage: 'none'`)
   * #2327 shipped as a hatch, now asserting the reverse. `candidateFit`
   * covers the same grade on the Assign-modal's DIFFERENT code path —
   * `placementCandidates.test.ts`'s mirror of this block.
   */
  it('does NOT hatch a step-free household against a cabin graded `none` — the recorded-fact case', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_step_free: true } }),
      unit({ ramp_coverage: 'none' }),
      { known: true, free: 6 }
    )
    expect(fit.state).toBe('neutral')
  })

  it('does not hatch even with room to spare — this was never about capacity', () => {
    expect(
      resolveDragFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'none' }), {
        known: true,
        free: 99,
      }).state
    ).toBe('neutral')
  })

  it('does not MATCH a step-free household against a fully accessible cabin either', () => {
    // The other half of "neither claim": a positive mark must not read a
    // parsed hint as a met requirement, even when the cabin genuinely is
    // accessible. Before this ruling `ramp_coverage: 'all'` here matched.
    expect(
      resolveDragFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'all' }), {
        known: true,
        free: 6,
      }).state
    ).toBe('neutral')
  })

  it('suppresses ONLY the step-free contribution — another genuinely unmet need still hatches', () => {
    // "do not suppress the whole verdict, only the step-free contribution."
    const fit = resolveDragFit(
      party({ flags: { needs_step_free: true, needs_power: true } }),
      unit({ ramp_coverage: 'none', power_coverage: 'none' }),
      { known: true, free: 6 }
    )
    expect(fit.state).toBe('conflict')
    expect(fit.severity).toBe('unmet')
  })

  it('still matches on a genuinely met OTHER need — step-free does not block a real match', () => {
    // Step-free is excluded as though it were never asked; it must not
    // additionally suppress a positive verdict a real need has earned.
    const fit = resolveDragFit(
      party({ flags: { needs_step_free: true, needs_power: true } }),
      unit({ ramp_coverage: 'none', power_coverage: 'all' }),
      { known: true, free: 6 }
    )
    expect(fit.state).toBe('match')
  })
})

describe('resolveDragFit — unrecorded coverage makes NEITHER claim', () => {
  /*
   * ⚠️ THIS BLOCK USED TO GRADE `needs_step_free` against `ramp_coverage:
   * 'unknown'`, WITH PRODUCTION NUMBERS ATTACHED (102 of 118 units, 21
   * matches). Those numbers were real for kindred#2327's own change and are
   * now HISTORICAL: the 2026-08-31 ruling above (kindred#2639) excludes
   * step-free from this grading UNCONDITIONALLY — its coverage is never even
   * read, whatever the cabin says — so it can no longer demonstrate "an
   * unrecorded CABIN makes neither claim" without conflating two different
   * mechanisms in one fixture. Fridge is the example now; its own `unknown`
   * reading carries no such carve-out.
   */
  it('does not hatch a cabin nobody has assessed', () => {
    // The hatch is an INTERRUPTION, so its bar is evidence of absence rather
    // than absence of evidence.
    expect(
      resolveDragFit(
        party({ flags: { needs_fridge: true } }),
        unit({ fridge_coverage: 'unknown' }),
        { known: true, free: 6 }
      ).state
    ).toBe('neutral')
  })

  it('does not MATCH a cabin nobody has assessed either', () => {
    // A match is a positive claim, like a glyph's full hue, and the
    // 2026-08-20 ruling says unconfirmed information must not read as met.
    const fit = resolveDragFit(
      party({ flags: { needs_fridge: true } }),
      unit({ fridge_coverage: 'unknown' }),
      { known: true, free: 6 }
    )
    expect(fit.state).not.toBe('match')
    expect(fit.state).toBe('neutral')
  })

  it('treats a payload with no coverage field at all as unrecorded', () => {
    // The Pydantic-default gotcha, ported from the deleted `resolveNeedsFit`
    // suite: the API can omit the key entirely, and `?? 'unknown'` is what
    // catches it. Without this, a missing field would fall through to
    // `needVerdict` and be graded as though somebody had recorded something.
    const bare = unit()
    delete (bare as Partial<LodgingUnitRow>).power_coverage
    expect(
      resolveDragFit(party({ flags: { needs_power: true } }), bare, { known: true, free: 6 }).state
    ).toBe('neutral')
  })

  it('lets a recorded need decide even when another asked need is unrecorded', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_fridge: true, needs_power: true } }),
      unit({ fridge_coverage: 'unknown', power_coverage: 'none' }),
      { known: true, free: 6 }
    )
    expect(fit.state).toBe('conflict')
  })

  it('withholds the match when one asked need is recorded and another is not', () => {
    const fit = resolveDragFit(
      party({ flags: { needs_fridge: true, needs_power: true } }),
      unit({ fridge_coverage: 'unknown', power_coverage: 'all' }),
      { known: true, free: 6 }
    )
    expect(fit.state).toBe('neutral')
  })
})

describe('resolveDragFit — bathroom is graded, on the prospective axis', () => {
  it('grades bathroom, which the old hatch left out entirely', () => {
    // `HATCHED_NEEDS` used to be power/fridge/step-free. The mark is aligning
    // with the glyphs, which draw all four.
    const fit = resolveDragFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'none' }),
      { known: true, free: 6 }
    )
    expect(fit.state).toBe('conflict')
  })

  it('asks whether THIS cabin meets it, not what the party already has', () => {
    // The axis change. On the `placed` reading bathroom reads
    // `party.effective_bathroom` and ignores the target unit — every card or
    // none, which cannot mean anything per card.
    const asks = { flags: { needs_private_bathroom: true } }
    const yes = resolveDragFit(
      party({ ...asks, effective_bathroom: 'none' }),
      unit({ bathroom: 'private' }),
      { known: true, free: 6 }
    )
    const no = resolveDragFit(
      party({ ...asks, effective_bathroom: 'private' }),
      unit({ bathroom: 'none' }),
      { known: true, free: 6 }
    )
    expect(yes.state).toBe('match')
    expect(no.state).toBe('conflict')
  })
})

describe('resolveDragFit — the resolved coverage is the only input', () => {
  it('never reads the raw row — a building with no power but powered rooms is a match', () => {
    // The 12-of-14 trap: twelve of the fourteen 2026 family-pool containers
    // record `has_power = 0` while every leaf beneath them has power. The
    // server resolves that; this must not second-guess it off the raw flag.
    expect(
      resolveDragFit(
        party({ flags: { needs_power: true } }),
        unit({ has_power: false, power_coverage: 'all' }),
        { known: true, free: 6 }
      ).state
    ).toBe('match')
  })

  it('never reads the raw row — the shared-fridge ruling lives server-side', () => {
    // A SHARED FRIDGE IS A FRIDGE (owner, 2026-08-15), and the OR that says so
    // is in `_resolve_fridge_coverage`. Re-deriving it here off `has_fridge`
    // would put a second implementation of one ruling on the client, where it
    // could disagree.
    expect(
      resolveDragFit(
        party({ flags: { needs_fridge: true } }),
        unit({ has_fridge: false, has_shared_fridge: true, fridge_coverage: 'all' }),
        { known: true, free: 6 }
      ).state
    ).toBe('match')
  })
})

describe('hasNoRoom — the capacity predicate, single-sourced', () => {
  /*
   * Extracted because it was written TWICE: once inside `resolveDragFit` to
   * gate the match, and once inline in `LodgingUnitCard` to redden the N/M
   * figure. Nothing tied the two together, and they had already been edited in
   * lockstep by hand once (the write-in rule) — a silent divergence was one
   * forgotten edit away, and neither the type checker nor any test would have
   * caught it.
   */
  const three = party({ party_size: 3 })

  it('is false when the beds are not a fact — nothing to claim from', () => {
    expect(hasNoRoom(three, { known: false, free: 0 })).toBe(false)
    expect(hasNoRoom(three, { known: false, free: -5 })).toBe(false)
  })

  it('is true only when a known count falls short', () => {
    expect(hasNoRoom(three, { known: true, free: 2 })).toBe(true)
    expect(hasNoRoom(three, { known: true, free: 0 })).toBe(true)
  })

  it('treats a party that exactly fills the cabin as fitting', () => {
    // The boundary, pinned. `free === size` is a fit, not a miss.
    expect(hasNoRoom(three, { known: true, free: 3 })).toBe(false)
  })

  it('is true on a cabin already over capacity', () => {
    expect(hasNoRoom(three, { known: true, free: -1 })).toBe(true)
  })

  it('agrees with resolveDragFit — the two marks can never contradict', () => {
    // THE GUARD THAT WAS MISSING. If capacity says "no room" then the match
    // must be withheld, for every combination of the inputs. A future edit to
    // one site and not the other breaks this and nothing else.
    const asksPower = party({ flags: { needs_power: true }, party_size: 3 })
    const good = unit({ power_coverage: 'all' })
    for (const known of [true, false]) {
      for (const free of [-1, 0, 2, 3, 9]) {
        const capacity = { known, free }
        if (hasNoRoom(asksPower, capacity)) {
          expect(resolveDragFit(asksPower, good, capacity).state).not.toBe('match')
        }
      }
    }
  })
})
