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
 *
 * TWO FIELDS FEED THOSE TWO BRANCHES, and they are not the same field.
 * kindred#2382 found that the surviving boolean was still answering two
 * unrelated questions and split them:
 *
 * | branch | fact | field | stored in | scope |
 * |---|---|---|---|---|
 * | "Released" | staff<->family ROLE | `family_available_override` | `lodging_availability` | the WEEKEND |
 * | "Write-in" | OCCUPANCY | `write_ins` (via `hasWriteIn`) | `lodging_write_ins`/`_draft` | the SCENARIO |
 *
 * So a `family_available_override === false` is a role decision that names
 * NOBODY, and does not badge here. It used to badge "Write-in", because the
 * wire spelled an occupancy that way as a compat shim while the split landed;
 * it no longer does, and 1500000162 left no such row behind for it to be
 * wrong about.
 */
import type { LodgingUnitRow } from '../../types/lodging'
import { hasWriteIn } from './writeIn'

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

/**
 * Whether `reservationBadge` badges this unit "Write-in" — exported so a
 * caller that shows the same fact another way can suppress the chip WITHOUT
 * re-deriving the branch's own gate and risking drift from it (kindred#2252).
 *
 * `LodgingUnitCard` is that caller: the occupant already gets a `WriteInCard`
 * in the unit's well, so the chip beside it repeated the same fact under a
 * second name. The two other surfaces that draw this chip — `MapUnitPopover`'s
 * header and its collapsed grid cell — carry no such card and still call
 * `reservationBadge` directly, unaffected by this function existing.
 */
export function writeInBadgeApplies(unit: LodgingUnitRow): boolean {
  return unit.inventory_class !== 'staff_default' && hasWriteIn(unit)
}

export function reservationBadge(unit: LodgingUnitRow): UnitBadge | null {
  const staff = {
    label: 'Staff',
    className: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  }
  const building = { label: 'Building', className: 'bg-muted text-muted-foreground' }
  // A SPLIT container is pure grouping: `drawnUnits` descends past it, so
  // nothing draws this badge for one and there is no action for it to agree
  // with. It answers "Building" and stops.
  //
  // A COMBINED one does not stop here, and that is the fix. Merge-by-drag
  // (#2012) made it the one card the board draws in place of its rooms and a
  // legitimate drop target (`dragPlacement`), so it reads its availability
  // like any other drawn unit. It still lands on "Building" below when it has
  // nothing more specific to say -- being a whole building does not stop being
  // true -- but a write-in on it now BADGES as one, because
  // `availabilityAction` now offers to clear it and a card that says
  // "Building" while offering "Clear" says two things about one cabin.
  if (unit.is_container === true && unit.is_combined !== true) return building
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
  // Read through `writeInBadgeApplies` (`hasWriteIn`, never the raw
  // `family_available_override`). The board draws whichever level the tree
  // resolves to, so the card carrying a write-in is often not the unit whose
  // row it is: split a written-into building and its ROOMS carry it; merge
  // over a written-into room and the BUILDING does. The column answers only
  // for the unit it sits on, which is how a write-in went silent the moment
  // somebody merged or split around it.
  if (writeInBadgeApplies(unit)) {
    return {
      label: 'Write-in',
      className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    }
  }
  // AFTER both override branches and BEFORE `staff`, so the only behaviour a
  // combined container gains is the two overrides. A combined staff building
  // with no override reads "Building" exactly as it did.
  if (unit.is_container === true) return building
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
 * AUDITED against kindred#2339 — a two-unit `lodging_unit_aliases` row writes
 * its whole member set onto every household that resolves through it, so two
 * DIFFERENT households independently resolving through the same alias can
 * each claim the identical two-code set without ever having agreed to share
 * either room. `overlappingPartyKeys` guards exactly that: it will not read
 * such a pair as sharing a room with EACH OTHER while the number of
 * households claiming that set is no bigger than the set itself (H <= N).
 * This badge takes `overlappingParties` as given and needs no guard of its
 * own — it only ever sees the count after that ambiguity has already been
 * resolved upstream.
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
  kind: 'release' | 'clear'
  /** The button's label, drawn from the same vocabulary as the badge above. */
  label: string
  /** What the write sends. `null` DELETES the row. */
  familyAvailable: boolean | null
  /** What the control collects before it may write — see `AvailabilityPrompt`. */
  prompt: AvailabilityPrompt
  /**
   * The unit the write NAMES — always the card's own, since kindred#2381.
   *
   * It was not always, and the exception was the write-in clear: a write-in
   * covers a space and the board draws whichever level the tree resolves to,
   * so a room can inherit its building's row and a merged building one of its
   * rooms', and the clear had to target the unit that HOLDS the row. That
   * action is gone — a card may now cover several write-ins and each is
   * removed by the X on its own `WriteInCard` — so every action this returns
   * is about the card's own availability row again.
   *
   * KEPT rather than collapsed into the caller reading `unit.unit_id`: the
   * write model carries a target either way, and one field that is always the
   * card's own is cheaper to read than a rule spread across two modules.
   */
  unitId: string
  /** That unit's name, for the confirmation toast. */
  unitName: string
}

/**
 * What the control must collect before it may write.
 *
 * RESHAPED from a `needsReason: boolean` by kindred#2078 rather than added
 * beside it, because that flag was never really about a reason — it was about
 * whether the action has anything to ask. What it asks FOR now differs by
 * action, and a boolean cannot say which:
 *
 *   'reason'   — a release. A required reason and nothing else: opening a
 *                staff cabin to families names no occupant, so prompting for
 *                one would ask for a fact that does not exist.
 *   'none'     — a clear. It restores the unit's standing role rather than
 *                asserting anything about this weekend, so there is nothing
 *                to say.
 *
 * There WAS a third, `'occupant'` — a write-in's required name plus an
 * optional note. It went with the `hold` action on 2026-08-18: a write-in is
 * created by typing into the card's own family box, so this strip no longer
 * asks for an occupant, and the note is edited by the pencil on the write-in's
 * own card. Removed rather than kept unused, because a prompt nothing returns
 * is a form branch nothing can reach.
 */
export type AvailabilityPrompt = 'reason' | 'none'

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
 * ★ TAKES NO `occupied` ARGUMENT since the 2026-08-18 ruling, and the absence
 * is the point. It used to, purely to enforce #2090's "written-in and occupied
 * are mutually exclusive" gate on the one branch that offered a write-in. That
 * branch is gone (see the bottom of the function), so occupancy no longer
 * decides anything here: every action this returns is about the unit's ROLE
 * row, which a placed family has never had any bearing on.
 *
 * `family_available_override` IS still weekend-level and scenario-less, and
 * that is now a statement about the staff↔family ROLE alone: "we're moving
 * staff to X for weekend Y" is true in every plan, which is why 1500000135's
 * reasoning survived kindred#2382 intact for this half. The OCCUPANCY that
 * used to share the field is scenario-scoped and lives in `write_ins` — and
 * since kindred#2381 this resolves the ROLE rows only. A written-into space
 * returns null here and is removed from its own card, because one action
 * cannot name one row out of the several a merged card may cover.
 */
export function availabilityAction(unit: LodgingUnitRow): AvailabilityAction | null {
  // A SPLIT container is a whole-building aggregate, never a bookable room:
  // `drawnUnits` descends past it and `resolveDrop` rejects it as a target, so
  // an availability row written against one is a row no surface could show or
  // act on.
  //
  // A COMBINED one is the opposite on both counts since merge-by-drag (#2012)
  // -- it IS the card the board draws in place of its rooms, and it IS a drop
  // target -- so it takes a write-in like any other drawn unit. Refusing every
  // container here left the four `default_combined` buildings in the 2026
  // registry with no write-in path at all: not on the building's own card, and
  // not on its rooms either, because a merge is precisely what takes their
  // cards away. The gate is spelled exactly as `dragPlacement`'s and
  // `LodgingUnitCard`'s `isSplitContainer` are, so the three cannot drift.
  if (unit.is_container === true && unit.is_combined !== true) return null
  // `!== null` and not truthiness: null (no row for this weekend) and false
  // (closed this weekend) are different answers, and collapsing them makes
  // either "Write in" or "Clear" unreachable across most of the board.
  const own = { unitId: unit.unit_id, unitName: unit.name }
  // 'Clear' for both surviving branches — the RELEASE and the "agrees with the
  // role" one — because neither undoes a write-in and borrowing #2252's 'Clear
  // Write-in' wording would name a fact that is not there. That label went with
  // the write-in branch (kindred#2381); what it distinguished this button from
  // no longer sits beside it.
  const clear = (target: { unitId: string; unitName: string }): AvailabilityAction => ({
    kind: 'clear',
    label: 'Clear',
    familyAvailable: null,
    prompt: 'none',
    ...target,
  })
  /*
   * THE BRANCHES ARE ORDERED TO MIRROR `reservationBadge` ABOVE, and that
   * ordering is the rule rather than an accident of writing.
   *
   * A card can carry its own availability row AND a relative's write-in at
   * once — two rows, one control. This module already promises the badge and
   * the action cannot drift ("a card badged 'Write-in' that offers to 'Write
   * in' says two things about one cabin"), so a card the badge calls
   * "Write-in" offers no strip action at all rather than one that quietly
   * unmakes the other row. Anything else reports success for a row the staff
   * member was not looking at.
   */
  // A released staff cabin badges "Released" off its OWN row, so that is the
  // row its clear names — even when a relative's write-in also covers it.
  if (unit.inventory_class === 'staff_default' && unit.family_available_override === true) {
    return clear(own)
  }
  // A SPACE SOMEBODY IS WRITTEN INTO OFFERS NOTHING HERE — kindred#2381.
  //
  // This used to return a 'Clear Write-in' naming whichever row the server
  // resolved first, which was sound only while a card could carry exactly one.
  // A merged container covers every write-in beneath it — four of them on the
  // one 2026 building that has four — and one button cannot name four rows:
  // each click destroyed the row it named, the card re-populated with the next
  // occupant, and the action read as a no-op while it worked through them.
  //
  // Removal moved onto the cards, one X per `WriteInCard`, which can only ever
  // delete the row it sits on. The dead end that branch existed to prevent —
  // an inheriting card badging a write-in it cannot undo, while the unit
  // holding the row has no card at all — is closed by the X rather than by
  // this action, so returning null here strands nothing.
  //
  // ABOVE the `occupied` gate, exactly where the clear was: a written-into
  // card must not fall through to the 'Write in' branch at the bottom and
  // offer to write a SECOND occupant into a space that already resolves an own
  // row ahead of its descendants — which would hide the ones already there.
  if (hasWriteIn(unit)) return null
  // Any other ROLE override of its own — this branch has never been about
  // occupancy and is less so since kindred#2382. Two states reach it, both
  // storable and neither written by any surface: a `true` on a family-pool row
  // (it AGREES with that unit's role, so the badge stays silent) and a bare
  // `false`, which 1500000162 left none of and `set_availability` no longer
  // writes. The API does not check an override against the role and nothing
  // deletes one already stored, so the clear stays reachable for both.
  if (unit.family_available_override !== null && unit.family_available_override !== undefined) {
    return clear(own)
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
    return { kind: 'release', label: 'Release', familyAvailable: true, prompt: 'reason', ...own }
  }
  // ★ THE STRIP NO LONGER OFFERS "Write in" AT ALL (owner ruling, 2026-08-18).
  //
  // It used to end here with a `hold` action, gated on `!occupied` — the fix
  // for #2090. Both the action and its gate are gone, and the gate is the
  // reason the action had to go rather than the other way round.
  //
  // Creating a write-in moved into the card's own family box: type a name, and
  // if no registered family matches, that text becomes the write-in
  // (`PlaceFamilyPicker`'s `onWriteIn`). The ruling's own framing:
  //
  //   > "one fewer chip on the board on every tile, big win ... it removes two
  //   >  rectangular boxes coexisting and typeable when the write in is also
  //   >  happening"
  //
  // — two controls asking "who is sleeping here", side by side, and a staff
  // member forced to pick one before knowing which kind of answer they had.
  //
  // What the move FIXED, and what a re-introduction would break: #2090's gate
  // made a partly-filled space refuse a write-in, and on a merged container
  // that left no path at all, since the rooms lose their own cards to the
  // merge. `LodgingUnitCard`'s `canPickFamily` carries the reasoning in full.
  //
  // Returning null here is therefore the whole of the write-in's absence from
  // this strip: removal is the X on each `WriteInCard`, editing is the pencil
  // beside it, and creation is the box. None of the three is an availability
  // action any more.
  return null
}
