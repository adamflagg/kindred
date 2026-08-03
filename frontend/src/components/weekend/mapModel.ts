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

/** Why the map cannot draw a party the board can. */
export type OffMapReason =
  /** On a merged slot, which carries no unit code and so no coordinate. */
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
   * totality guarantee for the payload as a whole. `buildBoard` already drops
   * an inactive, empty unit before `buildMapModel` ever sees it (see the
   * `drawn` filter in `boardLayout.ts`), so an unpositioned INACTIVE room
   * with nobody in it is silently dropped upstream and never reaches this
   * list.
   */
  unpositionedUnits: LodgingUnitRow[]
}

/**
 * Has this unit actually been positioned?
 *
 * PocketBase stores an unset number as 0, and — unlike `sleeps`, which the
 * roster service explicitly maps 0 -> None — `map_x`/`map_y` come through as
 * `0.0`. Rendered naively that lands in the exact top-left corner of the map
 * and reads as a real placement. Both axes zero is the tell; a genuine zero on
 * ONE axis is a legitimate edge coordinate and is kept.
 */
export function hasCoordinates(unit: LodgingUnitRow): boolean {
  const x = unit.map_x
  const y = unit.map_y
  if (x === null || x === undefined || y === null || y === undefined) return false
  return !(x === 0 && y === 0)
}

/**
 * The units a party occupies.
 *
 * NOT YET WIRED IN, deliberately. `buildMapModel` gets its party-to-unit
 * grouping from `buildBoard`, which groups on `unit_code` inside
 * `boardLayout.ts` — a file this PR must not edit. So today this function has
 * no caller but its own tests, and it is exported as the seam for one specific
 * change: when `RosterParty.unit_codes` lands (accepted by the merge-collapse
 * branch), a party can occupy SEVERAL rooms, `buildBoard`'s single-code
 * grouping stops being sufficient for positioning, and the map resolves units
 * here instead. Kept rather than deleted because that consumer is accepted and
 * in flight — unlike a seam whose consumer was cancelled, which should go.
 *
 * Do NOT hand-write `unit_codes` onto the row type ahead of the generated
 * types: a hand-written shape is how a surface starts silently disagreeing with
 * the API it reads.
 */
export function resolvePartyUnits(
  party: RosterPartyRow,
  unitsByCode: Map<string, LodgingUnitRow>
): LodgingUnitRow[] {
  const code = party.unit_code ?? ''
  if (code.length === 0) return []
  const unit = unitsByCode.get(code)
  return unit ? [unit] : []
}

function offMapReason(party: RosterPartyRow): OffMapReason {
  return party.is_merged_slot === true ? 'merged-slot' : 'not-on-board'
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
 * count, so overlapping rooms collapse into fewer marks — measured live, 103
 * positioned rooms render as 75 marks at rest — and the mark count keeps
 * falling as you zoom out further. A badge that changed as you zoomed would
 * be absurd, so it reports the room count, which is stable, rather than the
 * mark count, which is not.
 *
 * Shares `buildMapModel` with the surface on purpose: two copies of the
 * predicate is how a tab starts promising a number of rooms this count does
 * not match. This is NOT the Inventory count either, which includes
 * containers and unpositioned rooms.
 */
export function countMapUnits(parties: RosterPartyRow[], units: LodgingUnitRow[]): number {
  return buildMapModel(parties, units).units.length
}
