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
import { buildBoard } from './boardLayout'
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
    // ⚠️ THE FIXTURE MOVED WITH kindred#2501, not just the string. This case
    // used to demonstrate "lacks it" with `shared`, which now MEETS the need
    // — a shared bathroom is one two parties split INSIDE the cabin. The only
    // value that still means "no bathroom in this unit" is `none`, which is
    // also what a walk to a bathhouse records as, so that is what a test about
    // lacking a bathroom must use.
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'none' }),
      unit({ is_confirmed: true, bathroom: 'none' })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No bathroom in unit')
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
    expect(a.reason).toBe('No bathroom in unit · No power')
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

  /*
   * ⚠️ THIS VERDICT HAS MOVED TWICE, AND BOTH MOVES ARE KEPT HERE BECAUSE THE
   * SECOND ONE UNDOES THE FIRST.
   *
   * Originally the rule was `party.effective_bathroom === 'private'`, so
   * `unknown` and an absent value both FAILED it and reported "No private
   * bathroom". kindred#2072 changed that to `unknown → fits`, on the argument
   * that the absence of evidence is not evidence of absence — one rule for all
   * four needs, and a reach of zero on today's data.
   *
   * The owner reversed it on 2026-08-20: *"unknown values should not equal
   * fits, across all surfaces on the glyphs, its unconfirmed information."*
   * What the middle position missed is that `fits` is not silence — on the
   * card it is the glyph in full hue, and on the roster it is a household
   * counted as SETTLED. Both are claims about a cabin nobody has measured, so
   * there was never a neutral option to pick.
   *
   * The reach is still nearly nil, and now measured rather than asserted:
   * across 2026's twelve weekends and 575 parties, no placed party's bathroom
   * or power coverage is anything but `all` or `none`, so no roster section
   * count moves today. It is the shape of the rule that changed.
   */
  it('flags a bathroom need the server could not resolve, rather than settling it', () => {
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'unknown' }),
      unit({ is_confirmed: true })
    )
    expect(a.level).toBe('unmet')
  })

  it('flags it when the field is absent entirely — the Pydantic-default case', () => {
    const p = party({ flags: { needs_private_bathroom: true } })
    delete p.effective_bathroom
    expect(partyAttention(p, unit({ is_confirmed: true })).level).toBe('unmet')
  })

  /*
   * ⚠️ THIS TEST NOW PINS THE OPPOSITE VERDICT — kindred#2501, and the
   * SPECIFICATION changed rather than the implementation drifting.
   *
   * It used to assert that a bathroom the server resolved as SHARED left the
   * household in the unmet band, because the flag is called
   * `needs_private_bathroom` and exclusivity was what the roster graded. Owner
   * ruling 2026-08-20: *"the glyph should not grade exclusivity, just 'do they
   * have a bathroom (shared or private)'"* — and, on this case exactly,
   * *"sharing a bathroom for whatever reason still provides people a
   * bathroom."*
   *
   * `shared` is a bathroom INSIDE the cabin that two parties split; walking to
   * a bathhouse records as `none`, not as `shared`. The CampMinder question
   * behind the flag asks for *"a bathroom that doesn't require you to leave
   * your cabin"*, which an in-cabin split bathroom answers.
   *
   * WHAT IT COSTS, ACCEPTED ON THE RECORD: the ~3–5 households a year who need
   * exclusivity rather than proximity lose an automatic red mark and are found
   * by reading the request instead. The underlying field keeps its name; the
   * rename is a deliberate follow-up.
   */
  it('settles a bathroom the server resolved as SHARED — presence, not exclusivity', () => {
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true }, effective_bathroom: 'shared' }),
      unit({ is_confirmed: true })
    )
    expect(a.level).toBe('settled')
  })

  it('flags a CONFIRMED cabin whose power nobody has resolved', () => {
    /*
     * ⚠️ REVERSED 2026-08-20 with the rule above. `unknown` used to be the
     * fourth value's whole point — absence of evidence is not evidence of
     * absence — and it now reports `unmet`, because a household counted as
     * SETTLED is as much a claim about an unmeasured cabin as one counted as
     * unmet.
     *
     * The `is_confirmed` gate above this branch is UNCHANGED and still does
     * most of the work: an unconfirmed cabin never reaches here at all, and
     * falls through to `unverified`. What this pins is the narrower case the
     * gate does not cover — a cabin somebody HAS confirmed whose coverage the
     * server still could not resolve.
     */
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: true, power_coverage: 'unknown' })
    )
    expect(a.level).toBe('unmet')
  })

  it('still routes an UNCONFIRMED cabin to unverified, never to unmet', () => {
    // The gate that predates all of this (kindred#1982) and is untouched by
    // the 2026-08-20 ruling: an unconfirmed cabin is an absence of data, and
    // the roster says so in its own band rather than borrowing the unmet one.
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: false, power_coverage: 'unknown' })
    )
    expect(a.level).toBe('unverified')
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

  it('credits a strict subset of a bathroom_group — the bathroom is still in the cabin', () => {
    /*
     * ⚠️ REVERSED BY kindred#2501, and this one is the clearest illustration
     * of what the ruling actually changed.
     *
     * Holding only one of the two rooms in a bathroom group never clears the
     * EXCLUSIVITY bar server-side, so `effective_bathroom` stays 'shared' —
     * and this test used to assert that the roster therefore flagged the
     * household. The server's resolution has not changed and neither has this
     * fixture; what changed is what the roster ASKS of it. Presence, not
     * exclusivity: the other room's family shares that bathroom, but it is
     * still a bathroom this family reaches without leaving the cabin, which is
     * what the CampMinder question asked about.
     *
     * The exclusivity case has not disappeared, it has stopped being
     * automatic: the ~3–5 households a year who need a bathroom nobody else
     * uses are found by reading the request. The owner accepted that trade on
     * 2026-08-20.
     */
    const a = partyAttention(
      party({
        flags: { needs_private_bathroom: true },
        is_merged_slot: false,
        effective_bathroom: 'shared',
      }),
      unit({ bathroom: 'shared', is_confirmed: true })
    )
    expect(a.level).toBe('settled')
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

  /*
   * ⚠️ WHICH CARD GRADES THE PARTY — and until now the two grading paths
   * answered differently for the same family.
   *
   * `LodgingUnitCard` grades its occupants against the card it DREW. This
   * function returned `members[0]`: the first id in the `units` relation, i.e.
   * whatever order the rows were stored in. Seven 2026 placements resolved to
   * a different unit on the two paths. No verdict differed on that data only
   * because every container and every leaf resolved `power_coverage: 'all'` —
   * but two containers have leaves that disagree on `has_fridge`, so the
   * container resolves `fridge_coverage: 'some'` while one leaf says `all` and
   * the other says `none`. Which answer a family got depended on which room
   * happened to be stored first. The tests below pin the rule instead: the
   * card the board draws, and where a placement spans several cards, the WORST
   * grade rather than an arbitrary member's.
   */

  it('resolves a merged placement to the CARD the board draws, not a member room', () => {
    const combined = unit({
      unit_id: 'c1',
      code: 'block',
      name: 'Block',
      is_container: true,
      is_combined: true,
      // The server's roll-up over the two rooms below: they disagree, so the
      // container reports `some`. A member room reports `all` or `none` and
      // neither is the whole let's answer.
      fridge_coverage: 'some',
      power_coverage: 'all',
    })
    const roomOne = unit({
      unit_id: 'c2',
      code: 'block-1',
      name: 'Block 1',
      parent_code: 'block',
      fridge_coverage: 'all',
      power_coverage: 'all',
    })
    const roomTwo = unit({
      unit_id: 'c3',
      code: 'block-2',
      name: 'Block 2',
      parent_code: 'block',
      fridge_coverage: 'none',
      power_coverage: 'all',
    })
    const units = [combined, roomOne, roomTwo]
    const resolved = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['block-1', 'block-2'], is_merged_slot: true }),
      new Map(units.map((row) => [row.code, row]))
    )
    expect(resolved).toBe(combined)
    expect(resolved?.fridge_coverage).toBe('some')
  })

  it('agrees with the board about which card a merged placement is graded on', () => {
    // The parity assertion, against the board's OWN model rather than a
    // restatement of the rule: `buildBoard` decides which card a placement
    // lands on, and this function must land on the same one. Two
    // implementations of "which card represents this placement" is exactly
    // how the two paths drifted apart in the first place.
    const combined = unit({
      unit_id: 'c1',
      code: 'block',
      name: 'Block',
      is_container: true,
      is_combined: true,
      fridge_coverage: 'some',
    })
    const roomOne = unit({ unit_id: 'c2', code: 'block-1', name: 'Block 1', parent_code: 'block' })
    const roomTwo = unit({ unit_id: 'c3', code: 'block-2', name: 'Block 2', parent_code: 'block' })
    const units = [combined, roomOne, roomTwo]
    const merged = party({
      unit_code: '',
      unit_codes: ['block-1', 'block-2'],
      unit_name: 'Block 1 + Block 2',
      is_merged_slot: true,
    })

    const slots = buildBoard([merged], units).areas.flatMap((area) =>
      area.slots.filter((slot) => slot.parties.length > 0)
    )
    expect(slots).toHaveLength(1)
    expect(resolvePartyUnit(merged, new Map(units.map((row) => [row.code, row])))).toBe(
      slots[0]?.unit
    )
  })

  it('rolls a room named on its own up to the combined card representing it', () => {
    // Not merge-only. A placement can name ONE room while an ancestor is
    // combined — the board draws the house, so the house is what grades the
    // family, and returning the room grades them against a card nobody is
    // looking at.
    const combined = unit({
      unit_id: 'c1',
      code: 'block',
      name: 'Block',
      is_container: true,
      is_combined: true,
      power_coverage: 'some',
    })
    const roomOne = unit({
      unit_id: 'c2',
      code: 'block-1',
      name: 'Block 1',
      parent_code: 'block',
      power_coverage: 'all',
    })
    const units = [combined, roomOne]
    const resolved = resolvePartyUnit(
      party({ unit_code: 'block-1' }),
      new Map(units.map((row) => [row.code, row]))
    )
    expect(resolved).toBe(combined)
  })

  it('takes the WORST grade when a placement spans several cards', () => {
    // Two freestanding cabins, no container above them, so the board draws
    // two cards and there is no server-side roll-up to read. A family whose
    // need fails in one of its rooms has a problem; surfacing the better room
    // hides it.
    const powered = unit({ unit_id: 'c1', code: 'cabin-1', name: 'Cabin 1', power_coverage: 'all' })
    const dark = unit({ unit_id: 'c2', code: 'cabin-2', name: 'Cabin 2', power_coverage: 'none' })
    const units = [powered, dark]
    const spanning = party({
      flags: { needs_power: true },
      unit_code: '',
      unit_codes: ['cabin-1', 'cabin-2'],
      unit_name: 'Cabin 1 + Cabin 2',
      is_merged_slot: true,
    })
    const resolved = resolvePartyUnit(spanning, new Map(units.map((row) => [row.code, row])))
    expect(resolved?.power_coverage).toBe('none')
    expect(partyAttention(spanning, resolved)).toEqual({ level: 'unmet', reason: 'No power' })
  })

  it('does not change its answer with the storage order of the units relation', () => {
    // The coin-flip this replaces: `members[0]` read the order the `units`
    // relation happened to be stored in, so swapping two ids flipped the
    // verdict. Reversing the codes must be invisible.
    const powered = unit({ unit_id: 'c1', code: 'cabin-1', name: 'Cabin 1', power_coverage: 'all' })
    const dark = unit({ unit_id: 'c2', code: 'cabin-2', name: 'Cabin 2', power_coverage: 'none' })
    const unitsByCode = new Map([powered, dark].map((row) => [row.code, row]))
    const forwards = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['cabin-1', 'cabin-2'], is_merged_slot: true }),
      unitsByCode
    )
    const backwards = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['cabin-2', 'cabin-1'], is_merged_slot: true }),
      unitsByCode
    )
    expect(forwards?.power_coverage).toBe(backwards?.power_coverage)
    expect(forwards?.power_coverage).toBe('none')
  })

  it('folds every resolved amenity, not only the two the roster grades', () => {
    // The row is handed to `FamilyCard` and `FamilyDetailsPanel`, which draw
    // all four need glyphs off it. Folding only `power_coverage` would leave
    // the fridge and step-free glyphs reading the first card again.
    const better = unit({
      unit_id: 'c1',
      code: 'cabin-1',
      name: 'Cabin 1',
      bathroom: 'private',
      power_coverage: 'all',
      fridge_coverage: 'all',
      ramp_coverage: 'all',
      ac_coverage: 'all',
    })
    const worse = unit({
      unit_id: 'c2',
      code: 'cabin-2',
      name: 'Cabin 2',
      bathroom: 'none',
      power_coverage: 'some',
      fridge_coverage: 'unknown',
      ramp_coverage: 'partial',
      ac_coverage: 'none',
    })
    const resolved = resolvePartyUnit(
      party({ unit_code: '', unit_codes: ['cabin-1', 'cabin-2'], is_merged_slot: true }),
      new Map([better, worse].map((row) => [row.code, row]))
    )
    expect(resolved?.bathroom).toBe('none')
    expect(resolved?.power_coverage).toBe('some')
    // `unknown` outranks `some`: nobody has measured the second cabin, and an
    // unmeasured room a family sleeps in is the louder mark on the glyph.
    expect(resolved?.fridge_coverage).toBe('unknown')
    expect(resolved?.ramp_coverage).toBe('partial')
    expect(resolved?.ac_coverage).toBe('none')
  })

  it('ranks the grades nothing < unmeasured < some rooms < qualified < all of it', () => {
    // The ladder, pinned rung by rung, because the two non-obvious ones are
    // exactly what a later reader would "simplify" away: `unknown` is WORSE
    // than `some` AND worse than `partial`, since an unmeasured room grades
    // `unmet` on the glyph while both of the others can grade `partial`.
    // Without these three assertions the ordering can be permuted freely and
    // every other test in this file still passes.
    const fold = (
      left: Partial<LodgingUnitRow>,
      right: Partial<LodgingUnitRow>
    ): LodgingUnitRow | undefined =>
      resolvePartyUnit(
        party({ unit_code: '', unit_codes: ['cabin-1', 'cabin-2'], is_merged_slot: true }),
        new Map([
          ['cabin-1', unit({ unit_id: 'c1', code: 'cabin-1', name: 'Cabin 1', ...left })],
          ['cabin-2', unit({ unit_id: 'c2', code: 'cabin-2', name: 'Cabin 2', ...right })],
        ])
      )

    expect(fold({ power_coverage: 'none' }, { power_coverage: 'unknown' })?.power_coverage).toBe(
      'none'
    )
    expect(fold({ power_coverage: 'unknown' }, { power_coverage: 'some' })?.power_coverage).toBe(
      'unknown'
    )
    expect(fold({ power_coverage: 'some' }, { power_coverage: 'all' })?.power_coverage).toBe('some')
    expect(fold({ ramp_coverage: 'unknown' }, { ramp_coverage: 'partial' })?.ramp_coverage).toBe(
      'unknown'
    )
    expect(fold({ ramp_coverage: 'partial' }, { ramp_coverage: 'all' })?.ramp_coverage).toBe(
      'partial'
    )
    expect(fold({ bathroom: 'shared' }, { bathroom: 'private' })?.bathroom).toBe('shared')
  })

  it('still grades against a named container the board draws no card for', () => {
    // A childless container: `drawnUnits` gives it no card and the board
    // routes the party to `offBoard`, which then calls this function to grade
    // its glyphs. The registry row is real evidence even when no card is
    // drawn, so it stands in for itself rather than reporting no evidence at
    // all — undefined would make every glyph read as MET.
    const empty = unit({
      unit_id: 'c1',
      code: 'block',
      name: 'Block',
      is_container: true,
      power_coverage: 'none',
    })
    const resolved = resolvePartyUnit(party({ unit_code: 'block' }), new Map([['block', empty]]))
    expect(resolved).toBe(empty)
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
