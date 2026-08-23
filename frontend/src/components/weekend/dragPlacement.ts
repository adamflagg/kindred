/**
 * Turning a drop into a write intent, as a pure function.
 *
 * jsdom cannot perform a pointer drag, so a board that decided placement
 * inside its `onDragEnd` closure would have its actual rules — which drops do
 * nothing, which are refused, which grain the write names — untestable. They
 * live here instead, and `LodgingBoard` only wires ids to them.
 *
 * ## What this file will NOT do
 *
 * **It never validates fit.** `partyAttention` is advisory and
 * `place_party` deliberately enforces no capacity or amenity rule: a misfit is
 * surfaced on the board's hatch channel (kindred#1912), never refused at the
 * door, so a fit gate here would turn an advisory signal into a hard block. A
 * drop into a full or unsuitable room is allowed and the board flags it
 * afterwards.
 *
 * This once rested on "every cabin is `is_confirmed = false` until staff walk
 * the property". That is no longer true — 118 of 118 units are confirmed in the
 * production snapshot of 2026-08-06 — but the rule never depended on it.
 *
 * **It never validates a unit SET.** A merge-legality rule was built across
 * nine tasks and removed in kindred#1903; `docs/architecture/lodging-occupancy.md`
 * says why, and the reasoning is not obvious. Do not add one here.
 *
 * **It never refuses a WRITTEN-INTO space.** It did until kindred#2432, on
 * #2090's ruling that a write-in and a placement were mutually exclusive. They
 * are not: a write-in names an occupant the system has no record of — a paper
 * registration, most often — and such a party can legitimately share a cabin
 * with a placed family. See the gate's own headstone inside `resolveDrop`.
 *
 * What it does refuse is a write that cannot succeed: a unit the payload does
 * not carry, a container row, and a party carrying neither CampMinder id.
 */
import type { LodgingUnitRow, RosterPartyRow, WeekendRoster } from '../../types/lodging'
import { occupiedCodes } from './boardLayout'
import { partyKey } from './partyKey'

/**
 * The queue droppable. One id, imported by the badge that registers it and
 * the board that reads it back — a literal in two places is how a drop target
 * silently stops matching.
 */
export const UNPLACED_DROPPABLE_ID = 'weekend-unplaced'

const UNIT_PREFIX = 'weekend-unit:'

/**
 * The droppable id for a unit card.
 *
 * Decoded by PREFIX LENGTH, never by splitting on the separator: unit codes
 * are ingest-derived strings rather than a controlled vocabulary, and one
 * containing a colon would decode to a truncated code under a naive split —
 * which resolves to no unit, or worse, to a different one.
 */
export function unitDroppableId(code: string): string {
  return `${UNIT_PREFIX}${code}`
}

export type DropTarget = { kind: 'unit'; unitCode: string } | { kind: 'unplaced' }

/** `null` for a drag that ended over nothing, or over something else entirely. */
export function parseDropTarget(overId: string | null | undefined): DropTarget | null {
  if (typeof overId !== 'string' || overId.length === 0) return null
  if (overId === UNPLACED_DROPPABLE_ID) return { kind: 'unplaced' }
  if (overId.startsWith(UNIT_PREFIX)) {
    const unitCode = overId.slice(UNIT_PREFIX.length)
    return unitCode.length > 0 ? { kind: 'unit', unitCode } : null
  }
  return null
}

/**
 * Draggable AND droppable id prefix for the CARD gesture — merging one room
 * into a sibling, or the reverse resolution's refusal of anything that is not
 * shaped like this gesture.
 *
 * A party's drag id is always its `partyKey`, which is never `merge:`-shaped,
 * so `resolveDrop` (which looks the active id up as a party) and
 * `resolveMergeDrop` (which requires BOTH ids to carry this prefix) can never
 * both claim the same drop event. That is deliberate, not incidental: it is
 * what lets `LodgingBoard` try the merge resolver first, unconditionally,
 * without first having to decide which gesture is in flight.
 */
const MERGE_PREFIX = 'merge:'

/** The draggable and droppable id for a room's merge handle. */
export function mergeDragId(code: string): string {
  return `${MERGE_PREFIX}${code}`
}

/** `null` unless `id` is a merge-gesture id naming a unit the payload carries. */
export function mergeDragUnit(
  id: string | null | undefined,
  units: LodgingUnitRow[]
): LodgingUnitRow | null {
  if (typeof id !== 'string' || !id.startsWith(MERGE_PREFIX)) return null
  const code = id.slice(MERGE_PREFIX.length)
  if (code.length === 0) return null
  return units.find((candidate) => candidate.code === code) ?? null
}

/**
 * Whether `candidate` is a legal merge target for the card currently being
 * dragged — the gender-rule analogue (`isValidDropTarget` on summer's
 * `BunkCard`) for this gesture. `source === null` means no card drag is in
 * flight, which is never valid for anybody; a unit dropped on itself, or two
 * units under different (or absent) parents, are equally refused.
 *
 * A room with NO `parent_code` offers no valid target ever, in either
 * direction: merging is promotion to the parent, and a parentless room has
 * nothing to be promoted to.
 */
export function isValidMergeTarget(
  source: LodgingUnitRow | null,
  candidate: LodgingUnitRow
): boolean {
  if (source === null || source.code === candidate.code) return false
  const parentCode = source.parent_code ?? ''
  return parentCode !== '' && parentCode === (candidate.parent_code ?? '')
}

/** What a completed card-merge gesture asks the board to write. */
export interface MergeIntent {
  parentCode: string
  combined: true
  /**
   * The DROP TARGET room — the card the merge handle landed on, where staff
   * are looking. The merge-morph animation anchors its convergence there
   * (`boardMorph.ts`), which is what makes the building appear to form ONTO
   * the card they acted on rather than at an arbitrary sibling.
   */
  targetCode: string
}

export interface ResolveMergeDropArgs {
  activeId: string | null | undefined
  overId: string | null | undefined
  units: LodgingUnitRow[]
}

/**
 * A room card dropped onto a sibling promotes their shared parent to
 * combined. `null` for anything else: a target with no parent, two rooms
 * under different parents, a room dropped on itself, or either id not shaped
 * like this gesture — see the module doc above `MERGE_PREFIX`.
 */
export function resolveMergeDrop({
  activeId,
  overId,
  units,
}: ResolveMergeDropArgs): MergeIntent | null {
  const source = mergeDragUnit(activeId, units)
  const target = mergeDragUnit(overId, units)
  if (source === null || target === null || !isValidMergeTarget(source, target)) return null
  return { parentCode: source.parent_code ?? '', combined: true, targetCode: target.code }
}

export type PlacementIntent =
  | {
      kind: 'place'
      party: RosterPartyRow
      unitId: string
      unitCode: string
      unitName: string
    }
  | { kind: 'unplace'; party: RosterPartyRow }

/** The grain half of every placement write body. */
export type PartyGrainBody = { household_cm_id: number } | { person_cm_id: number }

/**
 * Name exactly ONE grain, which is what `PartyGrainRequest` requires.
 *
 * The wire carries both fields and fills the unused one with 0, so spreading
 * the party would send both keys. The server counts fields that are non-zero
 * rather than present, so that happens to pass today — but the schema's rule
 * is "name exactly one", and sending the other id is a claim about the party
 * that is not true. Return only the one that identifies it.
 */
export function partyGrainBody(party: RosterPartyRow): PartyGrainBody {
  return party.grain === 'person'
    ? { person_cm_id: party.person_cm_id ?? 0 }
    : { household_cm_id: party.household_cm_id ?? 0 }
}

/** Placed-ness, defined exactly as `buildBoard` defines it. Two answers here would split the board. */
function isPlaced(party: RosterPartyRow): boolean {
  return (party.unit_name ?? '').length > 0
}

export interface ResolveDropArgs {
  activeId: string | null | undefined
  overId: string | null | undefined
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
}

/**
 * `null` means "do nothing" — including the cases that look like a move but
 * are not one. That matters beyond saving a round trip: every write flips
 * `staff_touched`, which is one-way, so a drop that changed nothing would
 * still record the placement as a staff decision.
 */
export function resolveDrop({
  activeId,
  overId,
  parties,
  units,
}: ResolveDropArgs): PlacementIntent | null {
  const target = parseDropTarget(overId)
  if (target === null) return null

  const party = parties.find((candidate) => partyKey(candidate) === activeId)
  if (party === undefined) return null

  // A household whose record failed to resolve comes through with both ids at
  // 0, and `partyKey` falls back to its display name — so it HAS a drag id and
  // can be picked up. Every write must name a grain, so letting this through
  // would fire a guaranteed 422 and roll the card back with an error staff
  // could do nothing about.
  const cmId = party.grain === 'person' ? (party.person_cm_id ?? 0) : (party.household_cm_id ?? 0)
  if (cmId <= 0) return null

  if (target.kind === 'unplaced') {
    return isPlaced(party) ? { kind: 'unplace', party } : null
  }

  const unit = units.find((candidate) => candidate.code === target.unitCode)
  if (unit === undefined) return null
  // ⚠️ NO WRITE-IN REFUSAL HERE, and its absence is a ruling rather than an
  // omission — do not restore one.
  //
  // `if (hasWriteIn(unit)) return null` stood on this line until kindred#2432,
  // under #2090 ("held and occupied are mutually exclusive"), and its own
  // comment called it *the load-bearing one*: #2080 adds a placement path that
  // never touches a `useDroppable`, so a refusal living only on that hook's
  // `disabled` flag would be silently bypassed. That reasoning about WHERE a
  // refusal has to live was correct and is why this was the last gate standing;
  // what was struck is the refusal itself.
  //
  // Owner ruling 2026-08-18: *"we should be able to add families to any write
  // in space, or add a write in to a family space — regardless of which came
  // first."* A write-in NAMES AN OCCUPANT; it does not CLOSE THE SPACE. The
  // reported case is one paper registration — which has no CampMinder record,
  // so a write-in is the only way to record it at all — sharing a cabin with
  // one placed CampMinder family, and this line is what refused it.
  //
  // The tree walk the refusal used to ride on is still doing its job upstream:
  // `hasWriteIn` read the SERVER-RESOLVED cover rather than the raw column
  // precisely because a row names one unit but covers a whole space, and that
  // is what still lands the write-in and the family in the SAME card's well
  // whichever level the board draws (`LodgingUnitCard`'s `writeInEntries`).
  //
  // The known cost was filed, not hidden, and kindred#2503 has since closed
  // most of it: a write-in used to carry no headcount at all, so a shared
  // space's free-bed figure always overstated once both were in it
  // (kindred#2439, ruled an optional investigation and explicitly not a
  // blocker at the time). `dragCapacity`'s `freeBeds` (LodgingUnitCard.tsx)
  // now subtracts a write-in's recorded `party_size`, and withholds the
  // free-bed claim via `known` rather than assert a wrong one when nobody
  // recorded a size -- which is still every one of the 24 production rows
  // today, so this drop path's behaviour is unchanged in practice.
  // A COMBINED container IS a card now — Task 6 draws its own row in place of
  // its rooms (unitLevel.ts, `drawnUnits`) — so it must accept a drop exactly
  // like any other drawn unit. A NON-combined container still carries only
  // the beds its halves already report and never gets a card, so nothing may
  // be placed on it.
  if (unit.is_container === true && unit.is_combined !== true) return null

  // Only a party occupying this one room and nothing else is already where it
  // was dropped. A multi-room party dropped onto ONE of its own rooms is a
  // real change — it collapses the placement to that room.
  const current = occupiedCodes(party)
  if (current.length === 1 && current[0] === unit.code) return null

  return {
    kind: 'place',
    party,
    unitId: unit.unit_id,
    unitCode: unit.code,
    unitName: unit.name,
  }
}

export interface ResolvePickerPlacementArgs {
  /** The row the staff member clicked, as the list rendered it. */
  party: RosterPartyRow
  /** The card the picker is mounted on. */
  unitCode: string
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
}

/**
 * The unit card's picker (kindred#2080), resolved through the DROP path.
 *
 * A thin adapter and nothing more, and that is the whole design: the second
 * placement path must not be a second set of rules. Everything that makes a
 * drop a no-op or a refusal — a non-combined container, a party carrying
 * neither CampMinder id, a party already alone in this room — is inherited
 * here for free because the answer is literally `resolveDrop`'s. That cuts
 * both ways, which kindred#2432 is the proof of: striking the written-into
 * refusal in `resolveDrop` struck it here too, with nothing to edit.
 * A picker-layer copy of any of them is the drift this exists to prevent.
 *
 * The party is re-resolved out of `parties` by its own key rather than trusted
 * from the row: the list renders from a snapshot, and a refetch landing
 * between render and click would otherwise write a placement for a party the
 * roster no longer carries. `resolveDrop` does that lookup already, so passing
 * the KEY rather than the object is what gets it.
 */
export function resolvePickerPlacement({
  party,
  unitCode,
  parties,
  units,
}: ResolvePickerPlacementArgs): PlacementIntent | null {
  return resolveDrop({
    activeId: partyKey(party),
    overId: unitDroppableId(unitCode),
    parties,
    units,
  })
}

/**
 * The roster payload as it will look once the write lands — the optimistic
 * update.
 *
 * This is not a nicety. React Query serves the PREVIOUS data while a refetch
 * is in flight, and `LodgingBoard` derives its whole layout from `parties`, so
 * an invalidate-only path rubber-bands the dragged card back into its old
 * cabin for as long as the roster takes to come back — which on this endpoint
 * is seconds, not milliseconds.
 *
 * PURELY FUNCTIONAL, and that is the load-bearing property: `onMutate` keeps
 * the pre-mutation object as the rollback value, so an in-place edit would
 * make a rejected write "roll back" to the optimistic state and the card would
 * never return to where it came from.
 */
export function applyPlacement(roster: WeekendRoster, intent: PlacementIntent): WeekendRoster {
  const movedKey = partyKey(intent.party)
  const wasPlaced = isPlaced(intent.party)
  const willBePlaced = intent.kind === 'place'

  // `parties` is optional on the generated type — every Pydantic field with a
  // default renders optional in TypeScript, even though the server always
  // sends it (see types/lodging.ts).
  let moved = false
  const parties = (roster.parties ?? []).map((party) => {
    if (partyKey(party) !== movedKey) return party
    moved = true
    return intent.kind === 'place'
      ? {
          ...party,
          unit_code: intent.unitCode,
          unit_name: intent.unitName,
          unit_codes: [intent.unitCode],
          // A collapse to one room is no longer a merge. Left set, `buildBoard`
          // would keep routing the card to "Placed outside the board" and it
          // would jump a second time when the refetch corrected it.
          is_merged_slot: false,
        }
      : { ...party, unit_code: '', unit_name: '', unit_codes: [], is_merged_slot: false }
  })

  // A move between two units changes neither count — and NEITHER does a party
  // that is not in this snapshot. The row update is guarded on a `partyKey`
  // match, so counting a party no row matched would let `parties_assigned`
  // drift past the number of placed rows. Reachable when a refetch lands
  // between drag start and `onMutate` and drops the party.
  const delta = !moved || wasPlaced === willBePlaced ? 0 : willBePlaced ? 1 : -1
  const assigned = (roster.counts?.parties_assigned ?? 0) + delta
  const unassigned = (roster.counts?.parties_unassigned ?? 0) - delta

  return {
    ...roster,
    parties,
    counts: {
      ...roster.counts,
      parties_assigned: assigned,
      parties_unassigned: unassigned,
    },
  }
}
