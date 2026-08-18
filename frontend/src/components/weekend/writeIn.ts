/**
 * A write-in: a named occupant the system does not know about — kindred#2078.
 *
 * Owner ruling, 2026-08-09: *"only one, hold is the write in"*. Staff never
 * used Hold to reserve an empty room. They used it to record somebody sleeping
 * in one — almost always non-rostered weekend staff — so the room read as
 * *empty and closed* when in truth it was *full*. There is ONE control and one
 * action; the occupant name is what the row was always for.
 *
 * ## Why this is a module and not an inline `=== false`
 *
 * The board already had that expression, spelled `held`, in three places. One
 * of them was load-bearing in a way a rename would have silently broken:
 * #2093's forest open-tint suppresses itself on a written-into room, and it did
 * so by testing `unit.family_available_override === false` — a PROXY for "is
 * somebody in it". Reading the fact through one named function is what keeps
 * the tint keyed on the fact rather than on a spelling.
 *
 * ## What is deliberately NOT here
 *
 * No fallback from `name` to `note`. 1500000148 moved every historical note
 * into `occupant_name` and cleared the column behind it, because the same
 * string rendered as both the occupant's NAME and the card's italic reason line
 * printed twice on one card. A fallback would restore that by another route.
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
 * The occupant written into this unit for this weekend, or `null` if none.
 *
 * `=== false`, never truthiness: `null` means "no availability row for this
 * weekend, so the unit's role decides" and `true` means "a staff cabin opened
 * to families" — a release names no occupant. Collapsing any of the three into
 * the others is the failure `reservationBadge` documents at length.
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
 * The server-resolved cover, else this unit's OWN row synthesised as one.
 *
 * ## Why the fallback is not a code smell
 *
 * `write_in` is resolved server-side (`write_in_covers`) and is present on
 * every unit the current API builds, so in practice the second branch only
 * fires for a payload from an older server — Pydantic fields with a default
 * render OPTIONAL in TypeScript, so the key simply arrives missing.
 *
 * The direction of the fallback is the point. Reading a missing cover as
 * "nobody is in it" would OPEN a cabin the row says is closed and invite a
 * drop into an occupied room, which is the precise failure the cover exists to
 * prevent. `shareabilityBadge` makes the same argument at its own default: on
 * missing evidence the only wrong answer is a permissive one.
 */
function coveringWriteIn(unit: LodgingUnitRow): WriteInCoverRow | null {
  const cover = unit.write_in
  if (cover !== null && cover !== undefined) return cover
  if (unit.family_available_override !== false) return null
  return {
    unit_id: unit.unit_id,
    unit_code: unit.code,
    unit_name: unit.name,
    occupant_name: unit.occupant_name ?? '',
    note: unit.reason ?? '',
  }
}
