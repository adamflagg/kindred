/**
 * Triage for the weekend roster.
 *
 * The roster's job is not to list parties — the board places them. Its job is
 * to say which ones need a decision and why. That only works if the signals it
 * ranks on are actually discriminating: measured against real 2026 data,
 * `needs_resolution` is true for 44 of 62 parties, and `has_medical_narrative`
 * (deleted in kindred#1889) was true for 62 of 62, so neither can drive
 * triage.
 *
 * The state that matters most is a party whose cabin does not provide what
 * they asked for. That is computed only against a CONFIRMED cabin, because an
 * unset `has_power` means "nobody has said" rather than "there is no power" —
 * so an unconfirmed cabin reports "not verified" instead of flagging every
 * constrained family off unset amenity defaults.
 *
 * That gate is now OPEN. This paragraph used to say "all 82 cabins are
 * `is_confirmed: false` today", and production is 118/118 confirmed as of
 * 2026-08-09 — the unconfirmed fixtures below are the fallback branch, not
 * the state of the registry. Corrected alongside the same claim in
 * `rosterAttention.ts` under kindred#2180.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { partyHeadcount } from './householdIdentity'
import {
  attentionSections,
  countUnmeasuredSpaces,
  partyAttention,
  partyBeds,
  resolvePartyUnit,
} from './rosterAttention'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'The Johnson Family',
    adults: [{ adult_number: 1, display_name: 'Samuel Johnson', relationship: 'Parent' }],
    children: [{ person_cm_id: 1000001, display_name: 'Emma Johnson', age: 9, grade: 4 }],
    party_size: 2,
    unit_code: 'ridge-a',
    unit_name: 'Ridge A',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    },
    ...overrides,
  }
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'ridge-a',
    name: 'Ridge A',
    sleeps: 5,
    bathroom: 'none',
    has_power: false,
    // The RESOLVED field the grading actually reads since kindred#2072, kept
    // in step with the raw flag beside it because a real server row carries
    // both. `has_power: false` alone used to be enough to fail a power check;
    // it no longer is, and that is the container bug's fix rather than a
    // loosened assertion — see the `power_coverage` block below.
    power_coverage: 'none',
    is_confirmed: true,
    is_active: true,
    is_container: false,
    is_family_available: true,
    ...overrides,
  }
}

describe('partyAttention — ranking', () => {
  it('ranks a mandatory accommodation above everything else', () => {
    const a = partyAttention(
      party({ flags: { needs_accommodation: true, accommodation_is_mandatory: true } })
    )
    expect(a.level).toBe('required')
  })

  it('still reports a mandatory accommodation when the party is also unplaced', () => {
    const a = partyAttention(party({ unit_name: '', flags: { accommodation_is_mandatory: true } }))
    expect(a.level).toBe('required')
  })

  it('flags an unplaced party', () => {
    expect(partyAttention(party({ unit_name: '', unit_code: '' })).level).toBe('unplaced')
  })

  it('settles a placed party with no requested needs', () => {
    expect(partyAttention(party(), unit()).level).toBe('settled')
  })
})

describe('partyAttention — does the cabin provide what was asked for', () => {
  it('reports an unmet need when a CONFIRMED cabin lacks it', () => {
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'shared' }),
      unit({ is_confirmed: true, bathroom: 'shared' })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No private bathroom')
  })

  it('settles when a confirmed cabin provides everything asked for', () => {
    const a = partyAttention(
      party({
        flags: { needs_private_bathroom: true, needs_power: true },
        effective_bathroom: 'private',
      }),
      unit({ is_confirmed: true, bathroom: 'private', has_power: true, power_coverage: 'all' })
    )
    expect(a.level).toBe('settled')
  })

  it('names every unmet need, not just the first', () => {
    const a = partyAttention(
      party({
        flags: { needs_private_bathroom: true, needs_power: true },
        effective_bathroom: 'none',
      }),
      unit({ is_confirmed: true, bathroom: 'none', has_power: false })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No private bathroom · No power')
  })

  /*
   * kindred#2072 — power is graded on the SERVER'S RESOLVED COVERAGE now, not
   * on the raw `has_power` this module used to read.
   *
   * Twelve of the fourteen 2026 family-pool containers record `has_power = 0`
   * while every leaf beneath them has power. The raw read called all twelve
   * unpowered, so the roster said "No power" about a building the board's own
   * drag-time hatch called fine — one fact, two answers, which is the
   * disagreement `needGlyphs.ts` exists to end.
   */
  it('settles a container whose rooms all have power, though its own row does not', () => {
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: true, has_power: false, power_coverage: 'all' })
    )
    expect(a.level).toBe('settled')
  })

  it('still flags a cabin where no room has power', () => {
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: true, power_coverage: 'none' })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No power')
  })

  it('flags a building where only SOME rooms have power — the roster has no third band', () => {
    // The board grades this `partial` and hatches it more loosely. The roster
    // is binary and takes the conservative direction: everything short of
    // `fits` stays flagged, so no case that used to flag has quietly stopped.
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: true, power_coverage: 'some' })
    )
    expect(a.level).toBe('unmet')
  })

  it('does not flag a cabin whose power nobody has resolved', () => {
    // `unknown` is the fourth value's whole point: absence of evidence is not
    // evidence of absence.
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: true, power_coverage: 'unknown' })
    )
    expect(a.level).toBe('settled')
  })

  /*
   * ⚠️ THE SCOPE, PINNED — the roster grades TWO of the four ruled needs.
   *
   * `needs_fridge` and `needs_step_free` draw a glyph on the family card
   * (kindred#2072) and move the board's hatch, and `needGlyphs.ts` grades all
   * four identically. They stay OUT of these sections deliberately: the
   * sections are a staff-facing classification with counts on them, and
   * folding two more needs in moves parties from `settled` into `unmet`.
   * That is a ruling to take, not a side effect to inherit — so this pins the
   * scope rather than leaving the next reader to guess whether the omission
   * was deliberate.
   */
  it('does not grade fridge or step-free on the roster, though the card draws both', () => {
    const a = partyAttention(
      party({ flags: { needs_fridge: true, needs_step_free: true } }),
      unit({ is_confirmed: true, fridge_coverage: 'none', ramp_coverage: 'none' })
    )
    expect(a.level).toBe('settled')
  })

  it('reports "not verified" when the cabin amenities are unconfirmed', () => {
    // The live state: every cabin is unconfirmed, so `has_power: false` means
    // "nobody has said", not "there is no power". Treating that as unmet would
    // flag every constrained family on false evidence.
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: false, has_power: false })
    )
    expect(a.level).toBe('unverified')
    expect(a.reason).toBe('Power')
  })

  it('reports "not verified" when the assigned cabin cannot be found', () => {
    // A merged slot is named for the merge, not a unit code — `unit` is
    // undefined here for exactly that reason. The `is_confirmed` gate is
    // still load-bearing even though the private-bathroom predicate now
    // reads a party-level field: the server already resolved this merge as
    // `private` (kindred#2022), and it must STILL read as unverified with no
    // cabin to confirm it against, never a false `settled`.
    const a = partyAttention(
      party({
        flags: { needs_private_bathroom: true },
        is_merged_slot: true,
        effective_bathroom: 'private',
      }),
      undefined
    )
    expect(a.level).toBe('unverified')
  })

  it('credits a whole-house merge as settled once the server resolves it private (kindred#1982)', () => {
    // `RosterParty.unit_code` is "" on a merged slot by design, so the fit
    // check cannot read a bathroom off a single unit here — that is exactly
    // the gap kindred#1982 closes. `effective_bathroom` is the SERVER's
    // answer across every code the placement covers
    // (`lodging_rules.effective_bathroom`, kindred#2022): it already
    // credits "private" once the party holds every member of a
    // bathroom_group, so the fix is to read it rather than `unit.bathroom`.
    // `unit` here stands for whichever occupied leaf a caller resolved it
    // against (the map draws a merged party once per leaf it occupies) —
    // its own `bathroom` is still 'shared', proving the credit comes from
    // `effective_bathroom`, not from the unit's own field.
    const a = partyAttention(
      party({
        flags: { needs_private_bathroom: true },
        is_merged_slot: true,
        unit_code: '',
        unit_codes: ['tioga-1', 'tioga-2'],
        effective_bathroom: 'private',
      }),
      unit({ code: 'tioga-1', bathroom: 'shared', is_confirmed: true })
    )
    expect(a.level).toBe('settled')
  })

  it('does not credit a strict subset of a bathroom_group', () => {
    // Holding only one of the two rooms in the group never clears the
    // exclusivity bar server-side, so `effective_bathroom` stays 'shared'.
    const a = partyAttention(
      party({
        flags: { needs_private_bathroom: true },
        is_merged_slot: false,
        effective_bathroom: 'shared',
      }),
      unit({ bathroom: 'shared', is_confirmed: true })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No private bathroom')
  })

  it('never infers settled from a missing bathroom_group, even unconfirmed', () => {
    // The "8 containers whose every child carries no group" gap the issue
    // calls out: no group to test exclusivity against means "we don't
    // know", not "private" — and an unconfirmed cabin on top of that must
    // stay unverified, never settled on the strength of unset data.
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'unknown' }),
      unit({ is_confirmed: false })
    )
    expect(a.level).toBe('unverified')
  })

  it('cannot verify a generic accommodation request even on a confirmed cabin', () => {
    // `needs_accommodation` names no specific amenity, so no cabin field
    // settles it.
    const a = partyAttention(
      party({ flags: { needs_accommodation: true } }),
      unit({ is_confirmed: true, bathroom: 'private', has_power: true, power_coverage: 'all' })
    )
    expect(a.level).toBe('unverified')
  })

  it('does not re-list a need the confirmed cabin already provides', () => {
    // A generic accommodation keeps the party unverified, because no cabin
    // field settles it. That must not drag the SPECIFIC needs back into the
    // reason: a confirmed cabin with power has verifiably answered "Power",
    // and saying otherwise reads as "we don't know if this cabin has power"
    // when the registry says it does.
    const a = partyAttention(
      party({ flags: { needs_power: true, needs_accommodation: true } }),
      unit({ is_confirmed: true, has_power: true, power_coverage: 'all' })
    )
    expect(a.level).toBe('unverified')
    expect(a.reason).toBe('Accommodation')
  })

  it('keeps the specific needs in the reason while the cabin is unconfirmed', () => {
    // The mirror of the case above: without confirmation nothing is verified,
    // so both the specific need and the generic accommodation are outstanding.
    const a = partyAttention(
      party({ flags: { needs_power: true, needs_accommodation: true } }),
      unit({ is_confirmed: false, has_power: true, power_coverage: 'all' })
    )
    expect(a.level).toBe('unverified')
    expect(a.reason).toBe('Power · Accommodation')
  })

  it('does not escalate on an infant, which is context rather than a request', () => {
    // Derived from the household's ages, not asked for. It informs which cabin
    // suits them; it is not an unfulfilled request.
    expect(partyAttention(party({ flags: { has_infant: true } }), unit()).level).toBe('settled')
  })

  it('does NOT escalate on needs_resolution alone', () => {
    const a = partyAttention(
      party({ share: { needs_resolution: true, request_text: 'near the Garcia family' } }),
      unit()
    )
    expect(a.level).toBe('settled')
  })
})

describe('resolvePartyUnit', () => {
  // `unit_code` is "" on a merged slot by design (kindred#1982), so
  // `unitsByCode.get(party.unit_code ?? '')` — the resolution every caller
  // used — always returns undefined for a genuine multi-leaf merge, and
  // `partyAttention`'s `is_confirmed` gate never gets evidence to check.
  // `resolvePartyUnit` is the caller-side fix: it falls back to
  // `unit_codes` and only trusts the merge as evidence once EVERY member
  // resolves and is confirmed — one unconfirmed room is still an absence
  // of data, same principle as the single-unit gate, not a looser one for
  // having more rooms.

  it('resolves an ordinary placement off unit_code, unchanged', () => {
    const u = unit({ code: 'ridge-a' })
    const resolved = resolvePartyUnit(party({ unit_code: 'ridge-a' }), new Map([['ridge-a', u]]))
    expect(resolved).toBe(u)
  })

  it('resolves a whole-house merge once every member is confirmed', () => {
    const a = unit({ code: 'tioga-1', is_confirmed: true })
    const b = unit({ code: 'tioga-2', is_confirmed: true })
    const resolved = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['tioga-1', 'tioga-2'], is_merged_slot: true }),
      new Map([
        ['tioga-1', a],
        ['tioga-2', b],
      ])
    )
    expect(resolved).toBeDefined()
    expect(resolved?.is_confirmed).toBe(true)
  })

  it('refuses to treat a merge as evidence while ANY member is unconfirmed', () => {
    const a = unit({ code: 'tioga-1', is_confirmed: true })
    const b = unit({ code: 'tioga-2', is_confirmed: false })
    const resolved = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['tioga-1', 'tioga-2'], is_merged_slot: true }),
      new Map([
        ['tioga-1', a],
        ['tioga-2', b],
      ])
    )
    expect(resolved).toBeUndefined()
  })

  it('refuses to treat a merge as evidence when a member code cannot be found', () => {
    const a = unit({ code: 'tioga-1', is_confirmed: true })
    const resolved = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['tioga-1', 'ghost'], is_merged_slot: true }),
      new Map([['tioga-1', a]])
    )
    expect(resolved).toBeUndefined()
  })

  it('returns undefined for an unplaced party (neither field set)', () => {
    expect(resolvePartyUnit(party({ unit_code: '', unit_codes: [] }), new Map())).toBeUndefined()
  })
})

describe('partyAttention + resolvePartyUnit — the roster row / card / panel pipeline', () => {
  // The pipeline every caller actually runs: resolve a unit, then feed it to
  // `partyAttention`. `settled` here proves the fix reaches the surfaces
  // that resolve off `unit_code`/`unit_codes` — the roster row, family
  // card, and detail panel — not just a hand-picked `unit` fixture.
  it('credits a confirmed whole-house merge as settled end to end', () => {
    const a = unit({ code: 'tioga-1', bathroom: 'shared', is_confirmed: true })
    const b = unit({ code: 'tioga-2', bathroom: 'shared', is_confirmed: true })
    const mergedParty = party({
      flags: { needs_private_bathroom: true },
      is_merged_slot: true,
      unit_code: '',
      unit_name: 'Tioga 1 + Tioga 2',
      unit_codes: ['tioga-1', 'tioga-2'],
      effective_bathroom: 'private',
    })
    const unitsByCode = new Map([
      ['tioga-1', a],
      ['tioga-2', b],
    ])
    const attention = partyAttention(mergedParty, resolvePartyUnit(mergedParty, unitsByCode))
    expect(attention.level).toBe('settled')
  })

  it('mutation guard: one unconfirmed member of the merge keeps it unverified', () => {
    const a = unit({ code: 'tioga-1', bathroom: 'shared', is_confirmed: true })
    const b = unit({ code: 'tioga-2', bathroom: 'shared', is_confirmed: false })
    const mergedParty = party({
      flags: { needs_private_bathroom: true },
      is_merged_slot: true,
      unit_code: '',
      unit_name: 'Tioga 1 + Tioga 2',
      unit_codes: ['tioga-1', 'tioga-2'],
      effective_bathroom: 'private',
    })
    const unitsByCode = new Map([
      ['tioga-1', a],
      ['tioga-2', b],
    ])
    const attention = partyAttention(mergedParty, resolvePartyUnit(mergedParty, unitsByCode))
    expect(attention.level).toBe('unverified')
  })
})

describe('partyBeds', () => {
  it('uses the reported party size', () => {
    expect(partyBeds(party({ party_size: 4 }))).toBe(4)
  })

  it('falls back to counting people when party_size is absent', () => {
    const withoutSize = party({
      adults: [
        { adult_number: 1, display_name: 'Olivia Chen' },
        { adult_number: 2, display_name: 'Liam Garcia' },
      ],
      children: [{ person_cm_id: 1, display_name: 'Olivia Chen' }],
    })
    delete withoutSize.party_size
    expect(partyBeds(withoutSize)).toBe(3)
  })

  it('does not recount a placeholder adult in the fallback', () => {
    // Same predicate as the server (`householdIdentity.namedAdults`), so a
    // household discounted server-side is not re-inflated here. This copy is
    // byte-identical to `boardLayout.partySize` and pinned separately on
    // purpose — three copies is exactly how they stop being identical.
    const reportedZero = party({
      party_size: 0,
      adults: [
        { adult_number: 1, display_name: 'Olivia Chen' },
        { adult_number: 2, display_name: 'NA' },
      ],
      children: [{ person_cm_id: 1, display_name: 'Liam Garcia' }],
    })
    expect(partyBeds(reportedZero)).toBe(2)
  })

  /*
   * THE TWO NUMBERS MUST NOT CONVERGE.
   *
   * `partyBeds` is BEDS; `partyHeadcount` is PEOPLE. Since #2046 the server
   * discounts a child under 18 months at session start, so for the 24
   * households with an infant the bed figure is deliberately one BELOW the
   * names printed beside it. kindred#2152 exists because a badge reached for
   * the bed number where it wanted the people number.
   *
   * Asserting BOTH on one party is the point — a test that pinned only
   * `partyBeds` would stay green if someone "tidied" this into
   * `partyHeadcount`, which is exactly the collapse that re-creates the bug.
   */
  it('stays the bed number for an infant household, one below the headcount', () => {
    const infantHousehold = party({
      // Server-reported: 1 adult + 1 school-age child. The infant is discounted.
      party_size: 2,
      adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: 'Mother' }],
      children: [
        { person_cm_id: 1000010, display_name: 'Mateo Chen', age: 6, grade: 1 },
        { person_cm_id: 1000011, display_name: 'Ivy Chen', age: 0.11, grade: 0 },
      ],
      flags: {
        needs_private_bathroom: false,
        needs_power: false,
        needs_accommodation: false,
        accommodation_is_mandatory: false,
        has_infant: true,
      },
    })
    expect(partyBeds(infantHousehold)).toBe(2)
    expect(partyHeadcount(infantHousehold)).toBe(3)
  })

  /*
   * The FALLBACK arm — and only the fallback arm — is `partyHeadcount`.
   *
   * With nothing reported there is no bed figure to honour, and the client
   * cannot re-derive the infant discount (`PartyChild.age` is CampMinder's
   * `yy.mm`, the field #2046 forbids thresholding). Counting the bodies
   * over-states, which is the safe direction here. This pins that the two
   * agree ONLY when `party_size` is absent, so the delegation is provably the
   * common part rather than a collapse of the whole function.
   */
  it('equals the headcount only when no bed count was reported', () => {
    const unreported = party({
      adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: 'Mother' }],
      children: [
        { person_cm_id: 1000010, display_name: 'Mateo Chen', age: 6, grade: 1 },
        { person_cm_id: 1000011, display_name: 'Ivy Chen', age: 0.11, grade: 0 },
      ],
    })
    delete unreported.party_size
    expect(partyBeds(unreported)).toBe(partyHeadcount(unreported))
    expect(partyBeds(unreported)).toBe(3)
  })
})

describe('countUnmeasuredSpaces', () => {
  it('counts only the spaces a family could actually be placed into', () => {
    // Deliberately not `counts.units_capacity_unknown`. It used to span staff
    // holds — 5 on real 2026 data where only 2 of the 79 placeable spaces were
    // unmeasured — but `_build_counts` now excludes staff housing, so on that
    // data the two agree. What still separates them is a cabin HELD BACK this
    // weekend: still planning inventory, so `units_capacity_unknown` keeps it,
    // while nobody can be placed in it today, so this drops it.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'a', sleeps: null }),
        unit({ code: 'b', sleeps: 5 }),
        unit({ code: 'c', sleeps: null, is_family_available: false }),
        unit({ code: 'd', sleeps: null, is_container: true }),
      ])
    ).toBe(1)
  })

  it('treats an absent capacity the same as an explicit null', () => {
    const noSleeps = unit({ code: 'e' })
    delete noSleeps.sleeps
    expect(countUnmeasuredSpaces([noSleeps])).toBe(1)
  })

  it('returns zero for an empty registry', () => {
    expect(countUnmeasuredSpaces([])).toBe(0)
  })

  it('asks about the COMBINED house, not the rooms it draws in place of', () => {
    // A combined container is the card, so an unmeasured house is an
    // unmeasured space — and its rooms are not drawn at all, so their own
    // missing capacity describes nothing a family could be put in. Counting
    // the rooms reports 2 unmeasured spaces against a board showing one card.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'house', is_container: true, is_combined: true, sleeps: null }),
        unit({ code: 'r1', parent_code: 'house', sleeps: null }),
        unit({ code: 'r2', parent_code: 'house', sleeps: null }),
      ])
    ).toBe(1)
  })

  it('counts a combined house whose ROOMS are unmeasured, even when the house is not', () => {
    // This asserted 0 until kindred#1945's PR, on the reading that the
    // container's own 6 was the house's capacity. It is not: kindred#2041
    // ruled a container's `sleeps` is a DELTA over its rooms — the futon on
    // the landing — so 6 plus two unmeasured rooms is an unmeasured house.
    //
    // THE MIRROR of `_effective_sleeps` in
    // `api/services/lodging_roster_service.py`, which returns None for exactly
    // this shape. `WeekendStatsBar` prints the backend's
    // `beds_family_available` on the same line as this count, so if the two
    // disagree the bar reports beds for a house it simultaneously calls
    // measured.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'house', is_container: true, is_combined: true, sleeps: 6 }),
        unit({ code: 'r1', parent_code: 'house', sleeps: null }),
        unit({ code: 'r2', parent_code: 'house', sleeps: null }),
      ])
    ).toBe(1)
  })

  it('does NOT count a combined house whose rooms all carry numbers', () => {
    // The regression guard for the case above: walking to the leaves must not
    // start calling every combined house unmeasured. Also the 14-of-15
    // production shape — no common-space furniture recorded on the house
    // itself, which the delta rule reads as a real zero.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'house', is_container: true, is_combined: true, sleeps: null }),
        unit({ code: 'r1', parent_code: 'house', sleeps: 2 }),
        unit({ code: 'r2', parent_code: 'house', sleeps: 2 }),
      ])
    ).toBe(0)
  })

  it('ignores an INACTIVE room when judging its house', () => {
    // Active leaves only, the same qualifier `_effective_sleeps` applies. A
    // retired room nobody will ever measure must not park its whole house in
    // the unmeasured list permanently.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'house', is_container: true, is_combined: true, sleeps: 6 }),
        unit({ code: 'r1', parent_code: 'house', sleeps: 4 }),
        unit({ code: 'r2', parent_code: 'house', sleeps: null, is_active: false }),
      ])
    ).toBe(0)
  })

  it('counts a combined house with no figure of its own and no rooms beneath it', () => {
    // The degenerate case, and the one worth writing a test for because the
    // obvious implementation gets it wrong: summing an absent delta over an
    // empty room list yields 0, i.e. the confident claim "this house sleeps
    // nobody". "Unset container reads as a delta of zero" holds only because
    // its rooms supply the rest of the answer.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'house', is_container: true, is_combined: true, sleeps: null }),
      ])
    ).toBe(1)
  })

  it('still counts the rooms of a SPLIT house, and never the house', () => {
    // The pre-feature behaviour, unchanged — the regression guard for the two
    // above. A grouping row that gets no card is not a space.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'house', is_container: true, is_combined: false, sleeps: null }),
        unit({ code: 'r1', parent_code: 'house', sleeps: null }),
        unit({ code: 'r2', parent_code: 'house', sleeps: null }),
      ])
    ).toBe(2)
  })
})

describe('attentionSections', () => {
  it('orders sections by urgency and drops the empty ones', () => {
    const sections = attentionSections(
      [
        party({ display_name: 'Settled Family' }),
        party({ display_name: 'Unplaced Family', unit_name: '', unit_code: '' }),
      ],
      new Map([['ridge-a', unit()]])
    )
    expect(sections.map((s) => s.level)).toEqual(['unplaced', 'settled'])
  })

  it('puts a cabin that does not fit above one that is merely unplaced', () => {
    // An unplaced family is visibly outstanding. A family placed somewhere
    // that does not work looks done and is not.
    const sections = attentionSections(
      [
        party({ display_name: 'Unplaced Family', unit_name: '', unit_code: '' }),
        party({
          display_name: 'Wrong Cabin Family',
          household_cm_id: 2000002,
          flags: { needs_power: true },
        }),
      ],
      new Map([['ridge-a', unit({ is_confirmed: true, has_power: false })]])
    )
    expect(sections.map((s) => s.level)).toEqual(['unmet', 'unplaced'])
  })

  it('preserves the order the API sent within a section', () => {
    const sections = attentionSections(
      [
        party({ display_name: 'Adams', unit_name: '', unit_code: '' }),
        party({ display_name: 'Baker', unit_name: '', unit_code: '' }),
        party({ display_name: 'Chen', unit_name: '', unit_code: '' }),
      ],
      new Map()
    )
    expect(sections[0]?.parties.map((p) => p.display_name)).toEqual(['Adams', 'Baker', 'Chen'])
  })

  it('reports a single section when every party shares one state', () => {
    const sections = attentionSections(
      [
        party({ unit_name: '', unit_code: '' }),
        party({ unit_name: '', unit_code: '', display_name: 'Second' }),
      ],
      new Map()
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]?.level).toBe('unplaced')
  })

  it('returns nothing for an empty roster', () => {
    expect(attentionSections([], new Map())).toEqual([])
  })
})
