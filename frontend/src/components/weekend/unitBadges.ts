/**
 * How a unit's availability is badged, shared by the inventory list and the
 * board's slot cards so the two cannot drift.
 *
 * Reserved units are BADGED, not hidden (spec §3.7): staff reason about
 * adjacency, and hiding a held room would make the site look smaller than it
 * is. Container rows are labelled so nobody mistakes a whole-building
 * aggregate for a bookable room.
 *
 * THREE branches became two. 1500000135 replaced the `reserved_staff` /
 * `reserved_other` / `released_to_family` enum with an explicit
 * `family_available_override` boolean, because those values were REASONS and
 * not states -- the resolved question is binary, and each only meant anything
 * read against the unit's role, so `released_to_family` on a family_pool unit
 * was storable and meaningless. The reason survives on `reason` as free text
 * and deliberately does NOT reach the badge: "held for staff" and "held for a
 * burst pipe" are the same fact about availability.
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
  // Each override branch is read AGAINST the unit's role, and both compare to
  // an explicit `true`/`false` rather than testing truthiness: null (no row for
  // this weekend, so the role decides) and false (closed this weekend) are
  // different answers, and `!override` collapses them into one.
  //
  // A staff cabin opened to families for this weekend.
  if (unit.allocation_default === 'staff_default' && unit.family_available_override === true) {
    return {
      label: 'Released',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    }
  }
  // A family cabin closed for this weekend -- a burst pipe, a caretaker.
  if (unit.allocation_default !== 'staff_default' && unit.family_available_override === false) {
    return {
      label: 'Held',
      className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    }
  }
  if (unit.allocation_default === 'staff_default') return staff
  return null
}
