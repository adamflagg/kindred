/**
 * A write-in, drawn in the unit's occupant well — kindred#2078.
 *
 * Owner ruling, 2026-08-09: a hold IS a write-in. What the row records is a
 * person sleeping in the room, almost always non-rostered weekend staff, and
 * until now that person appeared as a small italic muted line under the badge
 * row while the well below said "Drop families here". The room read as *empty
 * and closed* when in truth it was *full*. This is the same fact, printed
 * where the board prints occupancy.
 *
 * ## Deliberately NOT a `FamilyCard`
 *
 * It wears `FamilyCard`'s frame, and none of its behaviour:
 *
 *   - no `data-family-card`. Board code queries that selector to find PLACED
 *     parties; a write-in is an occupant, not a placement, and marking it would
 *     count a family in a room no family is in.
 *   - no `useDraggable`, and not a `<button>`. There is no family panel behind
 *     a write-in and nowhere to drag it to, and a control that looks
 *     interactive and is not is worse than plain text.
 *   - no party-size figure and no chip row. A write-in is a name; nothing else
 *     is known, and a `0` beside it would assert something.
 *
 * ## Why the frame is restated rather than imported
 *
 * `CARD_FRAME` is module-private to `FamilyCard.tsx`, and that file is owned by
 * a sibling change in flight, so exporting it here would be an edit to somebody
 * else's file. `WriteInCard.test.tsx` reads the literal out of `FamilyCard.tsx`
 * and asserts the two are identical, which makes the copy loud instead of a
 * silent drift waiting to happen.
 */
import type { WriteInOccupant } from './writeIn'

/** `FamilyCard`'s `CARD_FRAME`, verbatim. Pinned by this module's test. */
export const WRITE_IN_FRAME =
  'group border-border flex w-full flex-col gap-1 rounded-xl border-2 p-2.5 text-left'

export interface WriteInCardProps {
  occupant: WriteInOccupant
}

export function WriteInCard({ occupant }: WriteInCardProps) {
  const named = occupant.name !== ''

  return (
    <div data-write-in-card className={`${WRITE_IN_FRAME} bg-background`}>
      <span
        // `FamilyCard`'s own name line, minus the flex row it shares with a
        // party-size badge this card does not have.
        className={
          named
            ? 'text-foreground min-w-0 truncate text-sm leading-tight font-semibold'
            : 'text-muted-foreground min-w-0 truncate text-sm leading-tight italic'
        }
      >
        {/* STATED, not left blank. A row can reach here unnamed — the write
            schema is permissive where the control is not, and a pre-1500000148
            row with an empty note backfilled to nothing — and an empty card in
            a closed room reads as an open room the board mysteriously refuses
            drops on. */}
        {named ? occupant.name : 'Occupant not named'}
      </span>
      {occupant.note !== '' && (
        // INSIDE the card, where the old italic line sat above it: the note
        // describes the occupant, not the room. Empty on every historical row
        // by construction (1500000148 cleared each note it copied), so this
        // renders nothing at all until a write-in is recorded from that
        // migration onward. That emptiness is correct, not a bug.
        <span className="text-muted-foreground text-xs leading-tight">{occupant.note}</span>
      )}
    </div>
  )
}
