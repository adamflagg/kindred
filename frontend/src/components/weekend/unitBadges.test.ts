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
import { reservationBadge } from './unitBadges'

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
    allocation_default: 'family_pool',
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
    const badge = reservationBadge(unit({ family_available_override: false, reason: 'Burst pipe' }))

    expect(badge?.label).toBe('Held')
    expect(badge?.className).toBe(
      'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
    )
  })

  it('badges permanent staff housing as staff', () => {
    const badge = reservationBadge(
      unit({ allocation_default: 'staff_default', is_family_available: false })
    )

    expect(badge?.label).toBe('Staff')
    expect(badge?.className).toBe(
      'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
    )
  })

  it('badges a staff cabin opened to families for this weekend', () => {
    const badge = reservationBadge(
      unit({
        allocation_default: 'staff_default',
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
    expect(reservationBadge(unit({ family_available_override: false }))?.label).toBe('Held')
  })

  it('does not badge a staff cabin as Released merely for lacking an override', () => {
    // The mirror of the case above, on the other branch: `staff_default` with
    // no row is ordinary staff housing, not a release.
    const badge = reservationBadge(
      unit({
        allocation_default: 'staff_default',
        family_available_override: null,
        is_family_available: false,
      })
    )

    expect(badge?.label).toBe('Staff')
  })

  it('ignores the reason text entirely, because the rule never branches on it', () => {
    const held = reservationBadge(unit({ family_available_override: false, reason: 'Burst pipe' }))
    const alsoHeld = reservationBadge(unit({ family_available_override: false, reason: '' }))

    expect(held).toEqual(alsoHeld)
  })
})
