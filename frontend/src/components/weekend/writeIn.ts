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
 * answers the ROLE alone, and `write_ins` answers this one.
 *
 * ## What is deliberately NOT here
 *
 * No fallback from `name` to `note`. 1500000148 moved every historical note
 * into `occupant_name` and cleared the column behind it, because the same
 * string rendered as both the occupant's NAME and the card's italic reason line
 * printed twice on one card. A fallback would restore that by another route.
 *
 * No fallback from `write_ins` to `family_available_override === false` either,
 * and that one was deliberately removed rather than never written — see
 * `coveringWriteIns`.
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
 * WHO is in this space and WHOSE row says so, kept together — one entry per
 * write-in covering the unit.
 *
 * A PAIR rather than two functions returning two arrays, which is what this
 * was until kindred#2381 (`writeInOccupant` / `writeInSource`). Splitting them
 * was right while there was exactly one cover: "who is in this space" is what
 * the card prints and "whose row is this" is what a CLEAR has to name, and
 * sending the card's own id for an inherited write-in would delete nothing at
 * all. With N covers on one card the two answers have to stay lined up — the X
 * drawn on the third card must delete the THIRD row — and index alignment held
 * by hand across two arrays is the invariant that rots first.
 */
export interface WriteInEntry {
  occupant: WriteInOccupant
  source: WriteInSource
}

/**
 * Where a unit's write-in is recorded.
 *
 * A room can inherit its building's row and a merged building one of its
 * rooms', so this is not always the unit the card draws.
 */
export interface WriteInSource {
  /** The unit the `lodging_write_ins` row belongs to — a removal's target. */
  unitId: string
  unitCode: string
  unitName: string
  /** Whether the row is this unit's own, rather than inherited through the tree. */
  isOwn: boolean
}

/**
 * Every write-in closing this space for this weekend, in the server's order.
 *
 * "This space", not "this unit": a building's write-in closes its rooms and a
 * room's closes its building as a whole-house let, and the board draws
 * whichever level the unit tree resolves to. The server does that walk
 * (`write_in_covers`) and this reads its answer.
 *
 * PLURAL since kindred#2381, and the arity is the fix rather than a
 * generalisation. A merged container stands in for its rooms, so the four
 * write-ins one 2026 building carries in a single weekend all land on one
 * card — and returning the first hid three occupants while making each clear
 * read as a failed click, because the card immediately re-populated with the
 * next name. An assignment survives a merge and a split by having the drawn
 * card carry however many leaves it covers; this is a write-in doing the same.
 *
 * ORDERED BY THE SERVER (`code` at every level), never re-sorted here: two
 * places deciding the sequence is two places that can disagree about it.
 */
export function writeInEntries(unit: LodgingUnitRow): WriteInEntry[] {
  return coveringWriteIns(unit).map((cover) => {
    const unitCode = cover.unit_code ?? ''
    return {
      occupant: {
        name: (cover.occupant_name ?? '').trim(),
        note: (cover.note ?? '').trim(),
      },
      source: {
        unitId: cover.unit_id ?? '',
        unitCode,
        unitName: cover.unit_name ?? '',
        isOwn: unitCode === unit.code,
      },
    }
  })
}

/**
 * Whether ANY write-in closes this space.
 *
 * The gate every consumer that only needs the yes/no reads — the drop refusal
 * (`dragPlacement`), its affordance half on the card, and the "Write-in" chip.
 * Spelled once so a merged card covering four occupants and a room covering
 * one are the same answer to those three, which `!== null` on a single cover
 * silently stopped being.
 */
export function hasWriteIn(unit: LodgingUnitRow): boolean {
  return coveringWriteIns(unit).length > 0
}

/**
 * The server-resolved covers, and NOTHING else.
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
 * There is no gap left to guard. `write_ins` is built for every unit the API
 * returns, and a unit with neither a cover nor a role row is simply open. The
 * `?? []` is for the FIELD being absent from an older payload, not for a unit
 * the walk declined to answer for.
 */
function coveringWriteIns(unit: LodgingUnitRow): WriteInCoverRow[] {
  return unit.write_ins ?? []
}
