/**
 * The truth table for the four ruled need glyphs — kindred#2072.
 *
 * This file is the specification for `needGlyphs.ts`, which exists because
 * three mutually disjoint tables were grading these needs and DISAGREEING:
 * `rosterAttention.VERIFIABLE_NEEDS` (bathroom + power, power read off the raw
 * `has_power`), `needsFit.NEEDS_DIMENSIONS` (power + fridge + step-free, all
 * read off the server-resolved `*_coverage`), and `FamilyCardChips` (bathroom +
 * power, as words). A fourth table would have made it worse; this is the one
 * they all now call.
 *
 * Vocabulary: `docs/reference/weekend-card-vocabulary.md` §2 and §6.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { NEED_GLYPHS, needCoverage, needVerdict, resolveNeedGlyphs } from './needGlyphs'

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

describe('NEED_GLYPHS — the closed set', () => {
  it('is exactly four dimensions, in the ruled order', () => {
    // §6: "The hue set is closed. Four dimensions, four hues." A fifth need
    // does not get a fifth colour without a ruling, and a fifth ENTRY here is
    // the shape that ruling would take — so the count is pinned, not implied.
    expect(NEED_GLYPHS.map((glyph) => glyph.key)).toEqual([
      'bathroom',
      'power',
      'fridge',
      'step_free',
    ])
  })

  it('carries the locked hues as Tailwind steps, never hand-written hex', () => {
    // The mock renders #0ea5e9 / #a855f7 / #14b8a6 / #f97316 and one step
    // lighter in dark. Those hex values STAND IN FOR these Tailwind steps —
    // they are v3's, and this project ships v4, whose OKLCH ramps render
    // #00a6f4 / #ad46ff / #00bba7 / #ff6900. The tokens asserted below are the
    // definition and the mock is the approximation (§6); the difference is the
    // mock's, not the app's.
    expect(NEED_GLYPHS.map((glyph) => glyph.hueClassName)).toEqual([
      'text-sky-500 dark:text-sky-400',
      'text-purple-500 dark:text-purple-400',
      'text-teal-500 dark:text-teal-400',
      'text-orange-500 dark:text-orange-400',
    ])
  })

  it('writes no hex anywhere in the set', () => {
    // The sweep that catches a mock hue copied in by hand later.
    const serialised = NEED_GLYPHS.map((glyph) => `${glyph.hueClassName} ${glyph.label}`).join(' ')
    expect(serialised).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('names each need in the vocabulary staff read, not the column name', () => {
    // "Private bathroom" is the COLUMN's word and it is wrong — the form asks
    // about in-cabin access, never exclusivity (§4). The label says what was
    // asked. Renaming the flag itself is kindred#2501.
    expect(NEED_GLYPHS.map((glyph) => glyph.label)).toEqual([
      'Bathroom in unit',
      'Power',
      'Fridge',
      'Step-free',
    ])
  })
})

describe('needCoverage — where each need reads its supply', () => {
  it('reads power off the resolved coverage, never the raw has_power flag', () => {
    // Twelve of the fourteen 2026 family-pool containers record `has_power = 0`
    // while every leaf beneath them has power. `rosterAttention` read the raw
    // flag and marked those twelve unpowered; this is that bug's fix.
    const container = unit({ has_power: false, power_coverage: 'all' })
    expect(needCoverage('power', party(), container)).toBe('all')
  })

  it('reads fridge off the resolved coverage, so a shared fridge still counts', () => {
    // The owner's 2026-08-15 ruling ("a shared fridge IS a fridge") lives in
    // the server's `_resolve_fridge_coverage`. Re-deriving it here would put a
    // second implementation of one ruling on the client.
    const shared = unit({ has_fridge: false, has_shared_fridge: true, fridge_coverage: 'all' })
    expect(needCoverage('fridge', party(), shared)).toBe('all')
  })

  it('reads step-free off ramp_coverage, never the truthy has_ramp string', () => {
    // `has_ramp` is a three-value SELECT, so `'no'` is a truthy string: any
    // consumer testing it for truthiness renders "step-free" on the four
    // cabins staff assessed as explicitly having no ramp.
    const noRamp = unit({ has_ramp: 'no', ramp_coverage: 'none' })
    expect(needCoverage('step_free', party(), noRamp)).toBe('none')
  })

  it('reads the bathroom off the PARTY, because a merge is what satisfies it', () => {
    // `unit.bathroom` is one room's own field, and a merged slot's `unit_code`
    // is "" BY DESIGN (kindred#1982) — so there is no single unit to read for
    // exactly the placement this need exists to catch. The server's
    // `effective_bathroom` already credits a whole-house merge.
    const merged = party({ effective_bathroom: 'private' })
    expect(needCoverage('bathroom', merged, unit({ bathroom: 'none' }))).toBe('all')
  })

  /**
   * ⚠️ THE ONE PLACE TWO RULINGS CONTRADICT, ACCEPTED FOR ONE RELEASE.
   *
   * The unit card will draw its bathroom mark as PRESENCE
   * (`bathroom != 'none'`) once stage 3 lands, because that is the axis the
   * CampMinder question actually asks. This grading still says a SHARED
   * bathroom does not satisfy the need, because that is what `rosterAttention`
   * has always said and changing it is
   * kindred#2501 — itself gated on reading the Adult form's wording, which
   * supplies 19 of 66 flagged households and has never been audited.
   *
   * So a room can show "has a bathroom" while the family on it shows a red
   * bathroom glyph. Owner ruling 2026-08-19: accept it, name it, and pin it —
   * this test is the pin. When #2501 lands, THIS is the assertion that flips.
   */
  it('still grades a shared bathroom as not satisfying the need — until kindred#2501', () => {
    expect(needCoverage('bathroom', party({ effective_bathroom: 'shared' }), unit())).toBe('none')
  })

  it('reports unknown where the server could not resolve the bathroom', () => {
    expect(needCoverage('bathroom', party({ effective_bathroom: 'unknown' }), unit())).toBe(
      'unknown'
    )
    expect(needCoverage('bathroom', party(), unit())).toBe('unknown')
  })
})

describe('needVerdict — the truth table', () => {
  /**
   * Every (need, coverage) pair, stated once.
   *
   * `some` is the per-criterion nuance, and the three grains do NOT mean the
   * same thing for every need: for power and fridge a building where some
   * rooms have it is a real improvement on one where none do, so SOME is
   * softer. For step-free SOME is WORSE than NONE — a building advertising two
   * step-free rooms out of ten invites precisely the placement that lands in
   * one of the other eight.
   */
  const TABLE: ReadonlyArray<[string, 'all' | 'some' | 'partial' | 'none' | 'unknown', string]> = [
    ['bathroom', 'all', 'fits'],
    ['bathroom', 'none', 'unmet'],
    ['bathroom', 'unknown', 'fits'],
    ['power', 'all', 'fits'],
    ['power', 'some', 'partial'],
    ['power', 'none', 'unmet'],
    ['power', 'unknown', 'fits'],
    ['fridge', 'all', 'fits'],
    ['fridge', 'some', 'partial'],
    ['fridge', 'none', 'unmet'],
    ['fridge', 'unknown', 'fits'],
    ['step_free', 'all', 'fits'],
    ['step_free', 'some', 'unmet'],
    ['step_free', 'partial', 'partial'],
    ['step_free', 'none', 'unmet'],
    ['step_free', 'unknown', 'fits'],
  ]

  it.each(TABLE)('grades %s at %s coverage as %s', (key, coverage, expected) => {
    expect(needVerdict(key as never, coverage)).toBe(expected)
  })

  it('reports fits for unknown, because absence of evidence is not evidence of absence', () => {
    // An unconfirmed cabin's `has_power = false` means "nobody has said".
    // Marking it would assert something about a space nobody has measured.
    expect(needVerdict('power', 'unknown')).toBe('fits')
  })
})

describe('resolveNeedGlyphs — what the card actually draws', () => {
  it('omits a need that was not asked for — never dims it', () => {
    // THE ABSENCE RULE (§6): a need not asked for is omitted, never dimmed.
    // This governs marks that do not exist yet, so it is pinned on the
    // resolver rather than on any one card.
    const glyphs = resolveNeedGlyphs(party(), unit())
    expect(glyphs).toEqual([])
  })

  it('draws one glyph per asked need, in the closed set order', () => {
    const glyphs = resolveNeedGlyphs(
      party({
        flags: { needs_step_free: true, needs_private_bathroom: true, needs_power: true },
        effective_bathroom: 'private',
      }),
      unit({ power_coverage: 'all', ramp_coverage: 'all' })
    )
    expect(glyphs.map((glyph) => glyph.key)).toEqual(['bathroom', 'power', 'step_free'])
  })

  it('marks a need the room does not meet as unmet', () => {
    const glyphs = resolveNeedGlyphs(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'none' })
    )
    expect(glyphs).toHaveLength(1)
    expect(glyphs[0]?.verdict).toBe('unmet')
  })

  it('grades an asked need as fitting when there is no cabin to grade against', () => {
    // An unplaced party in the queue. There is nothing to be a misfit FOR, and
    // a queue hatched red all the time says nothing at all — the same reading
    // `needsFit` takes at rest.
    const glyphs = resolveNeedGlyphs(party({ flags: { needs_power: true } }), undefined)
    expect(glyphs.map((glyph) => glyph.verdict)).toEqual(['fits'])
  })

  it('keeps a partial verdict out of the warn state', () => {
    // Two states are locked, not three: the hue (asked for) and warn (the
    // room has not got it). `partial` is a QUALIFICATION — "a ramp with a lip",
    // "some rooms have power" — and the Assign modal's rows already grade it as
    // advisory-muted rather than as a warning. It keeps its hue; the card's
    // drag-time hatch is where degree is expressed.
    const glyphs = resolveNeedGlyphs(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'some' })
    )
    expect(glyphs[0]?.verdict).toBe('partial')
    expect(glyphs[0]?.isUnmet).toBe(false)
  })

  it('reports isUnmet only for unmet', () => {
    const unmet = resolveNeedGlyphs(
      party({ flags: { needs_fridge: true } }),
      unit({ fridge_coverage: 'none' })
    )
    expect(unmet[0]?.isUnmet).toBe(true)
  })
})

describe('needCoverage — the PROSPECTIVE reading', () => {
  /*
   * Two questions, one table.
   *
   *   PLACED      — "does the cabin they are in meet this need?"  The card.
   *   PROSPECTIVE — "would this cabin meet it?"                   The modal.
   *
   * They differ for exactly one need, and the difference is not a bug that
   * was consolidated away: `effective_bathroom` is the SERVER's verdict on
   * the placement a party already holds, which is meaningless for a candidate
   * that has none — every unplaced party would grade identically no matter
   * which cabin was being considered. `placementCandidates.ts` had worked
   * this out and kept its own table because of it; the reading is a parameter
   * now instead.
   */
  it('grades a candidate bathroom off the CABIN, not the placement the party does not have', () => {
    const unplaced = party({ effective_bathroom: 'none' })
    expect(needCoverage('bathroom', unplaced, unit({ bathroom: 'private' }), 'prospective')).toBe(
      'all'
    )
    expect(needCoverage('bathroom', unplaced, unit({ bathroom: 'shared' }), 'prospective')).toBe(
      'none'
    )
  })

  it('reports unknown for a cabin whose bathroom nobody has recorded', () => {
    expect(needCoverage('bathroom', party(), unit({ bathroom: 'unknown' }), 'prospective')).toBe(
      'unknown'
    )
    const noField = unit()
    delete noField.bathroom
    expect(needCoverage('bathroom', party(), noField, 'prospective')).toBe('unknown')
  })

  it('reads the other three identically in both readings — they were never party-scoped', () => {
    const p = party({ effective_bathroom: 'private' })
    const u = unit({ power_coverage: 'some', fridge_coverage: 'all', ramp_coverage: 'partial' })
    for (const key of ['power', 'fridge', 'step_free'] as const) {
      expect(needCoverage(key, p, u, 'prospective')).toBe(needCoverage(key, p, u, 'placed'))
    }
  })

  it('defaults to the placed reading, so an unqualified call is the card’s', () => {
    const placed = party({ effective_bathroom: 'private' })
    expect(needCoverage('bathroom', placed, unit({ bathroom: 'none' }))).toBe('all')
  })

  it('draws a candidate’s glyphs against the cabin being considered', () => {
    const glyphs = resolveNeedGlyphs(
      party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'none' }),
      unit({ bathroom: 'private' }),
      'prospective'
    )
    expect(glyphs.map((glyph) => glyph.isUnmet)).toEqual([false])
  })
})
