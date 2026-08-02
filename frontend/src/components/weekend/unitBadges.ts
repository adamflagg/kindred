/**
 * How a unit's availability is badged, shared by the inventory list and the
 * board's slot cards so the two cannot drift.
 *
 * Reserved units are BADGED, not hidden (spec §3.7): staff reason about
 * adjacency, and hiding a held room would make the site look smaller than it
 * is. Container rows are labelled so nobody mistakes a whole-building
 * aggregate for a bookable room.
 */
import type { LodgingUnitRow } from '../../types/lodging'

export interface UnitBadge {
  label: string
  className: string
}

export function reservationBadge(unit: LodgingUnitRow): UnitBadge | null {
  const staff = {
    label: 'Staff',
    className: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  }
  if (unit.is_container === true) {
    return { label: 'Building', className: 'bg-muted text-muted-foreground' }
  }
  if (unit.reservation_state === 'reserved_staff') return staff
  if (unit.reservation_state === 'reserved_other') {
    return {
      label: 'Held',
      className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    }
  }
  if (unit.reservation_state === 'released_to_family') {
    return {
      label: 'Released',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    }
  }
  if (unit.allocation_default === 'staff_default') return staff
  return null
}
