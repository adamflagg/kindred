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
import type { PlacementWriteRequest } from './api-generated'
import type { RosterPartyRow } from './lodging'

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
  arrival_eta: '',
  is_returning: false,
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
