/**
 * Type-level tests verifying that the generated API types (from
 * @hey-api/openapi-ts) for the lodging domain match the shapes this repo
 * expects.
 *
 * Same mechanism as api-types.test.ts, scoped to the two schemas kindred#1931
 * changed when it collapsed `unit` / `merge` / `merge_draft` into one
 * multi-valued `units` relation:
 *
 *   - RosterParty: `unit_codes` ADDED (every leaf unit code on a placement).
 *   - PlacementWriteRequest: `unit_id` / `merge_id` / `merge_draft_id`
 *     REMOVED, `unit_ids` ADDED.
 *
 * See api-types.test.ts for the full rationale: a `Required<T>` literal
 * enumerating every field is a compile-time drift guard in BOTH directions --
 * a Python schema addition is "missing property", a removal is "excess
 * property" -- and it catches what the lefthook `api-types-freshness` hook
 * (a runtime regen-and-diff) cannot: this repo committing a regenerated
 * types.gen.ts that consumers never actually update their read/write sites
 * for.
 *
 * PlacementWriteRequest has no frontend consumer yet -- the board is
 * read-only until a later task wires up drag-and-drop writes -- so it is
 * imported straight from `api-generated` rather than through a lodging.ts
 * alias that would exist for no reason but this test.
 */
import { describe, expect, it } from 'vitest'
import type {
  AvailabilityWriteRequest,
  PlacementWriteRequest,
  SlotMergeRequest,
} from './api-generated'
import type {
  HouseholdJourney,
  HouseholdJourneyRow,
  LodgingUnitRow,
  PartyChildRow,
  RosterPartyRow,
} from './lodging'

/**
 * kindred#2180 added `last_name` to `PartyChild`, and the board's family
 * naming reads it. `RosterParty`'s own fixture writes `children: []`, so it
 * proves nothing about the child shape — this is the guard that a later
 * regen dropping the field, or renaming it, stops the build here rather than
 * silently degrading every card to full names.
 */
const _exhaustivePartyChild: Required<PartyChildRow> = {
  person_cm_id: 1000001,
  display_name: 'Ava Martinez Garcia',
  // The STRUCTURED surname, not the trailing token of `display_name` — for
  // 4.7% of 2026's rostered children those two disagree, and this fixture
  // value is one of them.
  last_name: 'Martinez Garcia',
  age: 9,
  grade: 4,
}
void _exhaustivePartyChild

/**
 * kindred#2073's journey year. Every field is a distinct fact the card reads
 * and none can be recovered from another: `housing` and `cabin_name` disagree
 * on purpose in the two unplaced states, and `enrollment` is what stops an
 * empty `children` rendering as a childless family.
 */
const _exhaustiveHouseholdJourneyRow: Required<HouseholdJourneyRow> = {
  year: 2025,
  housing: 'placed',
  cabin_name: 'Cedar Lodge - Room 2',
  enrollment: 'enrolled',
  adults: [],
  children: [],
}
void _exhaustiveHouseholdJourneyRow

const _exhaustiveHouseholdJourney: Required<HouseholdJourney> = {
  household_cm_id: 2000001,
  years: [],
}
void _exhaustiveHouseholdJourney

const _exhaustiveRosterParty: Required<RosterPartyRow> = {
  grain: 'household',
  household_cm_id: 2000001,
  person_cm_id: 0,
  display_name: 'Emma Johnson Household',
  sort_name: 'Johnson',
  adults: [],
  children: [],
  party_size: 3,
  unit_code: 'ridge-1',
  unit_name: 'Ridge 1',
  is_merged_slot: false,
  unit_codes: ['ridge-1'],
  effective_bathroom: 'unknown',
  arrival_eta: '',
  is_returning: false,
  // kindred#2075: the DIRECTLY prior year's staff-written cabin string, free
  // text out of `family_camp_registrations.cabin_assignment`. '' is the
  // common case and means UNKNOWN, not "unassigned" — a regen that dropped
  // this field would degrade every returning family's card to silence with
  // nothing else to notice.
  last_year_cabin: '',
  share: {
    preference: 'unknown',
    preference_raw: '',
    proximity: [],
    request_text: '',
    needs_resolution: false,
    eligibility: 'unknown',
    eligibility_source: 'none',
    answers_conflict: false,
  },
  flags: {
    needs_private_bathroom: false,
    needs_power: false,
    needs_accommodation: false,
    accommodation_is_mandatory: false,
    has_infant: false,
  },
}
void _exhaustiveRosterParty

const _exhaustivePlacementWriteRequest: Required<PlacementWriteRequest> = {
  year: 2026,
  session_cm_id: 3000001,
  scenario: 'scenario123456789012',
  household_cm_id: 2000001,
  person_cm_id: 0,
  unit_ids: ['ridge-1'],
}
void _exhaustivePlacementWriteRequest

/**
 * kindred#1998. This write shape had NO exhaustive fixture, which is how it
 * drifted into requiring a `scenario` nobody could supply: it extended
 * `ScenarioWriteRequest`, where `scenario` is `min_length=1`, so
 * `PUT /api/lodging/availability` was uncallable and the table still holds
 * zero rows. A fixture here would have made that a compile error the moment
 * the base class was picked.
 */
const _exhaustiveAvailabilityWriteRequest: Required<AvailabilityWriteRequest> = {
  year: 2026,
  session_cm_id: 3000001,
  unit_id: 'unit123456789012345',
  family_available: false,
  // kindred#2078: a hold IS a write-in, so the write that closes a cabin also
  // names WHO is in it. Required through the control, permissive at the schema
  // — the same split `reason` makes, for the same reason.
  occupant_name: 'Emma Johnson',
  reason: 'Kitchen lead, Fri–Sun',
}
void _exhaustiveAvailabilityWriteRequest

/**
 * The scenario-scoped twin of AvailabilityWriteRequest, and deliberately NOT
 * an AvailabilityWriteRequest-shaped `null`-to-clear branch: the board only
 * ever writes an explicit `true` or `false` here, and an absent row means
 * "inherit the registry default". No frontend consumer yet -- the drag/drop
 * write lands in a later task -- so this is imported straight from
 * `api-generated`, same as `_exhaustivePlacementWriteRequest` above.
 */
const _exhaustiveSlotMergeRequest: Required<SlotMergeRequest> = {
  year: 2026,
  session_cm_id: 3000001,
  scenario: 'scenario123456789012',
  unit_id: 'unit123456789012345',
  combined: true,
}
void _exhaustiveSlotMergeRequest

/**
 * The read shape the board, the map and the inventory panel all share.
 * `family_available_override` replaced `reservation_state` in the same change;
 * a fixture that enumerates both would have failed to compile in exactly one
 * direction for each half of that swap.
 */
const _exhaustiveLodgingUnit: Required<LodgingUnitRow> = {
  unit_id: 'unit123456789012345',
  code: 'ridge-1',
  name: 'Ridge 1',
  area_code: 'RIDGE',
  area_name: 'Ridge Side',
  // kindred#2076: the Manage screen's area rank, read off
  // `lodging_areas.sort_order`. The board sorts its areas by this instead of
  // the area name.
  area_sort_order: 3,
  sleeps: 5,
  bathroom: 'shared',
  bathroom_group: '',
  near_bathhouse: false,
  has_power: false,
  // ADDITIVE to `has_power`, never a replacement (kindred#1912): the raw flag
  // is the registry's own fact about the ROW, and this is the same question
  // resolved over the rooms the slot actually contains. Twelve of the
  // fourteen 2026 family-pool containers disagree with themselves on it.
  power_coverage: 'none',
  has_ac: false,
  has_fridge: false,
  is_accessible: false,
  is_confirmed: true,
  is_active: true,
  is_container: false,
  parent_code: '',
  is_combined: false,
  inventory_class: 'family_pool',
  shareability: 'single_party',
  family_available_override: null,
  occupant_name: '',
  reason: '',
  is_family_available: true,
  // The write-in COVERING this space, resolved through the unit tree by the
  // server — this unit's own row, else its nearest ancestor's, else its
  // nearest descendant's. Distinct from the three fields above, which stay
  // strictly this unit's own row: a room can be closed by a write-in it does
  // not hold, which is what a merge or a split does to one.
  write_in: null,
  map_x: 0.5,
  map_y: 0.5,
}
void _exhaustiveLodgingUnit

describe('RosterParty (generated)', () => {
  it('names every leaf unit code on unit_codes, additive to unit_code/unit_name', () => {
    const merged: RosterPartyRow = {
      ..._exhaustiveRosterParty,
      unit_code: '',
      unit_name: 'Ridge 1 + Ridge 2',
      is_merged_slot: true,
      unit_codes: ['ridge-1', 'ridge-2'],
    }
    expect(merged.unit_codes).toHaveLength(2)
    expect(merged.unit_code).toBe('')
  })
})

describe('AvailabilityWriteRequest (generated)', () => {
  it('carries no scenario, because availability does not vary by plan', () => {
    // 1500000135. A burst pipe closes a cabin in every scenario for that
    // weekend, so there was never anything for a scenario to disagree about.
    // The excess-property check is the assertion: this fails to compile if the
    // field comes back.
    const withScenario: AvailabilityWriteRequest = {
      ..._exhaustiveAvailabilityWriteRequest,
      // @ts-expect-error availability is weekend-scoped; a scenario is not part of it.
      scenario: 'scenario123456789012',
    }
    void withScenario
    expect('scenario' in _exhaustiveAvailabilityWriteRequest).toBe(false)
  })

  it('spells "clear the override" as null rather than a third value', () => {
    // Absence of a row is how "whatever this unit's role says" is written.
    // There is no value meaning "normal", and writing one would pin the unit
    // against a later change to its role.
    const cleared: AvailabilityWriteRequest = {
      year: 2026,
      session_cm_id: 3000001,
      unit_id: 'unit123456789012345',
      family_available: null,
    }
    expect(cleared.family_available).toBeNull()
  })
})

describe('LodgingUnitSummary (generated)', () => {
  it('reports the override as a tri-state, so null and false stay distinct', () => {
    const held: LodgingUnitRow = { ..._exhaustiveLodgingUnit, family_available_override: false }

    expect(_exhaustiveLodgingUnit.family_available_override).toBeNull()
    expect(held.family_available_override).toBe(false)
  })
})

describe('PlacementWriteRequest (generated)', () => {
  it('has a multi-valued unit_ids target, not the old single-id fields', () => {
    expect(Array.isArray(_exhaustivePlacementWriteRequest.unit_ids)).toBe(true)
  })

  it('requires unit_ids — the tombstone shape is gone', () => {
    // kindred#1974: an empty `unit_ids` used to be the TOMBSTONE, a row
    // meaning "unplaced in this scenario" that suppressed the CampMinder
    // mirror underneath. A scenario now REPLACES the mirror, so there is
    // nothing to suppress and the API answers 422; unplacing a party is
    // `DELETE /api/lodging/placements`.
    //
    // TypeScript cannot express a non-empty array, so the runtime rule is the
    // API's. What this pins is the half TypeScript CAN carry: `unit_ids` is a
    // required property, so a caller that forgets it does not compile. The
    // `Required<>` fixture above would stop compiling if it went optional
    // again -- excess-property in one direction, missing in the other.
    const placement: PlacementWriteRequest = { ..._exhaustivePlacementWriteRequest }
    expect(placement.unit_ids).toEqual(['ridge-1'])
    // @ts-expect-error unit_ids is required: a placement names at least one unit.
    const withoutUnits: PlacementWriteRequest = {
      year: 2026,
      session_cm_id: 3000001,
      scenario: 'scenario123456789012',
      household_cm_id: 2000001,
    }
    expect(withoutUnits.scenario).toBe('scenario123456789012')
  })
})
