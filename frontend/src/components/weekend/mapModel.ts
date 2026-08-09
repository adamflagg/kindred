/**
 * The map's model, as a pure projection of the BOARD's model.
 *
 * `buildMapModel` calls `buildBoard` rather than re-deriving anything, so the
 * two surfaces cannot disagree about who is in which room. The map adds one
 * thing the board does not have — position — and inherits one obligation from
 * it: NO PARTY IS EVER DROPPED.
 *
 * The board's totality is three-way (slots / unplaced / offBoard). The map adds
 * a fourth failure mode of its own: a party the board can draw but the map
 * cannot PLACE. Those join the off-map section rather than the unplaced corner
 * queue, because they ARE placed and saying otherwise is a lie about the data.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { buildBoard, type ConsentFlag } from './boardLayout'
import { coveredCodes } from './unitLevel'

/** Why the map cannot draw a party the board can. */
export type OffMapReason =
  /**
   * On a merged slot the board could not resolve — every room it names is
   * missing from the payload, so there is no coordinate to pin it to. A merge
   * whose rooms DO resolve never reaches here: since #1940 it is drawn across
   * each of them.
   *
   * This reason is the only one restricted to `board.offBoard`. `no-coordinates`
   * below is given to parties sitting in drawn slots.
   */
  | 'merged-slot'
  /** The board could not draw it either — a container, or a unit not in the payload. */
  | 'not-on-board'
  /** The unit exists and is bookable, but nobody has positioned it. */
  | 'no-coordinates'

export interface MapUnit {
  unit: LodgingUnitRow
  parties: RosterPartyRow[]
  consent: ConsentFlag | null
  /** The area's colour, from the board's array in the board's order. */
  hue: string
  /**
   * How many LEAF ROOMS this mark stands for — 1 for an ordinary cabin, N for
   * a combined house drawn as a single card.
   *
   * Computed HERE and threaded down because `MapUnitPopover` receives
   * `MapUnit[]` and never the registry, so it cannot walk a house's rooms
   * (kindred#2183). Without it a container's peek can only say "1 room",
   * which is the wrong number in the direction that looks plausible.
   */
  roomCount: number
  /**
   * Whole-house capacity, or `null` when nobody has measured it.
   *
   * For an ordinary room this is just its own `sleeps`. For a combined house
   * it is the container's `sleeps` DELTA (kindred#2041) plus every active
   * leaf beneath it — see `unitCapacity` below.
   */
  capacity: number | null
  /** Normalized 0-1 map coordinates. Projection to pixels is the viewport's job. */
  x: number
  y: number
}

export interface OffMapEntry {
  party: RosterPartyRow
  reason: OffMapReason
}

export interface MapModel {
  units: MapUnit[]
  /** Not placed anywhere. Ranked by the board. */
  unplaced: RosterPartyRow[]
  /** Placed, but not drawable on a map. */
  offMap: OffMapEntry[]
  /**
   * Bookable rooms nobody has positioned, reported HERE — but this is not a
   * totality guarantee for the payload as a whole. `buildBoard` drops two
   * kinds of unit before `buildMapModel` ever sees them (see the `drawn`
   * filter in `boardLayout.ts`), and an unpositioned one of either kind is
   * dropped upstream and never reaches this list:
   *
   * - an INACTIVE room with nobody in it;
   * - permanent STAFF HOUSING with nobody in it — staff know where those are
   *   and asked not to have them on the map.
   *
   * Both are deliberate. If you are hunting a cabin that is missing from the
   * map and not reported here, check those two before suspecting coordinates.
   */
  unpositionedUnits: LodgingUnitRow[]
}

/**
 * Has this unit actually been positioned?
 *
 * PocketBase stores an unset number as 0, which rendered naively lands in the
 * exact top-left corner of the map and reads as a real placement. Both axes
 * zero is the tell; a genuine zero on ONE axis is a legitimate edge coordinate
 * and is kept.
 *
 * The API settles this too as of kindred#1941 — `_map_point` in
 * `lodging_roster_service.py` sends the unset PAIR as null, and names this
 * function as its defence-in-depth partner. This is the second line, not the
 * only one; it stays because it is the guard that has been holding this up so
 * far, and because the same payload shape is reachable from a cached client.
 */
export function hasCoordinates(unit: LodgingUnitRow): boolean {
  const x = unit.map_x
  const y = unit.map_y
  if (x === null || x === undefined || y === null || y === undefined) return false
  return !(x === 0 && y === 0)
}

function offMapReason(party: RosterPartyRow): OffMapReason {
  return party.is_merged_slot === true ? 'merged-slot' : 'not-on-board'
}

/**
 * The ACTIVE leaf rows beneath a drawn unit — itself, when it is an ordinary
 * room.
 *
 * `coveredCodes` walks to the leaves at ANY depth, past every intermediate
 * container, which is the part a direct-children walk gets wrong: the
 * production registry is three levels deep (a house, its upstairs/downstairs
 * halves, their rooms), so a one-level walk off a combined house finds two
 * containers, no rooms, and reports a plausible-looking nothing. It carries
 * the cycle backstop too.
 *
 * A retired room is dropped in BOTH directions: it contributes no beds, and
 * it must not park its house in the unmeasured state forever.
 */
function activeLeavesOf(unit: LodgingUnitRow, units: LodgingUnitRow[]): LodgingUnitRow[] {
  const byCode = new Map(units.map((row) => [row.code, row]))
  return coveredCodes(unit, units)
    .map((code) => byCode.get(code))
    .filter((leaf): leaf is LodgingUnitRow => leaf !== undefined && leaf.is_active !== false)
}

/**
 * A drawn unit's whole-house capacity, or `null` when nobody has measured it.
 *
 * THE SAME ARITHMETIC as `_effective_sleeps` in
 * `api/services/lodging_roster_service.py`, `effectiveSleeps` in
 * `rosterAttention.ts` and `derivedWholeHouseSleeps` in
 * `components/admin/lodging/derivedCapacity.ts`. Those three already say it
 * of each other; this is the map's read of it, and it exists here rather
 * than as an import because the two frontend copies are each private to a
 * file whose props shape differs (`LodgingUnitRow` vs `LodgingUnitRecord`).
 * IF THE ARITHMETIC CHANGES, CHANGE IT IN ALL FOUR.
 *
 * An ordinary room short-circuits to its own `sleeps` — no walk, and no way
 * for the container rules below to alter what a plain cabin reports.
 */
function unitCapacity(unit: LodgingUnitRow, units: LodgingUnitRow[]): number | null {
  const own = unit.sleeps ?? null
  if (unit.is_container !== true) return own

  const leaves = activeLeavesOf(unit, units)
  if (leaves.some((leaf) => (leaf.sleeps ?? null) === null)) return null
  // Summing an absent delta over an empty room list yields 0 — the confident
  // claim "this house sleeps nobody" rather than "nobody has measured it".
  if (own === null && leaves.length === 0) return null
  return (own ?? 0) + leaves.reduce((total, leaf) => total + (leaf.sleeps ?? 0), 0)
}

/**
 * How many leaf rooms a drawn unit stands for.
 *
 * A childless combined container has no rooms beneath it, but it is still one
 * bookable thing with one card and one mark, so it counts as 1 rather than as
 * 0 — a peek reading "0 rooms" over a mark you can see is worse than the
 * approximation. Every other case is the honest leaf count.
 */
function unitRoomCount(unit: LodgingUnitRow, units: LodgingUnitRow[]): number {
  if (unit.is_container !== true) return 1
  return Math.max(coveredCodes(unit, units).length, 1)
}

export function buildMapModel(parties: RosterPartyRow[], units: LodgingUnitRow[]): MapModel {
  const board = buildBoard(parties, units)

  const mapUnits: MapUnit[] = []
  const offMap: OffMapEntry[] = board.offBoard.map((party) => ({
    party,
    reason: offMapReason(party),
  }))
  const unpositionedUnits: LodgingUnitRow[] = []

  for (const area of board.areas) {
    for (const slot of area.slots) {
      if (!hasCoordinates(slot.unit)) {
        unpositionedUnits.push(slot.unit)
        for (const party of slot.parties) {
          offMap.push({ party, reason: 'no-coordinates' })
        }
        continue
      }
      mapUnits.push({
        unit: slot.unit,
        parties: slot.parties,
        consent: slot.consent,
        hue: area.hue,
        roomCount: unitRoomCount(slot.unit, units),
        capacity: unitCapacity(slot.unit, units),
        // Non-null by hasCoordinates above; narrowed for the type checker.
        x: slot.unit.map_x ?? 0,
        y: slot.unit.map_y ?? 0,
      })
    }
  }

  return { units: mapUnits, unplaced: board.unplaced, offMap, unpositionedUnits }
}

/**
 * How many BOOKABLE ROOMS ARE POSITIONED — what the Map tab's badge counts.
 *
 * This is NOT how many marks the map draws. Clustering runs AFTER this
 * count, so overlapping rooms collapse into fewer marks whenever any of them
 * share a spot — measured live on 2026's busiest weekend, 76 positioned
 * rooms render as 76 marks at rest (nothing happens to overlap there this
 * year), and the mark count keeps falling as you zoom out further wherever
 * it does. A badge that changed as you zoomed would be absurd, so it reports
 * the room count, which is stable, rather than the mark count, which is not.
 *
 * The 76 itself is NOT the old 103 with a typo fixed — kindred#1993 stopped
 * `buildBoard` (which this projects) drawing unreleased staff housing, so
 * the room count this function returns fell along with it. Re-measure rather
 * than trusting either number if it drifts again.
 *
 * Shares `buildMapModel` with the surface on purpose: two copies of the
 * predicate is how a tab starts promising a number of rooms this count does
 * not match. This is NOT the raw unit count either, which includes
 * containers and unpositioned rooms.
 */
export function countMapUnits(parties: RosterPartyRow[], units: LodgingUnitRow[]): number {
  return buildMapModel(parties, units).units.length
}
