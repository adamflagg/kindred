/**
 * Which units an alias may name as members.
 *
 * An alias maps a verbatim CampMinder cabin string onto one or more units:
 * one member is an atomic room, two or more denote a merge. Two kinds of unit
 * break that:
 *
 *   - a CONTAINER is a building or a floor, never bookable, so a cabin string
 *     resolving onto one describes a placement that cannot exist;
 *   - an INACTIVE unit was deliberately retired (spec §3.8 deactivates rather
 *     than deletes), and a live alias pointing at it walks it back into the
 *     registry through the back door.
 *
 * Neither is validated anywhere downstream — no PocketBase rule, no Go hook —
 * so the pickers are the only guard.
 *
 * ALREADY-SELECTED MEMBERS ARE ALWAYS OFFERED, whatever their current state.
 * An alias written years ago may name a unit since retired or converted into a
 * container; hiding it would drop that member silently on the next save, which
 * is worse than showing staff a member they can then choose to remove.
 */
import type { LodgingUnitRecord } from '../../../types/lodging'

export function eligibleAliasMembers(
  units: LodgingUnitRecord[],
  selectedIds: readonly string[] = []
): LodgingUnitRecord[] {
  return units.filter(
    (unit) => (unit.is_active && !unit.is_container) || selectedIds.includes(unit.id)
  )
}
