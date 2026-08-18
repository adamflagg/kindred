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
 *
 * ## The name wraps, kindred#2431
 *
 * Owner ruling, 2026-08-18, following the #2253 precedent
 * (`HouseholdJourneyCard.tsx`'s housing span): a truncated name is not a
 * shorter name, it is a different one — two write-ins that share a prefix
 * would render identically. `min-w-0` stays on the span even though
 * `truncate` is gone: it is what lets the flex child shrink below its
 * content width, which is what makes it wrap rather than push the card
 * wider than its well.
 *
 * A DELIBERATE divergence from summer, per the root CLAUDE.md §4 rule:
 * summer's direct analog still truncates (`camper/CampJourneyTimeline.tsx`,
 * the `record.bunkName` span), because a cabin callsign is a short,
 * fixed-format string with nothing meaningful to lose to an ellipsis. A
 * write-in's occupant name is staff-typed free text with no alias or
 * display-name convention to fall back on — the same argument #2253 made
 * for a housing name, stronger here because there is no shorter form at all.
 *
 * ## WHOSE row it is, printed when it is not this card's own
 *
 * Restored during review of kindred#2381 after being deleted with it. The
 * line had TWO reasons in the code that carried it and only one of them —
 * "go and find the Clear on the card the merge took away" — died with the
 * per-card X. The other is identity, and the plural well makes it sharper
 * rather than redundant:
 *
 *   - MERGE. The one 2026 container carrying four write-ins holds them on
 *     four different rooms — a loft, a side room, a back room and a laundry.
 *     Four names in one well with no room beside them does not tell a staff
 *     member where anybody is sleeping.
 *   - SPLIT. Split a written-into building and every room draws a card for
 *     the SAME row. Without this line each room asserts its own row names
 *     that person, and each card's X — all of them pointed at the one
 *     building row — empties all the others too, with nothing on screen
 *     saying why.
 *   - Two rows whose occupants are named alike, or both unnamed (`UNNAMED`
 *     below is a state a legacy row can be in), otherwise render as two
 *     identical cards. That is the same objection kindred#2431 above makes
 *     to truncating a name, one card over.
 *
 * Undefined on the card whose own row it is, which is the overwhelmingly
 * common case — a line restating the card's own name on every written-into
 * card is chrome staff learn to read past.
 *
 * ## The edit control, kindred#2430
 *
 * Owner ruling, 2026-08-18 (supersedes an earlier same-day HOLD): a small
 * pencil, ALWAYS VISIBLE, beside the X — not hover-only (the reported
 * problem was that staff could not FIND an edit path, so a control that
 * only appears on hover does not fix it) and not click-the-card (which
 * would reverse the "deliberately NOT a `FamilyCard`" decision above). It
 * opens an inline form, pre-filled from this row, and writes back through
 * the same `onSetAvailability` channel `onRemove` already uses — no API
 * change: `set_availability` upserts a write-in
 * (`_upsert_row(what='write-in', ...)` in
 * `api/services/lodging_write_service.py`), so a second write to the same
 * row updates it rather than duplicating it.
 */
import { Pencil } from 'lucide-react'
import { useState } from 'react'

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
  /**
   * Save an edit to THIS write-in's occupant name and note — kindred#2430.
   *
   * NO ID, for the same reason `onRemove` takes none: the card knows which
   * row it draws and the caller binds the target, so there is exactly one
   * place that has to agree about which of the well's rows this is. Omitted
   * for a reader who cannot edit, which hides the pencil rather than a
   * second permission flag here.
   */
  onEdit?: (write: { occupantName: string; reason: string }) => void
  /**
   * True while a write this card's controls are waiting on is in flight.
   *
   * Card-level rather than row-level at the only caller: `LodgingBoard` knows
   * one `pendingUnitId` and `LodgingUnitCard` passes the same answer to every
   * `WriteInCard` in its well, so a write to one row disables the corner
   * controls on all of them. Deliberately the conservative direction — the
   * alternative leaves an X live beside a row that is already going away.
   */
  isSaving?: boolean
}

export function WriteInCard({ occupant, onRemove, onEdit, isSaving = false }: WriteInCardProps) {
  const named = occupant.name !== ''
  const label = named ? occupant.name : UNNAMED

  // Local to this card, never lifted: the well can hold several of these and
  // each edits independently. Re-seeded from `occupant` every time the form
  // OPENS (not on every render) so a cancelled edit's draft never survives to
  // the next open — see `openEdit`.
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(occupant.name)
  const [draftNote, setDraftNote] = useState(occupant.note)
  const [wantsName, setWantsName] = useState(false)

  const openEdit = () => {
    setDraftName(occupant.name)
    setDraftNote(occupant.note)
    setWantsName(false)
    setIsEditing(true)
  }
  const closeEdit = () => {
    setIsEditing(false)
    setWantsName(false)
  }

  if (isEditing) {
    return (
      <div data-write-in-card className={`${WRITE_IN_FRAME} bg-background`}>
        <form
          className="flex w-full flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmedName = draftName.trim()
            // THE SAME GUARD `UnitAvailabilityControl`'s occupant prompt
            // uses: a write-in that names nobody is a valid state a legacy
            // row can already be in, but an edit that CLEARS a name is a
            // staff member erasing who is in the room, which is worth a
            // refusal rather than a silent write.
            if (trimmedName === '') {
              setWantsName(true)
              return
            }
            onEdit?.({ occupantName: trimmedName, reason: draftNote.trim() })
            closeEdit()
          }}
        >
          <input
            type="text"
            aria-label="Occupant"
            // THE SAME PLACEHOLDERS `UnitAvailabilityControl`'s occupant
            // prompt uses. Not decoration on the second box: 1500000148
            // cleared the note of every row it moved, so an edit opened on
            // any pre-existing write-in shows an empty, otherwise unlabelled
            // input under the name.
            placeholder="Emma Johnson, burst pipe…"
            value={draftName}
            maxLength={500}
            autoFocus
            aria-invalid={wantsName && draftName.trim() === ''}
            onChange={(event) => {
              setDraftName(event.target.value)
              setWantsName(false)
            }}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none aria-[invalid=true]:border-amber-500"
          />
          <input
            type="text"
            aria-label="Note (optional)"
            placeholder="Note (optional) — back Monday…"
            value={draftNote}
            maxLength={500}
            onChange={(event) => {
              setDraftNote(event.target.value)
            }}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none"
          />
          {wantsName && draftName.trim() === '' && (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Say who is in it, so next week’s staff know who to ask.
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={isSaving}
              className="bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs font-medium disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={closeEdit}
              className="text-muted-foreground hover:text-foreground rounded-md px-1.5 py-0.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div data-write-in-card className={`${WRITE_IN_FRAME} bg-background`}>
      {/* The name line and the corner controls, in `FamilyCard`'s own flex row
          — which this card used to drop because it had no party-size badge to
          share it with. It has a control to share it with now. */}
      <div className="flex items-start gap-1">
        <span
          className={
            named
              ? 'text-foreground min-w-0 flex-1 text-sm leading-tight font-semibold'
              : 'text-muted-foreground min-w-0 flex-1 text-sm leading-tight italic'
          }
        >
          {/* STATED, not left blank. A row can reach here unnamed — the write
              schema is permissive where the control is not, and a pre-1500000148
              row with an empty note backfilled to nothing — and an empty card in
              a closed room reads as an open room the board mysteriously refuses
              drops on. */}
          {label}
        </span>
        {onEdit !== undefined && (
          <button
            type="button"
            disabled={isSaving}
            // NAMED FOR THE OCCUPANT, same reason as the X below: four edit
            // controls called "Edit" on one merged card are one question
            // asked four times.
            aria-label={`Edit write-in ${label}`}
            onClick={openEdit}
            className="text-muted-foreground hover:text-foreground hover:border-foreground/30 border-border flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[11px] leading-none disabled:opacity-40"
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
        )}
        {onRemove !== undefined && (
          <button
            type="button"
            disabled={isSaving}
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
      {/* NO "Written in at …" LINE — struck by the owner, 2026-08-18.
          It said WHERE the row lives, for a merged well holding several
          occupants from several rooms. The room dimension is real and still
          worth showing; what was wrong was showing it once per write-in card
          and nowhere else, so a merged building explained its write-ins' rooms
          while saying nothing about its FAMILIES' rooms. That belongs to one
          shorthand covering every occupant of a merged card — filed as
          kindred#2458 — and this line was the half-built version of it. */}
    </div>
  )
}
