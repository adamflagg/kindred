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
 * `place_party` deliberately enforces no capacity or amenity rule; every
 * cabin is `is_confirmed = false` until staff walk the property, so a fit
 * gate here would refuse nearly every drop for a reason that is really "we
 * have not checked yet". A drop into a full or unsuitable room is allowed and
 * the board flags it afterwards.
 *
 * **It never validates a unit SET.** A merge-legality rule was built across
 * nine tasks and removed in kindred#1903; `docs/architecture/lodging-occupancy.md`
 * says why, and the reasoning is not obvious. Do not add one here.
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
  // A building carries the beds its halves already report and never gets a
  // card, so nothing may be placed on it.
  if (unit.is_container === true) return null

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
