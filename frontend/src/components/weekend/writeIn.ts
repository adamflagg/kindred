/**
 * A write-in: a named occupant the system does not know about — kindred#2078.
 *
 * Owner ruling, 2026-08-09: *"only one, hold is the write in"*. Staff never
 * used Hold to reserve an empty room. They used it to record somebody sleeping
 * in one — almost always non-rostered weekend staff — so the room read as
 * *empty and closed* when in truth it was *full*. There is ONE control and one
 * action; the occupant name is what the row was always for.
 *
 * ## What a write-in is a fact ABOUT — and what it is not
 *
 * A SPACE, and a PLAN. It says somebody is in this room; it says nothing about
 * whether the room is staff housing or family inventory, which is the separate
 * staff↔family ROLE question. kindred#2382 split those two apart after they
 * had shared one boolean:
 *
 * | fact | stored in | scoped to |
 * |---|---|---|
 * | staff↔family ROLE | `lodging_availability` | the WEEKEND — every plan sees it |
 * | write-in OCCUPANCY | `lodging_write_ins` / `_draft` | the SCENARIO that made it |
 *
 * The occupancy is scenario-scoped because not every write-in is non-rostered
 * staff: some are paper registrations for families arriving with no children,
 * and that is a modelling choice belonging to the plan that made it. The role
 * is not, because a release names no occupant — "we're moving staff to X for
 * weekend Y" is true whichever plan you are looking at.
 *
 * ## Why this is a module and not an inline `=== false`
 *
 * The board already had that expression, spelled `held`, in three places. One
 * of them was load-bearing in a way a rename would have silently broken:
 * #2093's forest open-tint suppresses itself on a written-into room, and it did
 * so by testing `unit.family_available_override === false` — a PROXY for "is
 * somebody in it". Reading the fact through one named function is what let the
 * proxy be retired here, once, instead of in every consumer: that field now
 * answers the ROLE alone, and `write_in` answers this one.
 *
 * ## What is deliberately NOT here
 *
 * No fallback from `name` to `note`. 1500000148 moved every historical note
 * into `occupant_name` and cleared the column behind it, because the same
 * string rendered as both the occupant's NAME and the card's italic reason line
 * printed twice on one card. A fallback would restore that by another route.
 *
 * No fallback from `write_in` to `family_available_override === false` either,
 * and that one was deliberately removed rather than never written — see
 * `coveringWriteIn`.
 */
import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'

/** Who is in a room, and anything staff said about them. */
export interface WriteInOccupant {
  /**
   * The occupant's name, or `''` when nobody named them.
   *
   * Empty is reachable and is not an error: the write schema is permissive
   * where the control is not (an ingest or a fixture has no author to ask), and
   * a row written before 1500000148 whose note was empty backfills to nothing.
   */
  name: string
  /**
   * The optional note beside the name — "so next week's staff can act on it".
   *
   * PROSPECTIVE ONLY. 1500000148 cleared the note of every row it copied, so
   * no historical write-in carries one and an empty column here is correct
   * rather than a bug.
   */
  note: string
}

/**
 * The occupant written into this space for this weekend, or `null` if none.
 *
 * "This space", not "this unit": a building's write-in closes its rooms and a
 * room's closes its building as a whole-house let, and the board draws whichever
 * level the unit tree resolves to. The server does that walk (`write_in_covers`)
 * and this reads its answer.
 */
export function writeInOccupant(unit: LodgingUnitRow): WriteInOccupant | null {
  const cover = coveringWriteIn(unit)
  if (cover === null) return null
  return { name: (cover.occupant_name ?? '').trim(), note: (cover.note ?? '').trim() }
}

/** Where a unit's write-in is recorded, or `null` if none covers it. */
export interface WriteInSource {
  /** The unit the `lodging_write_ins` row belongs to — a clear's target. */
  unitId: string
  unitCode: string
  unitName: string
  /** Whether the row is this unit's own, rather than inherited through the tree. */
  isOwn: boolean
}

/**
 * WHICH unit holds the write-in covering this one.
 *
 * A SECOND function rather than more fields on `WriteInOccupant`, because the
 * two answer different questions and only one of them is display. "Who is in
 * this space" is what the card prints; "whose row is this" is what a CLEAR has
 * to name, and sending the card's own id for an inherited write-in would
 * delete nothing at all — the room has no row. Keeping them apart is also what
 * left every existing reader of the occupant untouched.
 */
export function writeInSource(unit: LodgingUnitRow): WriteInSource | null {
  const cover = coveringWriteIn(unit)
  if (cover === null) return null
  const unitCode = cover.unit_code ?? ''
  return {
    unitId: cover.unit_id ?? '',
    unitCode,
    unitName: cover.unit_name ?? '',
    isOwn: unitCode === unit.code,
  }
}

/**
 * The server-resolved cover, and NOTHING else.
 *
 * ## Why the old fallback is gone rather than merely unused
 *
 * This used to synthesise a cover from `unit.family_available_override ===
 * false` plus the unit's own `occupant_name`, for a payload from a server older
 * than `write_in_covers`. That fallback was safe only while `false` MEANT an
 * occupancy — which it did, because the wire spelled one that way as a compat
 * shim while kindred#2382 was landing in four parts.
 *
 * PR 4 retired the shim. `family_available_override` now answers the
 * staff↔family ROLE alone, so a `false` is "closed by role" and names nobody:
 * reading it here would report an occupant the cabin does not have, on a card
 * whose whole job is to say who is in the room. A permissive default is the
 * usual danger (`shareabilityBadge` makes that argument at its own), but a
 * fabricated occupant is not the conservative answer — it is a different wrong
 * one, and it would also block placement into a cabin that is merely closed.
 *
 * There is no gap left to guard. `write_in` is built for every unit the API
 * returns, and a unit with neither a cover nor a role row is simply open.
 */
function coveringWriteIn(unit: LodgingUnitRow): WriteInCoverRow | null {
  return unit.write_in ?? null
}
