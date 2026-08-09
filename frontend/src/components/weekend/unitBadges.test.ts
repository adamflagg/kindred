/**
 * The availability badge, which is the only place a staff member reads the
 * resolved answer to "can a family go in this cabin this weekend?".
 *
 * It used to switch on a three-value `reservation_state` enum. 1500000135
 * collapsed that to `family_available_override`, because the three values were
 * REASONS rather than states: the resolved question is binary, and each value
 * only meant anything read against the unit's role, so `released_to_family` on
 * a family_pool unit was storable and meaningless. The reason survives as free
 * text on `reason` and no longer drives the badge.
 *
 * The label vocabulary is unchanged on purpose -- "Staff", "Held", "Released"
 * are already the staff-facing wording and must not drift.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
import {
  availabilityAction,
  reservationBadge,
  shareabilityBadge,
  sharingConflictBadge,
} from './unitBadges'

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
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'single_party',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

describe('reservationBadge', () => {
  it('badges a building row so nobody reads an aggregate as a bookable room', () => {
    expect(reservationBadge(unit({ is_container: true }))).toEqual({
      label: 'Building',
      className: 'bg-muted text-muted-foreground',
    })
  })

  it('leaves an ordinary available family cabin unbadged', () => {
    expect(reservationBadge(unit())).toBeNull()
  })

  it('badges a family cabin held back for this weekend', () => {
    // A burst pipe, a caretaker in residence. The unit is still planning
    // inventory -- it is inventory that is unavailable, not inventory that is
    // missing -- which is why this is "Held" and not "Staff".
    const badge = reservationBadge(
      unit({ family_available_override: false, reason: 'Burst pipe', is_family_available: false })
    )

    expect(badge?.label).toBe('Held')
    expect(badge?.className).toBe(
      'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
    )
  })

  it('badges permanent staff housing as staff', () => {
    const badge = reservationBadge(
      unit({ inventory_class: 'staff_default', is_family_available: false })
    )

    expect(badge?.label).toBe('Staff')
    expect(badge?.className).toBe(
      'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
    )
  })

  it('badges a staff cabin opened to families for this weekend', () => {
    const badge = reservationBadge(
      unit({
        inventory_class: 'staff_default',
        family_available_override: true,
        is_family_available: true,
      })
    )

    expect(badge?.label).toBe('Released')
    expect(badge?.className).toBe(
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
    )
  })

  it('reads null and false as different answers on the override', () => {
    // The trap this pins: `!unit.family_available_override` is true for BOTH,
    // so a falsy test would badge every unbadged family cabin as "Held". None
    // means "no row, ask the role"; false means "closed this weekend".
    expect(reservationBadge(unit({ family_available_override: null }))).toBeNull()
    expect(
      reservationBadge(unit({ family_available_override: false, is_family_available: false }))
        ?.label
    ).toBe('Held')
  })

  it('does not badge a staff cabin as Released merely for lacking an override', () => {
    // The mirror of the case above, on the other branch: `staff_default` with
    // no row is ordinary staff housing, not a release.
    const badge = reservationBadge(
      unit({
        inventory_class: 'staff_default',
        family_available_override: null,
        is_family_available: false,
      })
    )

    expect(badge?.label).toBe('Staff')
  })

  it('does not badge an ordinary family cabin as Released', () => {
    // `family_available_override: true` on a family_pool unit is redundant but
    // perfectly storable -- it simply agrees with the role. "Released" means a
    // STAFF cabin opened to families for this weekend, so applying it here
    // would invent a distinction the property does not have and put a badge on
    // most of the board. BOTH branches read the override against the role;
    // this is the assertion that pins the Released half of that.
    expect(reservationBadge(unit({ family_available_override: true }))).toBeNull()
  })

  it('ignores the reason text entirely, because the rule never branches on it', () => {
    const held = reservationBadge(
      unit({ family_available_override: false, reason: 'Burst pipe', is_family_available: false })
    )
    const alsoHeld = reservationBadge(
      unit({ family_available_override: false, reason: '', is_family_available: false })
    )

    expect(held).toEqual(alsoHeld)
  })
})

describe('availabilityAction', () => {
  // The action lives beside the badge, in the same module, because the card
  // must not say two things about one cabin: a card badged "Held" offering to
  // "Hold" it is the drift this prevents.

  it('offers to hold an ordinary family cabin', () => {
    expect(availabilityAction(unit())).toEqual({
      kind: 'hold',
      label: 'Hold',
      familyAvailable: false,
      needsReason: true,
    })
  })

  it('offers to release permanent staff housing', () => {
    // Rare and explicit, not absent. One season of data corroborates that staff
    // cabins are never released; it does not prove it, so the capability stays.
    expect(
      availabilityAction(unit({ inventory_class: 'staff_default', is_family_available: false }))
    ).toEqual({ kind: 'release', label: 'Release', familyAvailable: true, needsReason: true })
  })

  it('offers to clear a held family cabin, and asks for no reason to do it', () => {
    // `null` DELETES the row. There is no value meaning "normal": writing one
    // would pin the unit against a later change to its role.
    expect(
      availabilityAction(
        unit({ family_available_override: false, reason: 'Burst pipe', is_family_available: false })
      )
    ).toEqual({ kind: 'clear', label: 'Clear', familyAvailable: null, needsReason: false })
  })

  it('offers to clear a released staff cabin', () => {
    expect(
      availabilityAction(
        unit({
          inventory_class: 'staff_default',
          family_available_override: true,
          is_family_available: true,
        })
      )?.kind
    ).toBe('clear')
  })

  it('offers to clear a row that merely agrees with the unit role', () => {
    // Redundant but storable, and reachable by a hand-edited row rather than
    // by this control. Clearing it is the only way to stop it pinning the unit
    // against a later registry edit, so the action must not be withheld just
    // because the resolved answer looks ordinary.
    expect(availabilityAction(unit({ family_available_override: true }))?.kind).toBe('clear')
    expect(
      availabilityAction(
        unit({
          inventory_class: 'staff_default',
          family_available_override: false,
          is_family_available: false,
        })
      )?.kind
    ).toBe('clear')
  })

  it('reads null and false as different answers, exactly as the badge does', () => {
    // The trap. `unit.family_available_override !== null` is the test; a
    // truthiness test (`if (unit.family_available_override)`) treats an
    // ordinary cabin's null and a held cabin's false alike, and whichever way
    // that branch falls, one of "Hold" or "Clear" becomes unreachable on most
    // of the board.
    expect(availabilityAction(unit({ family_available_override: null }))?.kind).toBe('hold')
    expect(
      availabilityAction(unit({ family_available_override: false, is_family_available: false }))
        ?.kind
    ).toBe('clear')
  })

  it('offers nothing to hold an OCCUPIED family cabin — held and occupied are mutually exclusive (#2090)', () => {
    expect(availabilityAction(unit(), true)).toBeNull()
  })

  it('still offers to hold an unoccupied family cabin (regression guard)', () => {
    expect(availabilityAction(unit(), false)?.kind).toBe('hold')
  })

  it('offers nothing on a building row', () => {
    // A container is a whole-building aggregate, not a bookable room. Holding
    // one would write an availability row against a unit no family can be
    // placed into, and the board draws no card for it anyway.
    expect(availabilityAction(unit({ is_container: true }))).toBeNull()
  })
})

describe('shareabilityBadge', () => {
  // kindred#2026. The unit half of "may two families sleep here", distinct
  // from the household half (`share_eligibility`) that the party cards carry.

  it('marks a unit a second party may be placed into', () => {
    expect(shareabilityBadge(unit({ shareability: 'shareable' }))?.label).toBe('Shared OK')
  })

  it('says nothing on a one-family room', () => {
    // 74 of 118 registry rows are single_party, so badging them would put a
    // chip on most of the board to state the default expectation. Silence
    // here is the SAFE direction: it advertises no permission.
    expect(shareabilityBadge(unit({ shareability: 'single_party' }))).toBeNull()
  })

  it('says so out loud when nobody has classified the unit', () => {
    // NOT silence, and this is the whole reason the column is a select rather
    // than a bool. After 1500000145's backfill no registry row is unknown, so
    // this chip only ever appears on a hand-created unit — where it is the one
    // prompt a staffer gets to answer the question before the board is worked.
    expect(shareabilityBadge(unit({ shareability: 'unknown' }))?.label).toBe('Sharing unset')
  })

  it('treats an absent field as unclassified rather than as permission', () => {
    // Pydantic defaults render optional in TypeScript, so a payload built by
    // an older server arrives with the key missing. Undefined must land on the
    // same non-permissive answer as an empty column, never on 'shareable'.
    const withoutField = unit()
    delete (withoutField as Partial<LodgingUnitRow>).shareability
    expect(shareabilityBadge(withoutField)?.label).toBe('Sharing unset')
  })
})

/**
 * kindred#2179 — the warning this issue exists for, and the one occupancy mark
 * on this board that is genuinely RARE.
 *
 * Its opposite number, the shared-space ring, was STRUCK on 2026-08-09 for
 * firing constantly: it lit the buildings designed to hold several families,
 * which is every dormitory- and village-style unit every weekend. This chip is
 * the inverse population — `single_party` is 74 of the 118 registry rows, and a
 * second party in one of them is an anomaly rather than the designed case.
 *
 * Counts OVERLAPPING parties, never the card's raw party count. The caller
 * passes `overlappingPartyKeys(...).size`, so two households in disjoint rooms
 * of one building never reach the > 1 branch — the same "disjoint means no
 * shared bedroom" reasoning that killed the ring.
 */
describe('sharingConflictBadge', () => {
  const AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'

  it('warns when a second party lands in a unit classified one-family', () => {
    expect(sharingConflictBadge(unit({ shareability: 'single_party' }), 2)).toEqual({
      label: 'One-family space',
      className: AMBER,
      title: 'Classified for one family — 2 families are sharing a room here',
    })
  })

  it('counts every party in the room, not just the second', () => {
    expect(sharingConflictBadge(unit({ shareability: 'single_party' }), 3)?.title).toBe(
      'Classified for one family — 3 families are sharing a room here'
    )
  })

  it('reuses the board amber rather than introducing a fourth alarm colour', () => {
    // The vocabulary ruled 2026-08-09 commits opacity to REFUSAL, the hatch to
    // advisory misfit and the forest tint to open-and-available. A warning
    // spends the board's existing amber — consent's tone — and nothing new.
    expect(sharingConflictBadge(unit({ shareability: 'single_party' }), 2)?.className).toBe(AMBER)
  })

  it('is silent on the one-family unit holding exactly one party', () => {
    expect(sharingConflictBadge(unit({ shareability: 'single_party' }), 1)).toBeNull()
  })

  it('is silent on an empty one-family unit', () => {
    expect(sharingConflictBadge(unit({ shareability: 'single_party' }), 0)).toBeNull()
  })

  it('is silent on a shareable unit holding two parties — that is the designed case', () => {
    // Under 1500000145's backfill predicate every family-pool CONTAINER is
    // shareable, which is why a whole-house let can never fire this warning.
    // That is the compare-at-the-assignment's-own-level ruling working, not a
    // gap in the check.
    expect(sharingConflictBadge(unit({ shareability: 'shareable' }), 2)).toBeNull()
  })

  it('is silent on an unclassified unit — there is no rule there to violate', () => {
    // Nagging on a unit nobody has classified teaches staff to dismiss the
    // chip, which is exactly what `docs/architecture/lodging-occupancy.md:112`
    // warns against.
    expect(sharingConflictBadge(unit({ shareability: 'unknown' }), 2)).toBeNull()
  })

  it('is silent when an older payload omits the field entirely', () => {
    const withoutField = unit()
    delete (withoutField as Partial<LodgingUnitRow>).shareability
    expect(sharingConflictBadge(withoutField, 2)).toBeNull()
  })
})
