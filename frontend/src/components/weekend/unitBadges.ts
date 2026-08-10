/**
 * How a unit's availability is badged, shared by the board's slot cards and the
 * map's unit popover so the two cannot drift.
 *
 * Reserved units are BADGED, not hidden (spec §3.7): staff reason about
 * adjacency, and hiding a written-into room would make the site look smaller
 * than it is. Container rows are labelled so nobody mistakes a whole-building
 * aggregate for a bookable room.
 *
 * "Held" BECAME "Write-in" (kindred#2078), and it is the only label here that
 * has ever moved. Staff never used the control to reserve an empty room — they
 * used it to record an occupant the system does not know about — so the old
 * word described the opposite of what the row means. The tone did not move
 * with it; see the branch itself.
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
  /**
   * OPTIONAL long form, rendered as the chip's tooltip (`ui/Tooltip` since
   * kindred#2177, a bare `title` attribute before it). Only the warning chip
   * below carries one: the availability badges are single words whose whole
   * meaning is the word, where a warning has a COUNT to state and colour alone
   * is never a signal (WCAG 1.4.1). A badge without one renders as plain text
   * rather than as a focusable trigger that reveals nothing.
   */
  title?: string
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
  // A family cabin somebody has been WRITTEN INTO for this weekend.
  //
  // "Held" until kindred#2078. Staff never used the control to reserve an
  // empty room -- they used it to record an occupant the system does not know
  // about, most often non-rostered weekend staff -- and "Held" set the
  // opposite expectation: a room kept empty, when in truth it is full.
  //
  // ONLY THE WORD CHANGES. The slate tone stays, because the underlying fact
  // (this cabin is not available to a family this weekend) is the one the
  // board already had a colour for, and inventing a second colour for a
  // renamed concept is how a palette stops meaning anything.
  //
  // It still does not read `occupant_name`: "written in for a caretaker" and
  // "written in for a burst pipe" are the same fact about availability, which
  // is the same reason the reason text never reached this badge.
  if (unit.inventory_class !== 'staff_default' && unit.family_available_override === false) {
    return {
      label: 'Write-in',
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

/**
 * A second party in a space classified for one — kindred#2179's warning, and
 * the counterpart `shareabilityBadge` above deliberately does not render.
 *
 * A NEW element rather than a variant of that badge, because `single_party` is
 * SILENT there on purpose: it is 74 of the 118 registry rows, so a chip
 * restating it would sit on most of the board. There is no chip there to turn
 * red. This one appears only in the anomaly.
 *
 * ⚠️ IT IS THE RARE ONE, AND THAT IS THE WHOLE POINT. Its opposite number — the
 * shared-space ring, which lit any card holding two families — was STRUCK on
 * 2026-08-09 (see `ringPrecedence.ts`) for firing on the units DESIGNED to hold
 * several families, every weekend, by construction. A mark that is always on is
 * chrome staff learn to read past, which is the failure
 * `docs/architecture/lodging-occupancy.md:112` names. Anything that would make
 * this chip common again is the same mistake wearing a different shape.
 *
 * WARN, DO NOT BLOCK. The placement has already happened and the drop stays
 * accepted: no `opacity-40` (the board's reserved REFUSAL signal), no hatch
 * (advisory needs misfit, #1912), no forest tint (open and available, #2093).
 * A chip in the badge row is a fourth channel and takes none of those three.
 *
 * `overlappingParties` is a count of parties that actually share a ROOM
 * (`overlappingPartyKeys`), never the card's raw party count. Two households in
 * disjoint rooms of one building is a legitimate share — the owner ruling of
 * 2026-08-07 — and the same "disjoint means no shared bedroom" reasoning that
 * struck the ring applies here. Compare at the level the assignment was made:
 * a container-level placement is judged against the CONTAINER's own
 * `shareability`, and since 1500000145's backfill makes every family-pool
 * container `shareable`, a whole-house let cannot fire this. That is the ruling
 * working, not a gap.
 *
 * Silent on an unclassified unit for the reason the doc gives: a unit nobody
 * has classified has no rule to violate, and nagging there teaches dismissal.
 * This reads the STORED value and re-states the classification rule nowhere —
 * `shareabilityDrift.ts` already records that the rule has three expressions
 * (the migration header, `registry.go`'s `classifyShareability`, and itself)
 * and that a fourth would make that worse.
 */
export function sharingConflictBadge(
  unit: LodgingUnitRow,
  overlappingParties: number
): UnitBadge | null {
  if (unit.shareability !== 'single_party') return null
  if (overlappingParties < 2) return null
  return {
    label: 'One-family space',
    // The board's existing amber — consent's tone, and the precedent this
    // issue names for "a human should look at this". Not a fourth alarm
    // colour: the palette is committed (forest to area identity and open
    // space, amber to a share worth a look, red to over-capacity).
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    /*
     * "SHARING a room", not "placed here", because the count is an OVERLAP and
     * the card already carries a placement count of its own. On a leaf the two
     * agree; on a card that is a whole building they need not — three families
     * under it, two of them in the same room, gives 2 here beside a chip
     * reading "3 families". Reporting the overlap as an occupancy would make
     * the card contradict itself, and the number has to be the one that
     * TRIGGERED the warning or the warning cannot be checked against the card.
     */
    title: `Classified for one family — ${String(overlappingParties)} families are sharing a room here`,
  }
}

/** Which of the three reachable availability outcomes this unit can move to. */
export interface AvailabilityAction {
  kind: 'hold' | 'release' | 'clear'
  /** The button's label, drawn from the same vocabulary as the badge above. */
  label: string
  /** What the write sends. `null` DELETES the row. */
  familyAvailable: boolean | null
  /** What the control collects before it may write — see `AvailabilityPrompt`. */
  prompt: AvailabilityPrompt
}

/**
 * What the control must collect before it may write.
 *
 * RESHAPED from a `needsReason: boolean` by kindred#2078 rather than added
 * beside it, because that flag was never really about a reason — it was about
 * whether the action has anything to ask. What it asks FOR now differs by
 * action, and a boolean cannot say which:
 *
 *   'occupant' — a write-in. A REQUIRED occupant name plus an OPTIONAL note.
 *                ONE control and one action: hold IS the write-in (owner
 *                ruling, 2026-08-09), so there is no second "mark unavailable"
 *                path and no burst-pipe / staff-write-in split.
 *   'reason'   — a release. A required reason and nothing else: opening a
 *                staff cabin to families names no occupant, so prompting for
 *                one would ask for a fact that does not exist.
 *   'none'     — a clear. It restores the unit's standing role rather than
 *                asserting anything about this weekend, so there is nothing
 *                to say.
 */
export type AvailabilityPrompt = 'occupant' | 'reason' | 'none'

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
 * "Write-in" that offers to "Write in" says two things about one cabin.
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
  // either "Write in" or "Clear" unreachable across most of the board.
  if (unit.family_available_override !== null && unit.family_available_override !== undefined) {
    return { kind: 'clear', label: 'Clear', familyAvailable: null, prompt: 'none' }
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
    return { kind: 'release', label: 'Release', familyAvailable: true, prompt: 'reason' }
  }
  // An already-occupied space offers no write-in: the fix for #2090. Only
  // reachable here, past both branches above, so an already-held unit keeps
  // its `clear` action regardless of occupancy — clearing only ever REDUCES
  // the conflict, so it is never the state that needs blocking.
  if (occupied) return null
  return { kind: 'hold', label: 'Write in', familyAvailable: false, prompt: 'occupant' }
}
