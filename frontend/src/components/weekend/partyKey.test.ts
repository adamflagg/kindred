/**
 * The shared party key. Fictional data throughout.
 *
 * These pin the whole key chain, and three of them pin the `||`-not-`??`
 * choice — a choice that is invisible on a family weekend, where a household
 * party has a real `household_cm_id` and both operators agree.
 *
 * The three where they DIVERGE are the ones to keep if this file is ever
 * trimmed: `household_cm_id = 0` with a real `person_cm_id`, two persons keyed
 * apart, and both ids 0 falling through to `display_name`. The other two agree
 * under either operator — a real id is neither falsy nor nullish, and an
 * omitted id is BOTH — so they cover the chain, not the operator.
 */
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { partyKey } from './partyKey'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'The Johnson Family',
    sort_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 2,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

describe('partyKey', () => {
  it('keys a household on its household id', () => {
    expect(partyKey(party())).toBe('household-101')
  })

  it('keys a person on its person id, past the zero the other grain leaves behind', () => {
    // The adult-weekend shape as the API actually sends it: `household_cm_id`
    // present and 0, because Pydantic serialises the default. `??` stops here
    // and yields "person-0" for every individual on the weekend.
    expect(
      partyKey(
        party({
          grain: 'person',
          household_cm_id: 0,
          person_cm_id: 9101,
          display_name: 'Riley Sam',
        })
      )
    ).toBe('person-9101')
  })

  it('gives two individuals on one adult weekend distinct keys', () => {
    const riley = party({ grain: 'person', household_cm_id: 0, person_cm_id: 9101 })
    const samuel = party({ grain: 'person', household_cm_id: 0, person_cm_id: 9102 })
    expect(partyKey(riley)).not.toBe(partyKey(samuel))
  })

  it('falls through to the display name when a household failed to resolve', () => {
    // The roster service emits `household_cm_id = 0` for these, so they
    // collide with each other exactly as the person grain does.
    expect(
      partyKey(party({ household_cm_id: 0, person_cm_id: 0, display_name: 'The Garcia Family' }))
    ).toBe('household-The Garcia Family')
  })

  it('falls through to the display name when the payload omits both ids', () => {
    // Both are optional on the generated type, so an omission is reachable
    // through the schema even though the API contract says otherwise.
    const base = party({ display_name: 'The Chen Family' })
    delete base.household_cm_id
    delete base.person_cm_id
    expect(partyKey(base)).toBe('household-The Chen Family')
  })
})
