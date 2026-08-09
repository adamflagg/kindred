/**
 * How a unit's availability is badged, shared by the board's slot cards and the
 * map's unit popover so the two cannot drift.
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
  if (unit.inventory_class === 'staff_default' && unit.family_available_override === true) {
    return {
      label: 'Released',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    }
  }
  // A family cabin closed for this weekend -- a burst pipe, a caretaker.
  if (unit.inventory_class !== 'staff_default' && unit.family_available_override === false) {
    return {
      label: 'Held',
      className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    }
  }
  if (unit.inventory_class === 'staff_default') return staff
  return null
}

/**
 * Whether a second family may go in this room — the UNIT half of the sharing
 * question (kindred#2026). The household half (`share_eligibility`) rides on
 * the party cards; both have to be true before two parties may occupy one
 * space.
 *
 * TWO OF THE THREE STATES BADGE, AND THE SILENT ONE IS THE SAFE ONE.
 *
 *   shareable    -> badged. It grants something, so it has to be legible.
 *   single_party -> silent. It is the default expectation and the majority of
 *                   the registry; a chip on most of the board to restate what
 *                   staff already assume is noise, and silence advertises no
 *                   permission, so nothing is risked by it.
 *   unknown      -> badged. NOT silent, and this is the point of a select over
 *                   a bool. After 1500000145's backfill no registry row is
 *                   unclassified, so this chip only ever appears on a
 *                   hand-created unit — where it is the one prompt a staffer
 *                   gets to answer the question before the board is worked.
 *
 * Undefined is treated as unknown rather than trusted: Pydantic fields with a
 * default render OPTIONAL in TypeScript, so a payload from an older server
 * arrives with the key missing, and the only wrong answer to give there is a
 * permissive one.
 */
export function shareabilityBadge(unit: LodgingUnitRow): UnitBadge | null {
  if (unit.shareability === 'shareable') {
    return {
      label: 'Shared OK',
      className: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
    }
  }
  if (unit.shareability === 'single_party') return null
  return {
    label: 'Sharing unset',
    className: 'border-border text-muted-foreground border',
  }
}

/** Which of the three reachable availability outcomes this unit can move to. */
export interface AvailabilityAction {
  kind: 'hold' | 'release' | 'clear'
  /** The button's label, drawn from the same vocabulary as the badge above. */
  label: string
  /** What the write sends. `null` DELETES the row. */
  familyAvailable: boolean | null
  /**
   * A cabin taken out of service with no stated reason is the row a staff
   * member cannot act on next week. Clearing needs none: it restores the
   * unit's standing role rather than asserting anything about this weekend.
   */
  needsReason: boolean
}

/**
 * The one action a unit's card offers, or null if it offers none.
 *
 * ONE action, not a menu, because `family_available` has exactly three
 * reachable outcomes and a unit is always in one of them: it either has an
 * override to clear, or it has none and can take the one that disagrees with
 * its role. Writing a value that AGREES with the role is deliberately not
 * offered — it would pin the unit against a later registry edit while changing
 * nothing staff can see.
 *
 * Lives beside `reservationBadge` so the two cannot drift. A card badged
 * "Held" that offers to "Hold" it says two things about one cabin.
 *
 * `occupied` names a fact from the SLOT (whether any party is placed on this
 * card this scenario), never folded into `canManage`'s permission gate.
 * Owner ruling on #2090: held and occupied are mutually exclusive states, so
 * a space that already holds a family may not also be marked held — but this
 * must not become a THIRD dimension threaded onto availability itself.
 * `family_available_override` stays exactly what 1500000135 made it: global,
 * scenario-less, and reachable only through `clear` for a space that somehow
 * already carries both facts.
 */
export function availabilityAction(
  unit: LodgingUnitRow,
  occupied = false
): AvailabilityAction | null {
  // A container is a whole-building aggregate, never a bookable room.
  if (unit.is_container === true) return null
  // `!== null` and not truthiness: null (no row for this weekend) and false
  // (closed this weekend) are different answers, and collapsing them makes
  // either "Hold" or "Clear" unreachable across most of the board.
  if (unit.family_available_override !== null && unit.family_available_override !== undefined) {
    return { kind: 'clear', label: 'Clear', familyAvailable: null, needsReason: false }
  }
  // NO SURFACE REACHES THIS BRANCH TODAY, and that is deliberate rather than
  // an oversight. Releasing a staff cabin to families is a registry edit on the
  // season's row now (Manage -> Lodging), not a per-weekend override: the
  // weekend Inventory tab that used to host it was removed with year-scoping,
  // and the board cannot host it because `isPlanningInventory` (boardLayout.ts)
  // excludes a `staff_default` unit with no override — which is precisely the
  // state this branch describes. Kept, unused, because the write path behind it
  // still exists; see the design spec's §7.3 "stays, unused and noted".
  if (unit.inventory_class === 'staff_default') {
    return { kind: 'release', label: 'Release', familyAvailable: true, needsReason: true }
  }
  // An already-occupied space offers no "Hold": the fix for #2090. Only
  // reachable here, past both branches above, so an already-held unit keeps
  // its `clear` action regardless of occupancy — clearing only ever REDUCES
  // the conflict, so it is never the state that needs blocking.
  if (occupied) return null
  return { kind: 'hold', label: 'Hold', familyAvailable: false, needsReason: true }
}
