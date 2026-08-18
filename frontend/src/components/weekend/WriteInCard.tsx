/**
 * A write-in, drawn in the unit's occupant well — kindred#2078, kindred#2381.
 *
 * Owner ruling, 2026-08-09: a hold IS a write-in. What the row records is a
 * person sleeping in the room, almost always non-rostered weekend staff, and
 * until now that person appeared as a small italic muted line under the badge
 * row while the well below said "Drop families here". The room read as *empty
 * and closed* when in truth it was *full*. This is the same fact, printed
 * where the board prints occupancy.
 *
 * ## ONE CARD PER WRITE-IN, and the well may hold several
 *
 * A merged container draws in place of its rooms, so every write-in beneath it
 * lands here (kindred#2381). Each card is one row, and its corner control
 * removes that row and no other — which is what makes the plural well safe.
 * The single "Clear Write-in" button it replaces named whichever row the
 * server resolved first, so on the one 2026 building carrying four write-ins a
 * click removed one, the card silently re-populated with the next occupant,
 * and four clicks destroyed four rows while the board never disclosed that
 * more than one existed.
 *
 * ## Deliberately NOT a `FamilyCard`
 *
 * It wears `FamilyCard`'s frame, and none of its behaviour:
 *
 *   - no `data-family-card`. Board code queries that selector to find PLACED
 *     parties; a write-in is an occupant, not a placement, and marking it would
 *     count a family in a room no family is in.
 *   - no `useDraggable`, and THE CARD ITSELF is not a `<button>`. There is no
 *     family panel behind a write-in and nowhere to drag it to, and a card that
 *     looks interactive and is not is worse than plain text. That reasoning
 *     survives kindred#2381 intact and is why the removal is a discrete corner
 *     control rather than "click the card": the card body stays inert, and the
 *     things that are interactive are visibly buttons. #2430's edit control
 *     joins this one in the same corner, for the same reason.
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

/** What a card prints when the row named nobody. Also the removal's handle. */
const UNNAMED = 'Occupant not named'

export interface WriteInCardProps {
  occupant: WriteInOccupant
  /**
   * Remove THIS write-in — omitted for a reader who cannot, which is what
   * hides the control rather than a second permission flag here.
   *
   * NO ARGUMENT. The card knows which of the well's rows it draws and the
   * caller binds the target, so there is exactly one place that has to agree
   * about which row a corner X belongs to. Passing an id up would make two.
   */
  onRemove?: () => void
  /** True while THIS card's removal is in flight. */
  isRemoving?: boolean
}

export function WriteInCard({ occupant, onRemove, isRemoving = false }: WriteInCardProps) {
  const named = occupant.name !== ''
  const label = named ? occupant.name : UNNAMED

  return (
    <div data-write-in-card className={`${WRITE_IN_FRAME} bg-background`}>
      {/* The name line and the corner controls, in `FamilyCard`'s own flex row
          — which this card used to drop because it had no party-size badge to
          share it with. It has a control to share it with now. */}
      <div className="flex items-start gap-1">
        <span
          className={
            named
              ? 'text-foreground min-w-0 flex-1 truncate text-sm leading-tight font-semibold'
              : 'text-muted-foreground min-w-0 flex-1 truncate text-sm leading-tight italic'
          }
        >
          {/* STATED, not left blank. A row can reach here unnamed — the write
              schema is permissive where the control is not, and a pre-1500000148
              row with an empty note backfilled to nothing — and an empty card in
              a closed room reads as an open room the board mysteriously refuses
              drops on. */}
          {label}
        </span>
        {onRemove !== undefined && (
          <button
            type="button"
            disabled={isRemoving}
            // NAMED FOR THE OCCUPANT, not a bare "Remove". A merged building's
            // well can hold four of these, and four controls called the same
            // thing are one question asked four times. (`aria-label` here is a
            // test query handle — see frontend/CLAUDE.md on how minimal this
            // repo's accessibility is meant to be.)
            aria-label={`Remove write-in ${label}`}
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground hover:border-foreground/30 border-border flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[11px] leading-none disabled:opacity-40"
          >
            {/* MULTIPLICATION SIGN, not the letter x — the glyph the rest of
                the board's dismissals use. */}
            ×
          </button>
        )}
      </div>
      {occupant.note !== '' && (
        // INSIDE the card, where the old italic line sat above it: the note
        // describes the occupant, not the room. Empty on every historical row
        // by construction (1500000148 cleared each note it copied), so this
        // renders nothing at all until a write-in is recorded from that
        // migration onward. That emptiness is correct, not a bug.
        <span className="text-muted-foreground text-xs leading-tight">{occupant.note}</span>
      )}
      {/* NO "Written in at …" FOOTER. It told a reader the row lives on a unit
          other than the card drawing it, which was worth saying only while a
          merged card showed ONE write-in and hid the rest — the note existed to
          send staff to the Clear on a card the merge had taken away. Every
          write-in is drawn now and each carries its own removal, so the line
          would restate what the reader can see. Deleted with its prop
          (kindred#2381), so nothing can pass one in by habit. */}
    </div>
  )
}
