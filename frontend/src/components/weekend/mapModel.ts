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
import { buildBoard, slotOccupancy, type ConsentFlag } from './boardLayout'
import { effectiveSleeps } from './rosterAttention'
import { buildingKey, coveredCodes, indexUnitsByCode } from './unitLevel'

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
   * leaf beneath it — `effectiveSleeps` in `rosterAttention.ts`, imported
   * rather than reimplemented.
   */
  capacity: number | null
  /**
   * 0 when every party on this mark is wholly inside it; otherwise how many
   * rooms the widest straddling party holds. `slotOccupancy`'s own field,
   * carried through rather than re-derived — that doc is the full account.
   *
   * Threaded for the same reason `roomCount` and `capacity` are: the popover
   * receives `MapUnit[]` and never the registry, so it cannot walk a party's
   * leaves to ask the question itself. Without it the peek asserts over
   * capacity where BOTH board surfaces withhold it — `LodgingUnitCard`'s
   * `overCapacity` and `AssignFamilyModal`'s header each gate on
   * `spanWidth === 0`, because a party drawn on two rooms is counted in full
   * on each of them (kindred#2010) and no per-room split exists to divide it
   * by.
   *
   * Measured at ZERO spanning parties on the 2026 registry after #2040, so
   * this changes nothing on screen today. It is the guard on a reachable state,
   * pinned before it is reached.
   */
  spanWidth: number
  /**
   * The BUILDING this mark belongs to — kindred#2440's grain, resolved by
   * `pinFor` below and carried so `LodgingMap` can hand it to clustering as
   * the group that nothing merges across.
   *
   * Threaded rather than re-derived for the reason `roomCount` and `capacity`
   * are: the consumer holds `MapUnit[]` and never the registry, so it cannot
   * walk a room to its parent to ask. A second derivation is also how the
   * product would end up with two different "buildings" — see `buildingKey`.
   */
  buildingCode: string
  /**
   * Normalized 0-1 map coordinates. Projection to pixels is the viewport's job.
   *
   * THE BUILDING'S, not necessarily this unit's own — see `pinFor`.
   */
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
   * Bookable rooms with no pin to inherit — neither their own nor their
   * building's (kindred#2440). A room whose own coordinate is unset but whose
   * building is positioned is NOT here: it draws at the building's pin, which
   * is what inheritance means. Unreachable on the 2026 registry, where all
   * 118 units are positioned.
   *
   * This is not a totality guarantee for the payload as a whole. `buildBoard` drops two
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
 *
 * TAKES THE PAIR, not a whole row (kindred#2013), so the admin registry's
 * `LodgingUnitRecord` can be judged by the same rule the roster's
 * `LodgingUnitRow` is. A second copy of "both axes zero means unset" is
 * exactly how the (0,0) trap gets back in.
 */
export function hasCoordinates(unit: Pick<LodgingUnitRow, 'map_x' | 'map_y'>): boolean {
  const x = unit.map_x
  const y = unit.map_y
  if (x === null || x === undefined || y === null || y === undefined) return false
  return !(x === 0 && y === 0)
}

function offMapReason(party: RosterPartyRow): OffMapReason {
  return party.is_merged_slot === true ? 'merged-slot' : 'not-on-board'
}

/**
 * How many ACTIVE leaf rooms a drawn unit stands for.
 *
 * `coveredCodes` walks to the leaves at ANY depth, past every intermediate
 * container, which is the part a direct-children walk gets wrong: the
 * production registry is three levels deep (a house, its upstairs/downstairs
 * halves, their rooms), so a one-level walk off a combined house finds two
 * containers, no rooms, and reports a plausible-looking nothing. It carries
 * the cycle backstop too.
 *
 * A RETIRED ROOM IS SKIPPED, for the same reason `effectiveSleeps` skips it
 * and so that the two agree: the popover prints this count and that capacity
 * on adjacent lines of one summary, and a room the beds total deliberately
 * left out must not come back as one of the building's "open" ones.
 *
 * A childless combined container has no rooms beneath it, but it is still one
 * bookable thing with one card and one mark, so it counts as 1 rather than as
 * 0 — a peek reading "0 rooms" over a mark you can see is worse than the
 * approximation. Every other case is the honest leaf count.
 */
function unitRoomCount(unit: LodgingUnitRow, units: LodgingUnitRow[]): number {
  if (unit.is_container !== true) return 1
  const byCode = indexUnitsByCode(units)
  const active = coveredCodes(unit, units).filter(
    (code) => byCode.get(code)?.is_active !== false
  ).length
  return Math.max(active, 1)
}

/**
 * WHERE THIS DRAWN UNIT'S MARK GOES — one pin per building (kindred#2440).
 *
 * Owner ruling 2026-08-21: the session map is a view of BUILDINGS. A room
 * inherits its building's coordinate and never carries its own point, so a
 * building draws as ONE mark at every zoom rather than dissolving into its
 * rooms the moment you zoom past the cluster radius. The per-room coordinates
 * it overrides are not geography: kindred#2013 digitised them from the base
 * map's LABEL anchors, so each room inherited wherever its printed name sat.
 *
 * RESOLVED AT READ TIME. Nothing is written and no stored value is dropped
 * (question 2, defaulted): `map_x`/`map_y` are classified staff-owned and all
 * 118 production units carry one, so a migration would destroy 103 real values
 * to rescue nothing — and this is reversible by deleting this function.
 *
 * THE GRAIN IS THE IMMEDIATE PARENT — `buildingKey`, the grain kindred#2008
 * ruled on placement-history evidence, reused rather than re-derived. Two
 * container HALVES under one roof are let separately and stay two buildings;
 * walking to the root would merge them. That is question 4's 83 pin sites
 * against the root grain's 79, and they differ for four buildings.
 *
 * A DRAWN CONTAINER IS ITSELF THE BUILDING and keeps its own point. It does
 * not roll up another level — the 83 counts 71 freestanding rooms plus the 12
 * containers that carry a room's pin, so a container is a pin SITE, never a
 * pin BORROWER.
 *
 * THE FALLBACK IS THE POINT OF THE `null`. Read-time resolution must never
 * lose a pin that exists today, so an unpositioned building yields to the
 * room's own coordinate rather than taking the room off the map. Only when
 * neither carries one is there nothing to draw. Unreachable on the 2026
 * registry; it is what makes the resolution safe rather than lucky.
 */
function pinFor(
  unit: LodgingUnitRow,
  units: LodgingUnitRow[]
): { building: LodgingUnitRow; x: number; y: number } | null {
  const byCode = indexUnitsByCode(units)
  const building =
    unit.is_container === true ? unit : (byCode.get(buildingKey(unit, byCode)) ?? unit)
  // The building's own point wins whenever it has one — that is the override,
  // and it is deliberately an override of a real value rather than a rescue of
  // a missing one.
  if (hasCoordinates(building)) return { building, x: building.map_x ?? 0, y: building.map_y ?? 0 }
  if (hasCoordinates(unit)) return { building, x: unit.map_x ?? 0, y: unit.map_y ?? 0 }
  return null
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
      const pin = pinFor(slot.unit, units)
      if (pin === null) {
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
        // `effectiveSleeps`, IMPORTED rather than re-derived: the kindred#2041
        // delta arithmetic already exists three times (the roster service, the
        // roster's unmeasured chip, the admin editor) and a fourth copy here
        // would be one with no shape difference to excuse it — that helper
        // takes the same `LodgingUnitRow[]` this file has in hand.
        capacity: effectiveSleeps(slot.unit, units),
        // `slotOccupancy`, IMPORTED for the same reason `effectiveSleeps` is:
        // "is this party inside this card" is one predicate, and #2040 records
        // what a second copy costs — the overlap rule was fixed at the slot
        // level and came straight back one level down in `FamilyCard`. Only
        // the `spanWidth` half is taken; the map's peek counts its own beds
        // with `partySpots`, which is the roster's number rather than the
        // board's `partySize`.
        spanWidth: slotOccupancy(slot, units).spanWidth,
        buildingCode: pin.building.code,
        x: pin.x,
        y: pin.y,
      })
    }
  }

  return { units: mapUnits, unplaced: board.unplaced, offMap, unpositionedUnits }
}

/**
 * How many BOOKABLE ROOMS ARE POSITIONED — what the Map tab's badge counts.
 *
 * This is NOT how many marks the map draws, and since kindred#2440 the gap is
 * structural rather than incidental. Clustering runs AFTER this count, and
 * every room of a multi-room building now resolves to ONE point, so those
 * rooms collapse into a single mark at every zoom. A badge that reported
 * marks would therefore undercount the rooms staff can actually book, and
 * would still have been absurd for the older reason: before #2440 the mark
 * count also moved as you zoomed. It reports the room count, which is stable.
 *
 * ⚠️ This docstring used to claim "76 positioned rooms render as 76 marks at
 * rest (nothing happens to overlap there this year)", which disagreed with
 * `mapClustering`'s own measurement of 8 multi-room clusters at 1x. #2440
 * settles the disagreement by removing the question: re-measure before
 * quoting a mark count anywhere.
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
