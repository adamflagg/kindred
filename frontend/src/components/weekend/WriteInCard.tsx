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
 *   - Two rows whose occupants are named alike, or both unnamed (`UNNAMED_OCCUPANT`
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

import { PARTY_SIZE_CHOICES, writeInOccupantLabel, type WriteInOccupant } from './writeIn'

/** `FamilyCard`'s `CARD_FRAME`, verbatim. Pinned by this module's test. */
export const WRITE_IN_FRAME =
  'group border-border flex w-full flex-col gap-1 rounded-xl border-2 p-2.5 text-left'

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
   * Save an edit to THIS write-in's occupant name, note, and party size —
   * kindred#2430, and kindred#2503 for the count.
   *
   * NO ID, for the same reason `onRemove` takes none: the card knows which
   * row it draws and the caller binds the target, so there is exactly one
   * place that has to agree about which of the well's rows this is. Omitted
   * for a reader who cannot edit, which hides the pencil rather than a
   * second permission flag here.
   *
   * `partySize` is ALWAYS a real answer, never a "didn't ask" placeholder:
   * `null` when the People field is blank (wholesale, or untouched from a
   * row that already had no count) and the row's own recorded count when
   * the field was left alone. The caller — `LodgingUnitCard.tsx`'s `onEdit`
   * handler — forwards this value verbatim rather than re-deriving it from
   * the row, which is what makes "save without touching People" and "clear
   * People to blank" distinguishable on the wire.
   */
  onEdit?: (write: { occupantName: string; reason: string; partySize: number | null }) => void
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
  const label = writeInOccupantLabel(occupant)

  // Local to this card, never lifted: the well can hold several of these and
  // each edits independently. Re-seeded from `occupant` every time the form
  // OPENS (not on every render) so a cancelled edit's draft never survives to
  // the next open — see `openEdit`.
  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(occupant.name)
  const [draftNote, setDraftNote] = useState(occupant.note)
  // Seeded as a STRING, matching `AssignFamilyModal`'s `people` state — empty
  // when `occupant.partySize` is `null`, otherwise the count printed as text.
  // A STRING because that is what a `<select>` value is, and `''` is the blank
  // option; `draftPartySize` below turns it back into the number it means.
  const [draftPeople, setDraftPeople] = useState(
    occupant.partySize === null ? '' : String(occupant.partySize)
  )
  const [wantsName, setWantsName] = useState(false)

  const openEdit = () => {
    setDraftName(occupant.name)
    setDraftNote(occupant.note)
    setDraftPeople(occupant.partySize === null ? '' : String(occupant.partySize))
    setWantsName(false)
    setIsEditing(true)
  }
  const closeEdit = () => {
    setIsEditing(false)
    setWantsName(false)
  }

  // OPTIONAL, exactly as the Assign modal's write-in form (owner ruling
  // 2026-08-21): blank is a complete answer meaning the write-in takes the
  // room wholesale, and Save is not gated on it.
  //
  // TOTAL, with no parse to fail (owner ruling 2026-08-23). `draftPeople` is a
  // `<select>` value, so it is either `''` or one of `PARTY_SIZE_CHOICES`
  // rendered by `String(...)` -- `Number(...)` cannot return `NaN` here, and
  // the `Number.isInteger` / `>= 1` / `validity.badInput` checks that used to
  // stand around it are gone WITH the number input rather than relaxed
  // against it. See `PARTY_SIZE_CHOICES` in `writeIn.ts` for why the control
  // changed and what it makes unreachable.
  const draftPartySize = draftPeople === '' ? null : Number(draftPeople)

  // Shared by the form's own `onSubmit` (Save, or Enter from Occupant/Note)
  // and the People field's `onKeyDown` below. `fireEvent.keyDown` in jsdom
  // does not trigger native implicit form submission the way a real Enter
  // keypress does in a browser, so People needs an explicit call site rather
  // than relying on the surrounding `<form>` — the same reason
  // `AssignFamilyModal`'s own People field carries an explicit handler
  // (weekend-card-vocabulary.md §6: Enter saves from a field).
  const trySubmit = () => {
    const trimmedName = draftName.trim()
    // THE SAME GUARD THE ASSIGN MODAL'S WRITE-IN OFFER USES (`offersWriteIn`,
    // which requires a non-empty trimmed name): a write-in that names nobody
    // is a valid state a legacy row can already be in, but an edit that
    // CLEARS a name is a staff member erasing who is in the room, which is
    // worth a refusal rather than a silent write.
    //
    // It named `UnitAvailabilityControl`'s occupant prompt until that
    // control was cut (kindred#2072 stage 3, vocabulary §3). The rule
    // outlived the control; the modal is where it lives now.
    if (trimmedName === '') {
      setWantsName(true)
      return
    }
    onEdit?.({ occupantName: trimmedName, reason: draftNote.trim(), partySize: draftPartySize })
    closeEdit()
  }

  if (isEditing) {
    return (
      <div data-write-in-card className={`${WRITE_IN_FRAME} bg-background`}>
        <form
          className="flex w-full flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            trySubmit()
          }}
        >
          <input
            type="text"
            aria-label="Occupant"
            // THE SAME PLACEHOLDER SHAPE the Assign modal's write-in form
            // uses — a name, then an optional note. (It named
            // `UnitAvailabilityControl`'s occupant prompt until that control
            // was cut; see the guard above.) Not decoration on the second
            // box: 1500000148 cleared the note of every row it moved, so an
            // edit opened on any pre-existing write-in shows an empty,
            // otherwise unlabelled input under the name.
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
          {/* ONE ROW, People then Note (owner ruling 2026-08-23), mirroring
              `AssignFamilyModal`'s write-in form exactly -- same control, same
              order, same list. OPTIONAL exactly as there (owner ruling
              2026-08-21): blank means the write-in takes the room wholesale,
              and Save is not gated on it.

              NO VISIBLE LABELS, unlike the modal: this form is a compact card
              in a board slot, and the two controls carry `aria-label` as test
              handles the way the occupant field above them already does
              (frontend/CLAUDE.md -- that is test infrastructure here, not an
              accessibility affordance). The select's blank option reads as the
              same em dash the card draws for an unsized write-in. */}
          <div data-testid="write-in-edit-fields" className="flex items-center gap-1.5">
            <select
              aria-label="People"
              value={draftPeople}
              disabled={isSaving}
              onChange={(event) => {
                setDraftPeople(event.target.value)
              }}
              onKeyDown={(event) => {
                // ↵ SAVES FROM A FIELD (weekend-card-vocabulary.md §6). Native
                // form submission on Enter is not reliable under
                // `fireEvent.keyDown` in jsdom, so this calls the same
                // `trySubmit` the form's `onSubmit` calls, rather than relying
                // on the surrounding `<form>` alone.
                if (event.key !== 'Enter') return
                event.preventDefault()
                trySubmit()
              }}
              className="border-border bg-background text-foreground focus:border-primary/50 focus:ring-primary/10 w-[4.25rem] shrink-0 rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none"
            >
              <option value="">—</option>
              {PARTY_SIZE_CHOICES.map((count) => (
                <option key={count} value={String(count)}>
                  {count}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Note (optional)"
              placeholder="Note (optional) — back Monday…"
              value={draftNote}
              maxLength={500}
              onChange={(event) => {
                setDraftNote(event.target.value)
              }}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 min-w-0 flex-1 rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
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
