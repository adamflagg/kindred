/**
 * The picker's list: every unplaced party, annotated and ordered, never cut.
 *
 * The rule these tests pin is an owner ruling (2026-08-07, restated
 * 2026-08-09) and it is the OPPOSITE of the instinct: 36 of 118 units answer
 * the bathroom need against 66 of 479 registrations asking for one, so a
 * hide-filter would empty the list. `placementCandidates` must therefore
 * return exactly as many rows as it was given, every time.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import {
  candidateFit,
  partitionByGroup,
  placementCandidates,
  type PlacementCandidate,
} from './placementCandidates'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    power_coverage: 'unknown',
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'shareable',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

describe('candidateFit', () => {
  it('reports a party with no recorded needs as fitting, with nothing to say', () => {
    const result = candidateFit(party(), unit(), [])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('credits a SHARED bathroom — the row grades presence, not exclusivity', () => {
    /*
     * ⚠️ REVERSED 2026-08-20 (kindred#2501). This test used to assert `unmet`
     * on exactly this fixture, and it was the picker's exclusivity pin. The
     * SPECIFICATION changed, not the code: owner ruling — *"the glyph should
     * not grade exclusivity, just 'do they have a bathroom (shared or
     * private)'"*, and on this case itself *"sharing a bathroom for whatever
     * reason still provides people a bathroom."*
     *
     * `'shared'` means a bathroom INSIDE the cabin that two parties split;
     * walking to a bathhouse is not `'shared'`, it records as `'none'` and is
     * pinned unmet by the test below. The picker had no separate rule to
     * change — it grades through `needGlyphs.bathroomCoverage` since
     * kindred#2072, so this row moved when that predicate did, which is the
     * whole point of there being one grading.
     */
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'shared' }),
      []
    )
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('marks a bathroom need against a cabin with NO bathroom', () => {
    // The negative arm the exclusivity pin above used to carry. A walk to a
    // bathhouse records as `'none'`, and that is still an unmet need.
    //
    // The NOTE is struck (kindred#2072): the row draws a red bathroom glyph,
    // and a sentence beside it repeating the fact is the "one fact twice" N2
    // removed from the family card. The verdict it feeds is what orders the
    // list, and that is what this pins.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
  })

  it('says nothing when the space HAS a private bathroom', () => {
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'private' }),
      []
    )
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('does NOT say a room fits when nobody has recorded its bathroom', () => {
    /*
     * ⚠️ REVERSED 2026-08-20. This used to expect `fits`, on the argument that
     * the absence of evidence is not evidence of absence, so marking an
     * unrecorded room would assert something about a space nobody has
     * measured. True — but `fits` asserts something too, and on a candidate
     * row it is the bolder of the two: a green verdict at the moment of
     * placement, telling staff to go ahead. Owner ruling: *"unknown values
     * should not equal fits, across all surfaces on the glyphs, its
     * unconfirmed information."*
     *
     * `notes` stays empty, because notes are what NO GLYPH can say and the
     * glyph carries this one (N2). The row's own verdict is what changes.
     */
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ bathroom: 'unknown' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
  })

  it('annotates a power need against a building where no room has power', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
    // Struck with the other per-need notes — the glyph carries it.
    expect(result.notes).toEqual([])
  })

  it('softens a power need to partial when SOME rooms have power', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('partial')
    expect(result.notes).toEqual([])
  })

  it('reads power off the leaf-resolved coverage, never the container row own flag', () => {
    // Twelve of the fourteen 2026 family-pool containers record
    // `has_power = 0` while every leaf beneath them has power. Judging by the
    // raw flag would mark twelve entirely-powered buildings unpowered.
    const result = candidateFit(
      party({ flags: { needs_power: true } }),
      unit({ has_power: false, power_coverage: 'all', is_container: true, is_combined: true }),
      []
    )
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('annotates a party that does not fit the beds left', () => {
    // ⚠️ THE NOTE NOW COUNTS FREE BEDS, NOT THE ROOM'S WHOLE CAPACITY (owner
    // ruling 2026-08-20 — see the `capacityVerdict` describe below). An empty
    // room's free beds ARE its capacity, so this case reads the same as it
    // always did; only the words changed, and they changed to match the
    // header immediately above these rows, which has said "N of M beds free"
    // since the 2026-08-19 ruling.
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: 4 }), [])
    expect(result.fit).toBe('unmet')
    expect(result.notes).toContain('Over capacity · needs 6, 4 free')
  })

  it('says nothing about a room somebody is written into', () => {
    // A write-in is not a party (kindred#2439), so it contributes nothing to
    // any occupancy figure a caller could thread in — the free-bed count on a
    // written-into room is the WHOLE cabin, a number the card itself refuses
    // to assert (it prints an em dash). The row must not claim "fits" off
    // that number, nor "does not fit" off its equally-false complement: no
    // count, no claim, exactly the unmeasured-capacity reading above.
    const writtenInto = unit({
      write_ins: [
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Emma Johnson',
          note: '',
        },
      ],
    })
    const small = candidateFit(party({ party_size: 2 }), writtenInto, [])
    expect(small.fit).toBe('fits')
    expect(small.notes).toEqual([])
    const large = candidateFit(party({ party_size: 6 }), writtenInto, [])
    expect(large.fit).toBe('fits')
    expect(large.notes).toEqual([])
  })

  it('says nothing about capacity nobody has recorded', () => {
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: null }), [])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('measures a combined house by its whole-house capacity, not its own row', () => {
    // `effectiveSleeps`: a container's own `sleeps` is the delta for space
    // belonging to no single room, PLUS its rooms. Reading the house row
    // alone would call a 7-bed house a 1-bed one.
    const house = unit({
      unit_id: 'u9',
      code: 'gt-house',
      name: 'Granite House',
      sleeps: 1,
      is_container: true,
      is_combined: true,
    })
    const rooms = [
      unit({
        unit_id: 'u10',
        code: 'gt-house-a',
        name: 'Granite A',
        sleeps: 3,
        parent_code: 'gt-house',
      }),
      unit({
        unit_id: 'u11',
        code: 'gt-house-b',
        name: 'Granite B',
        sleeps: 3,
        parent_code: 'gt-house',
      }),
    ]
    const result = candidateFit(party({ party_size: 6 }), house, [house, ...rooms])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('takes the WORST verdict across every dimension', () => {
    // `unmet` (bathroom) beats `partial` (some rooms have power). The notes
    // that used to ride along are struck; what survives is the ordering rule,
    // which is what this test was really protecting.
    //
    // The unmet VEHICLE moved from `bathroom: 'shared'` to `'none'`
    // (kindred#2501 made a shared bathroom meet the need). The intent —
    // worst-of across dimensions — is untouched; it just needs a dimension
    // that actually fails.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      unit({ bathroom: 'none', power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
  })

  it('still takes the worst when only CAPACITY fails, and keeps its note', () => {
    const result = candidateFit(
      party({ flags: { needs_power: true }, party_size: 6 }),
      unit({ sleeps: 4, power_coverage: 'some' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 6, 4 free'])
  })
})

describe('capacityVerdict — the row grades the beds LEFT (owner ruling 2026-08-20)', () => {
  /*
   * ⚠️ THE DEFECT THIS CLOSES SHIPPED A GREEN `fits` ON A ROW THAT WOULD
   * OVER-FILL THE ROOM, and it was pre-existing rather than introduced by the
   * modal — the review artifact draws it the same way.
   *
   * The header above these rows answers "will they fit in what is LEFT" (the
   * 2026-08-19 ruling: it prints "2 of 4 beds free"). The row graded
   * `partySpots <= effectiveSleeps` — the room's whole capacity — and never saw
   * the occupants the header had just counted. Aspen sleeps 4 and already
   * holds 2; a three-bed household's row printed a bold green `fits`, and
   * clicking it made the card behind the dialog read 5/4 in red.
   *
   * The 2026-08-19 ruling settled what the HEADER counts and said nothing
   * about what the ROW grades, which is why this went to the owner rather
   * than being decided here. Ruled 2026-08-20: "grade against the remainder,
   * otherwise it makes no sense."
   */
  it('refuses a party that fits the room but not the beds left', () => {
    // 3 ≤ 4, so this row used to say `fits`. 3 > 4 − 2, so it does not.
    const result = candidateFit(party({ party_size: 3 }), unit({ sleeps: 4 }), [], 2)
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 3, 2 free'])
  })

  it('accepts a party that fits what is left', () => {
    const result = candidateFit(party({ party_size: 2 }), unit({ sleeps: 4 }), [], 2)
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('never counts a negative bed, however over-filled the room already is', () => {
    // The header refuses to print a negative remainder for the same reason
    // (`Math.max(0, …)`), and says "Over capacity — 5 placed, sleeps 2"
    // instead. Nothing fits into a room with nothing left.
    const result = candidateFit(party({ party_size: 1 }), unit({ sleeps: 2 }), [], 5)
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 1, 0 free'])
  })

  it('still says nothing about a capacity nobody has recorded', () => {
    // `null` is "nobody has counted", not "sleeps nobody" — occupants cannot
    // turn an unmeasured room into a full one.
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: null }), [], 4)
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('discounts the occupants of a COMBINED house against its whole-house total', () => {
    const house = unit({
      unit_id: 'u9',
      code: 'gt-house',
      name: 'Granite House',
      sleeps: 1,
      is_container: true,
      is_combined: true,
    })
    const rooms = [
      unit({ unit_id: 'u10', code: 'gt-house-a', sleeps: 3, parent_code: 'gt-house' }),
      unit({ unit_id: 'u11', code: 'gt-house-b', sleeps: 3, parent_code: 'gt-house' }),
    ]
    // 7 beds in the house, 4 taken, so a 3-bed household is the last that fits.
    expect(candidateFit(party({ party_size: 3 }), house, [house, ...rooms], 4).fit).toBe('fits')
    expect(candidateFit(party({ party_size: 4 }), house, [house, ...rooms], 4).fit).toBe('unmet')
  })

  it('grades every row in the list against the same remainder', () => {
    const rows = placementCandidates(
      [
        party({ household_cm_id: 1, sort_name: 'Garcia', party_size: 2 }),
        party({ household_cm_id: 2, sort_name: 'Johnson', party_size: 3 }),
      ],
      unit({ sleeps: 4 }),
      [],
      2
    )
    const byId = new Map(rows.map((row) => [row.party.household_cm_id, row]))
    expect(byId.get(1)?.fit).toBe('fits')
    expect(byId.get(2)?.fit).toBe('unmet')
  })

  it('defaults to an EMPTY room when no occupancy is passed', () => {
    // The parameter is optional so no caller is forced to thread a number it
    // does not have; the default has to be the reading this function had
    // before, not a silent zero-capacity room.
    expect(candidateFit(party({ party_size: 4 }), unit({ sleeps: 4 }), []).fit).toBe('fits')
  })
})

describe('capacityVerdict — a sized write-in folds into the beds graded (fix-wave 2026-08-22)', () => {
  /*
   * `dragCapacity.known` (`LodgingUnitCard.tsx`) went PER-COVER at kindred#2503:
   * a sized write-in now grades like any other occupant, and only an unknown
   * one withholds the claim. `capacityVerdict`'s blanket `hasWriteIn` refusal
   * stayed card-wide, so once any size was recorded the Assign modal's header
   * ("3 of 5 beds free") disagreed with every candidate row beneath it, which
   * kept right on refusing to grade. This closes that gap: `capacityVerdict`
   * now reads the same `writeInDemand` the header and the card read, and
   * declines only when it is not `known` — never on `hasWriteIn` alone.
   */
  it('still refuses an unsized cover — no fact to grade against', () => {
    const unsized = unit({
      sleeps: 5,
      write_ins: [
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Emma Johnson',
          note: '',
        },
      ],
    })
    const result = candidateFit(party({ party_size: 2 }), unsized, [])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })

  it('grades a sized cover, and counts its beds against the room', () => {
    const sized = unit({
      sleeps: 5,
      write_ins: [
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Emma Johnson',
          note: '',
          party_size: 2,
        },
      ],
    })
    // 5 beds, 2 taken by the write-in, 3 left.
    const fits = candidateFit(party({ party_size: 3 }), sized, [])
    expect(fits.fit).toBe('fits')
    expect(fits.notes).toEqual([])

    const unmet = candidateFit(party({ party_size: 4 }), sized, [])
    expect(unmet.fit).toBe('unmet')
    expect(unmet.notes).toEqual(['Over capacity · needs 4, 3 free'])
  })

  it('refuses a partly-sized card — one unsized cover is enough to withhold the claim', () => {
    const partlySized = unit({
      sleeps: 6,
      write_ins: [
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Emma Johnson',
          note: '',
          party_size: 2,
        },
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Noah Smith',
          note: '',
        },
      ],
    })
    const result = candidateFit(party({ party_size: 1 }), partlySized, [])
    expect(result.fit).toBe('fits')
    expect(result.notes).toEqual([])
  })
})

describe('placementCandidates', () => {
  it('never drops a party, however badly it fits', () => {
    // The ruling, stated as arithmetic: filtering to "what fits" would leave
    // staff unable to place anybody.
    const parties = [
      party({ household_cm_id: 1, sort_name: 'Garcia', flags: { needs_private_bathroom: true } }),
      party({ household_cm_id: 2, sort_name: 'Johnson', flags: { needs_power: true } }),
      party({ household_cm_id: 3, sort_name: 'Nguyen', party_size: 99 }),
    ]
    const rows = placementCandidates(
      parties,
      // `bathroom: 'none'` — a cabin with no bathroom at all. Was `'shared'`,
      // which stopped being an unmet vehicle at kindred#2501.
      unit({ bathroom: 'none', power_coverage: 'none' }),
      []
    )
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.fit === 'unmet')).toBe(true)
  })

  it('orders the best fit first, then partial, then unmet', () => {
    const fitting = party({ household_cm_id: 1, sort_name: 'Zimmerman' })
    const partial = party({ household_cm_id: 2, sort_name: 'Adams', flags: { needs_power: true } })
    const unmet = party({
      household_cm_id: 3,
      sort_name: 'Baker',
      flags: { needs_private_bathroom: true },
    })
    const rows = placementCandidates(
      [unmet, partial, fitting],
      // `bathroom: 'none'` is what makes the third party unmet; `'shared'` no
      // longer does (kindred#2501). The ordering rule under test is unchanged.
      unit({ bathroom: 'none', power_coverage: 'some' }),
      []
    )
    expect(rows.map((row) => row.fit)).toEqual(['fits', 'partial', 'unmet'])
    expect(rows.map((row) => row.party.household_cm_id)).toEqual([1, 2, 3])
  })

  it('breaks a tie on sort_name, so the order is stable rather than payload order', () => {
    const rows = placementCandidates(
      [
        party({ household_cm_id: 1, sort_name: 'Rodriguez' }),
        party({ household_cm_id: 2, sort_name: 'Garcia' }),
        party({ household_cm_id: 3, sort_name: 'Nguyen' }),
      ],
      unit(),
      []
    )
    expect(rows.map((row) => row.party.sort_name)).toEqual(['Garcia', 'Nguyen', 'Rodriguez'])
  })
})

describe('candidateFit — one grading, and the notes the glyphs now carry (kindred#2072)', () => {
  /*
   * This module was the FOURTH table grading these needs, and the survey that
   * planned kindred#2072 counted three. Its own doc had spotted the
   * divergence and said so: fridge and step-free hatched the board mid-drag
   * and annotated `fits` here.
   *
   * What it had right, and what `needGlyphs.ts` therefore had to learn rather
   * than flatten: a CANDIDATE has no placement, so its bathroom must be read
   * off the cabin being considered and never off `party.effective_bathroom`.
   * That is the `prospective` reading.
   */
  it('grades all four ruled needs, not the two it used to', () => {
    const result = candidateFit(
      party({ flags: { needs_fridge: true } }),
      unit({ fridge_coverage: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
  })

  it('grades step-free, and SOME rooms is worse than none for it', () => {
    // The `is_accessible` shape: a building advertising two step-free rooms
    // out of ten invites precisely the placement that lands in one of the
    // other eight.
    expect(
      candidateFit(party({ flags: { needs_step_free: true } }), unit({ ramp_coverage: 'some' }), [])
        .fit
    ).toBe('unmet')
    expect(
      candidateFit(
        party({ flags: { needs_step_free: true } }),
        unit({ ramp_coverage: 'partial' }),
        []
      ).fit
    ).toBe('partial')
  })

  it('reads a candidate bathroom off the CABIN, never off a placement it does not have', () => {
    // Every party in this list is unplaced, so `effective_bathroom` is the
    // wrong question — it would annotate identically on every cabin.
    //
    // BOTH arms now disagree with the party's own field, which is what makes
    // them discriminating: the old second arm paired `effective_bathroom:
    // 'none'` with `bathroom: 'shared'` and, once kindred#2501 made `'shared'`
    // meet the need, the two readings answered differently for the first time
    // — so it started failing. Fixed by giving it a party whose PLACED reading
    // would say `fits`, against a cabin that says `none`.
    const wouldFail = party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'none' })
    const wouldPass = party({
      flags: { needs_private_bathroom: true },
      effective_bathroom: 'private',
    })
    expect(candidateFit(wouldFail, unit({ bathroom: 'private' }), []).fit).toBe('fits')
    expect(candidateFit(wouldPass, unit({ bathroom: 'none' }), []).fit).toBe('unmet')
  })

  it('writes NO note for a need — the glyph beside it says the same thing', () => {
    // N2: the glyph takes the warn fill when the room does not meet the need,
    // and a note repeating it states one fact twice — the exact reason
    // `No private bathroom` was struck from the family card. The row draws
    // the same glyphs, so the same rule applies to it.
    const result = candidateFit(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      // Both dimensions genuinely fail. This was passing on the power arm
      // alone after kindred#2501 made `bathroom: 'shared'` MEET the need,
      // which left the fixture's bathroom half saying nothing while the
      // comment above claimed it did.
      unit({ bathroom: 'none', power_coverage: 'none' }),
      []
    )
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual([])
  })

  it('keeps the CAPACITY note, which no glyph carries', () => {
    const result = candidateFit(party({ party_size: 6 }), unit({ sleeps: 4 }), [])
    expect(result.fit).toBe('unmet')
    expect(result.notes).toEqual(['Over capacity · needs 6, 4 free'])
  })
})

/**
 * Pinning by staff group — the Assign modal's half of kindred#2480.
 *
 * The module's "it annotates and orders, it never hides" ruling is the whole
 * constraint here: a group PIN reorders and nothing else. Every test below
 * exists to prove the list that comes out is the list that went in.
 */
describe('partitionByGroup — pins without hiding', () => {
  const bathroomer = party({
    household_cm_id: 301,
    sort_name: 'Alvarez',
    flags: { needs_private_bathroom: true },
  })
  const plainA = party({ household_cm_id: 302, sort_name: 'Bennett' })
  const plainB = party({ household_cm_id: 303, sort_name: 'Castillo' })

  function candidates(): PlacementCandidate[] {
    return [plainA, bathroomer, plainB].map((party) => ({
      party,
      fit: 'fits' as const,
      notes: [],
    }))
  }

  it('returns every candidate it was given, split in two', () => {
    const { pinned, rest } = partitionByGroup(candidates(), 'bathroom')
    expect(pinned).toHaveLength(1)
    expect(rest).toHaveLength(2)
    // The invariant the module doc protects: nothing is lost in the split.
    expect([...pinned, ...rest]).toHaveLength(candidates().length)
  })

  it('puts the matches first and leaves everyone else in their existing order', () => {
    const { pinned, rest } = partitionByGroup(candidates(), 'bathroom')
    expect(pinned[0]?.party.sort_name).toBe('Alvarez')
    // Bennett/Castillo keep the fit-then-name order they arrived in — the
    // pin is a second axis over the fit sort, never a replacement for it.
    expect(rest.map((c) => c.party.sort_name)).toEqual(['Bennett', 'Castillo'])
  })

  it('pins nobody when no group is picked', () => {
    const { pinned, rest } = partitionByGroup(candidates(), null)
    expect(pinned).toHaveLength(0)
    expect(rest).toHaveLength(3)
  })

  it('keeps the fit order WITHIN the pinned band', () => {
    // An over-capacity family must not float above one that fits merely
    // because it asked for a bathroom. The band is a grouping, not a promotion.
    const other = party({
      household_cm_id: 304,
      sort_name: 'Abbott',
      flags: { needs_private_bathroom: true },
    })
    const list: PlacementCandidate[] = [
      { party: bathroomer, fit: 'fits', notes: [] },
      { party: other, fit: 'unmet', notes: ['Over capacity'] },
    ]
    const { pinned } = partitionByGroup(list, 'bathroom')
    expect(pinned.map((c) => c.fit)).toEqual(['fits', 'unmet'])
  })
})
