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
  AccessibilityFlags,
  HouseholdJourney,
  HouseholdJourneyRow,
  LodgingUnitRow,
  PartyChildRow,
  RequestTextBlockRow,
  RequestTextEntryRow,
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
  // Reads `birthdate`, never this field — `age` is CampMinder's yy.mm
  // snapshot and thresholding on it is forbidden (kindred#2480).
  is_under_two: false,
  grade: 4,
  // kindred#2393. WHICH WEEKENDS this child attended that year, earliest
  // first — the journey populates it and every other surface leaves it empty,
  // because the roster is already one weekend. `[]` is "not knowable", never
  // "attended nothing", and the members modal keeps such a child visible on
  // every weekend tab rather than hiding them from all of them.
  session_cm_ids: [1309514, 1309517],
}
void _exhaustivePartyChild

/**
 * kindred#2073's journey year. Every field is a distinct fact the card reads
 * and none can be recovered from another: `housing` and `cabin_name` disagree
 * on purpose in the two unplaced states.
 *
 * `enrollment` was here until kindred#2516 and is deliberately NOT replaced.
 * A year now reaches this payload only where the household was enrolled, so
 * the field could hold one value forever — and this fixture is `Required<>`
 * precisely so a field that leaves the wire fails the build rather than
 * lingering as a type nobody publishes.
 */
const _exhaustiveHouseholdJourneyRow: Required<HouseholdJourneyRow> = {
  year: 2025,
  housing: 'placed',
  // kindred#2332: the unit's name TODAY, whichever year the row is — the
  // server resolves the staff-written string through the alias layer and
  // renders the present-day registry name.
  cabin_name: 'Meadow House 1',
  // What staff typed that season. Provenance, not a name, and the two
  // DISAGREE here on purpose: that disagreement is 716 of 1,861 rows on the
  // snapshot, and it is the only case the card shows this field in.
  cabin_name_raw: 'Old Meadow 1',
  // kindred#2393. The weekends the household attended that year, earliest
  // first. Two of them here on purpose: that is the 64-of-5,438 case the
  // field exists for, and it is also why the row below refuses to pin the
  // cabin.
  sessions: [
    {
      session_cm_id: 1309514,
      name: 'Family Camp 1: Memorial Day Weekend',
      start_date: '2026-05-22',
    },
    { session_cm_id: 1309517, name: 'Family Camp 4: Labor Day Weekend', start_date: '2026-09-04' },
  ],
  // `null` because there are two weekends and CampMinder holds ONE cabin
  // string per household-year, so nothing can say which weekend it describes
  // — deliberately the same refusal `AttributeSession` makes in the Go sync.
  // A regen that turned this into a plain `number` would erase the state the
  // whole field exists to carry.
  housing_session_cm_id: null,
  adults: [],
  children: [],
}
void _exhaustiveHouseholdJourneyRow

const _exhaustiveHouseholdJourney: Required<HouseholdJourney> = {
  household_cm_id: 2000001,
  years: [],
}
void _exhaustiveHouseholdJourney

/**
 * Every flag on the accessibility summary. `RosterParty`'s own fixture below
 * writes a partial flags block (they are all optional on the wire), so it
 * proves nothing about the flag set — this is the guard that a regen adding
 * or dropping a flag stops the build here rather than silently changing what
 * the board, the roster filter chips and the details panel can see.
 *
 * `has_child_under_two` and `has_bed_exempt_child` are the two COMPUTED
 * flags (staff ruling, 2026-08-21): derived at roster build time from the
 * children's birthdates, because the form-declared sibling `has_infant` is
 * answered only on adult sessions and is 0 across every production
 * family-weekend row. The bed-exempt one reuses `_consumes_a_bed` itself and
 * feeds the baby mark's capacity note.
 */
const _exhaustiveAccessibilityFlags: Required<AccessibilityFlags> = {
  needs_private_bathroom: false,
  needs_power: false,
  needs_accommodation: false,
  needs_fridge: false,
  needs_step_free: false,
  accommodation_is_mandatory: false,
  has_infant: false,
  has_child_under_two: false,
  has_bed_exempt_child: false,
}
void _exhaustiveAccessibilityFlags

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
  // kindred#2075, resolved by kindred#2332: the DIRECTLY prior year's housing,
  // rendered as the unit's PRESENT-DAY registry name rather than the raw
  // string staff typed that season. '' is the common case and means UNKNOWN,
  // not "unassigned" — a regen that dropped this field would degrade every
  // returning family's card to silence with nothing else to notice. The raw
  // string is provenance and lives on `HouseholdJourneyRow.cabin_name_raw`,
  // one click away through this card.
  last_year_cabin: '',
  share: {
    preference: 'unknown',
    preference_raw: '',
    proximity: [],
    request_text: '',
    // kindred#2330. `RosterParty`'s own fixture writes an empty list, so it
    // proves nothing about the block shape — the two fixtures below are the
    // guard that a later regen dropping `source_field`, `authorship` or
    // `contributors` stops the build here rather than silently collapsing
    // the panel back to one unlabelled blob.
    request_blocks: [],
    eligibility: 'unknown',
    eligibility_source: 'none',
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

/**
 * One free-text source field's worth of a household's request (kindred#2330).
 *
 * `source_field` is the CampMinder field name VERBATIM — renaming it here
 * would be a data change, not a refactor, however the panel chooses to spell
 * it for staff (`DISPLAY_LABELS`). `authorship` paints nothing since the
 * 2026-08-17 review standardised every block on the amber rail, but it is what
 * `_may_read_staff_notes` uses to decide whether a staff-authored block is
 * sent to this client at all — a regen dropping it would reopen that hole.
 */
const _exhaustiveRequestTextBlock: Required<RequestTextBlockRow> = {
  source_field: 'COVID-19 Bunking Requests',
  authorship: 'family',
  entries: [],
}
void _exhaustiveRequestTextBlock

/**
 * `contributors` is a LIST because one parent's answer is routinely written
 * onto every enrolled child's record — 48 of 131 sibling groups in the 2026
 * snapshot are exact duplicates, and they collapse to one entry naming both.
 */
const _exhaustiveRequestTextEntry: Required<RequestTextEntryRow> = {
  text: 'Please house us near a bathhouse',
  contributors: ['Emma Johnson', 'Liam Johnson'],
}
void _exhaustiveRequestTextEntry

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
 *
 * It carries one again since kindred#2382 PR 4 — OPTIONAL this time, blank
 * meaning the live board. The distinction is the whole lesson of #1998:
 * required is what broke it, and `Required<>` here is what makes a field
 * appearing or vanishing a compile error rather than a silent shape change.
 */
const _exhaustiveAvailabilityWriteRequest: Required<AvailabilityWriteRequest> = {
  year: 2026,
  session_cm_id: 3000001,
  // Blank is the LIVE board — a scope in its own right, not a missing value.
  // A scenario id targets that scenario's own draft occupancy instead.
  scenario: '',
  unit_id: 'unit123456789012345',
  family_available: false,
  // kindred#2078: a hold IS a write-in, so the write that closes a cabin also
  // names WHO is in it. Required through the control, permissive at the schema
  // — the same split `reason` makes, for the same reason.
  occupant_name: 'Emma Johnson',
  reason: 'Kitchen lead, Fri–Sun',
  // kindred#2503. OPTIONAL, here and at the control alike — most write-ins
  // are non-rostered staff and `null` (the common case) takes the cabin
  // wholesale. The occupancy half only; a release carries no count.
  party_size: 2,
  // kindred#2583 step 4. `null` RENAMES NOBODY — the create path, addressed
  // by `occupant_name` as before. A string, `''` included, is the name the
  // edit form LOADED, and the server compare-and-swaps on it rather than
  // falling through to a create: under Design B the occupant's name IS the
  // row's address, so a rename is the one edit that cannot address itself.
  //
  // `string | null` and not a blank-defaulted string, because `''` is a real
  // address — the row whose occupant nobody named — and collapsing it into
  // "no rename" would leave exactly that row creating a second one.
  previous_occupant_name: null,
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
  // The AC twin of `power_coverage`, resolved over the same leaf walk.
  // DISPLAY ONLY -- air conditioning has no demand glyph, so this keeps the
  // amenity strip honest on a merged house rather than grading a need.
  ac_coverage: 'none',
  has_fridge: false,
  // NARROWS `has_fridge` and can never contradict it. Published beside its
  // parent (kindred#2224) because A SHARED FRIDGE IS A FRIDGE — the owner's
  // 2026-08-15 ruling — so it reads `fits` and never `partial`.
  has_shared_fridge: false,
  // The fridge twin of `power_coverage`, resolved over the same leaf walk. A
  // container's row describes the CONTAINER, so this is what a drop is judged
  // against; `has_fridge` above stays the registry's own fact about the row.
  fridge_coverage: 'none',
  // THREE-VALUE select plus blank, never a bool. `'no'` is a TRUTHY string, so
  // anything filtering this on truthiness renders the glyph on the four cabins
  // staff assessed as having no ramp. PROVENANCE ONLY since kindred#2327 —
  // nothing grades from it; it is the record of the 14 cabins staff walked.
  has_ramp: '',
  // The step-free twin of `power_coverage`, resolved over the same leaf walk
  // and speaking the SAME four grades as the other three since kindred#2327:
  // it grades from `is_accessible` below, a bool, so the fifth `partial` grade
  // went with the `has_ramp` reading.
  ramp_coverage: 'none',
  // The column step-free is graded FROM. `AMENITY_FLAGS` entry 6 on the admin
  // confirm form, so unlike `has_ramp` it was answered for all 118 units.
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
  // The unit's OWN write-in row's count, read the way `occupant_name` and
  // `reason` are. `null` is *occupies wholesale*, never "zero people" -- the
  // column's `min: 1` forbids zero.
  party_size: null,
  is_family_available: true,
  // The write-in COVERING this space, resolved through the unit tree by the
  // server — this unit's own row, else its nearest ancestor's, else its
  // nearest descendant's. Distinct from the three fields above, which stay
  // strictly this unit's own row: a room can be closed by a write-in it does
  // not hold, which is what a merge or a split does to one.
  write_ins: [],
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
  it('carries an OPTIONAL scenario, which targets the write without gating it', () => {
    // kindred#2382 PR 4. `false` is an OCCUPANCY and is scenario-scoped —
    // paper registrations for families arriving with no children are a
    // modelling choice belonging to the plan that made them — so the write has
    // to say which board it lands on. `true` is the staff↔family ROLE, which
    // is not scenario-scoped and ignores this field server-side.
    //
    // OPTIONAL is the half worth pinning. Required is the shape that made this
    // endpoint uncallable under #1998, and would now leave the live board — the
    // one staff actually evaluate — with no write path at all.
    const withScenario: AvailabilityWriteRequest = {
      ..._exhaustiveAvailabilityWriteRequest,
      scenario: 'scenario123456789012',
    }
    expect(withScenario.scenario).toBe('scenario123456789012')

    const live: AvailabilityWriteRequest = {
      year: 2026,
      session_cm_id: 3000001,
      unit_id: 'unit123456789012345',
      family_available: false,
    }
    expect(live.scenario).toBeUndefined()
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
