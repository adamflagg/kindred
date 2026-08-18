/**
 * Writing somebody into a cabin for a weekend, or releasing one to families.
 *
 * `PUT /api/lodging/availability` shipped with no caller: the request model
 * required a scenario nobody could supply, so nothing wrote the table. Landing
 * the model with no writer is how it drifted, so this is the writer.
 *
 * ## ONE control, and hold IS the write-in
 *
 * Owner ruling, 2026-08-09 (kindred#2078). Staff never used this to reserve an
 * empty room — they used it to record somebody sleeping in one, almost always
 * non-rostered weekend staff — so "Hold" set the opposite expectation and the
 * card read *empty and closed* for a room that was full.
 *
 * There is no second "mark unavailable" action beside it and no burst-pipe /
 * staff-write-in split. A staff member who types "burst pipe" into the occupant
 * field gets a card showing an occupant called "burst pipe": an ACCEPTED COST,
 * ruled on, not worth a second concept or a discriminator column to prevent.
 *
 * `family_available` still has three reachable outcomes and a unit is always in
 * exactly one of them, so `availabilityAction` resolves the single action this
 * card can offer and the button IS the gate — no modal carrying its own
 * eligibility logic. Writing a value that AGREES with the unit's role is
 * deliberately unreachable: it would pin the unit against a later registry edit
 * while changing nothing staff can see.
 *
 * ## Two inputs, and which one is required depends on the action
 *
 * A write-in asks for a REQUIRED occupant and an OPTIONAL note. A release asks
 * for a required reason and nothing else — opening a staff cabin to families
 * names no occupant. That is why `availabilityAction` carries a three-way
 * `prompt` rather than the `needsReason` boolean it used to: the question is
 * not *whether* to ask but *what for*.
 *
 * ## Why the requirement lives here and not at the schema
 *
 * Both fields are `Field("", max_length=500)` server-side, because a row
 * written by an ingest or a fixture has no author to ask. Through this control
 * there is always an author, and a closed cabin with nobody named on it is the
 * row a staff member cannot act on next week — they can see it is unavailable
 * and have no way to learn who is in it. Clearing asks for neither: it restores
 * the unit's standing role rather than asserting anything.
 *
 * ## What this control no longer does
 *
 * REMOVE A WRITE-IN. Until kindred#2381 it offered a "Clear Write-in" naming
 * whichever row the server resolved first, which held only while a card could
 * carry one. A merged container covers every write-in beneath it, so one
 * button had four rows to choose from and picked silently: each click removed
 * the row it named, the card re-populated with the next occupant, and the
 * action read as a no-op while it worked through them. Removal is the X on
 * each `WriteInCard` now, and `availabilityAction` returns null for a
 * written-into space rather than a clear this control could offer.
 *
 * ## Why no italic line under the badge row any more
 *
 * It used to print `unit.reason` there for every override. Since kindred#2078 a
 * write-in draws a `WriteInCard` in the unit's well carrying both the occupant
 * and the note, so printing the note here too would put the identical string
 * twice on one card — the double-print 1500000148 was written to unwind. The
 * line survives for the RELEASE branch alone, which draws no card in the well
 * and so has nowhere else for its reason to be read.
 */
import { useState } from 'react'

import type { LodgingUnitRow } from '../../types/lodging'
import { availabilityAction } from './unitBadges'

export interface UnitAvailabilityWrite {
  /**
   * The unit the write NAMES, which is not always the card it came from.
   *
   * A write-in covers a space and the board draws whichever level the unit
   * tree resolves to, so a room can inherit its building's write-in and a
   * merged building one of its rooms'. Removing one has to target the unit
   * that HOLDS the row — the card's own id would delete nothing, and the unit
   * holding the row has no card of its own.
   *
   * TWO CALLERS SINCE kindred#2381, and only one of them is this control.
   * `availabilityAction` resolves a ROLE row and always names the card's own
   * unit; each `WriteInCard`'s corner X sends this same write bound to the row
   * that card draws. The field carries the target either way.
   */
  unitId: string
  /** That unit's name, for the confirmation toast. */
  unitName: string
  familyAvailable: boolean | null
  /** Who is in the room. `''` on a release and on a clear. */
  occupantName: string
  /** Optional beside a write-in; required on a release. `''` on a clear. */
  reason: string
}

export interface UnitAvailabilityControlProps {
  unit: LodgingUnitRow
  /**
   * `bunking.manage`, with a weekend selected.
   *
   * NOT the board's `canPlace`, which also requires a scenario. This write
   * CARRIES one and never requires one, which is a different rule dressed in
   * the same word (kindred#2382 PR 4): blank is the LIVE board, a scope in its
   * own right, so gating on a selected scenario would leave staff looking at
   * the CampMinder mirror — which is where most of them look — unable to
   * record a write-in at all.
   *
   * The premise here used to be "availability carries no scenario since
   * 1500000135". Half of that survives: the staff↔family ROLE is still a fact
   * about the weekend. The OCCUPANCY half is scenario-scoped now and lands on
   * the board it was made on — see `useUnitAvailability`.
   */
  canManage: boolean
  /**
   * Whether the slot this unit sits in already holds a party this scenario —
   * a fact read off the CARD, never off availability itself. Owner ruling on
   * #2090: a write-in and a placement are mutually exclusive states, so an
   * occupied unit offers no write-in action. Kept separate from `canManage`:
   * folding occupancy into the permission gate would resurrect the scenario
   * dimension 1500000135 deleted.
   */
  occupied: boolean
  /** True while THIS unit's write is in flight. */
  isSaving: boolean
  onSubmit: (write: UnitAvailabilityWrite) => void
}

export function UnitAvailabilityControl({
  unit,
  canManage,
  occupied,
  isSaving,
  onSubmit,
}: UnitAvailabilityControlProps) {
  // The REQUIRED field of whichever prompt is showing — an occupant for a
  // write-in, a reason for a release. One piece of state, because exactly one
  // of the two is ever mounted and a second would be dead on every render.
  const [required, setRequired] = useState('')
  // The optional note, mounted only by the write-in prompt.
  const [note, setNote] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [wantsRequired, setWantsRequired] = useState(false)
  const action = availabilityAction(unit, occupied)

  const close = () => {
    setIsOpen(false)
    setWantsRequired(false)
    // Cleared on the way out, not on the way in: an entry left over from an
    // abandoned edit is how one cabin's occupant ends up written into another.
    setRequired('')
    setNote('')
  }

  // Shown to everyone, including a reader without `bunking.manage`. Knowing a
  // staff cabin was opened to families is not a write, and the staff member
  // who needs it most may not hold the permission.
  //
  // RELEASE ONLY (kindred#2078). A write-in's note rides inside its occupant
  // card in the well; repeating it here would print one string twice on one
  // card.
  const storedReason = unit.reason ?? ''
  const explanation =
    unit.family_available_override === true && storedReason !== '' ? (
      <span className="text-muted-foreground w-full text-sm italic">{storedReason}</span>
    ) : null

  if (action === null || !canManage) return explanation

  if (isOpen && action.prompt !== 'none') {
    const askingOccupant = action.prompt === 'occupant'
    const requiredLabel = askingOccupant ? 'Occupant' : 'Reason'
    const refusal = askingOccupant
      ? 'Say who is in it, so next week’s staff know who to ask.'
      : 'Say why, so next week’s staff can act on it.'

    return (
      <>
        {explanation}
        <form
          className="flex w-full flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = required.trim()
            // The ONLY place an empty required field is refused. The submit
            // button is deliberately NOT disabled while the box is empty: a
            // disabled button plus a guard here mask each other — deleting
            // either leaves the other quietly holding the rule, so a test can
            // pin neither, which is exactly what a surviving mutation caught.
            // An inert button also explains nothing to the staff member
            // wondering why their click did nothing.
            if (trimmed === '') {
              setWantsRequired(true)
              return
            }
            onSubmit({
              unitId: action.unitId,
              unitName: action.unitName,
              familyAvailable: action.familyAvailable,
              // The note NEVER stands in for the occupant, and the occupant
              // never doubles as the note: two fields, two facts. Collapsing
              // them is the state 1500000148 spent two guarded statements
              // unwinding.
              occupantName: askingOccupant ? trimmed : '',
              reason: askingOccupant ? note.trim() : trimmed,
            })
            close()
          }}
        >
          <input
            type="text"
            aria-label={requiredLabel}
            placeholder={askingOccupant ? 'Emma Johnson, burst pipe…' : 'Burst pipe, caretaker…'}
            value={required}
            maxLength={500}
            // deliberate: this input only mounts when the staff member just clicked
            // "Write in"/"Release" (a modal-open equivalent), and the whole point of the
            // click is to type into it next.
            autoFocus
            aria-invalid={wantsRequired && required.trim() === ''}
            onChange={(event) => {
              setRequired(event.target.value)
              setWantsRequired(false)
            }}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none aria-[invalid=true]:border-amber-500"
          />
          {/* OPTIONAL, and only beside a write-in. It carries the "say why, so
              next week's staff can act on it" affordance a bare name loses —
              prospectively: 1500000148 cleared the note of every row it moved,
              so this column is empty on all of them and that is correct. */}
          {askingOccupant && (
            <input
              type="text"
              aria-label="Note (optional)"
              placeholder="Note (optional) — back Monday…"
              value={note}
              maxLength={500}
              onChange={(event) => {
                setNote(event.target.value)
              }}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none"
            />
          )}
          {wantsRequired && required.trim() === '' && (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {refusal}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={isSaving}
              className="bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs font-medium disabled:opacity-40"
            >
              {action.label}
            </button>
            <button
              type="button"
              onClick={close}
              className="text-muted-foreground hover:text-foreground rounded-md px-1.5 py-0.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      </>
    )
  }

  return (
    <>
      {explanation}
      <button
        type="button"
        disabled={isSaving}
        // Named for the cabin: eighty-one cards each carrying a button called
        // "Write in" is unusable with a screen reader.
        aria-label={`${action.label} ${unit.name}`}
        onClick={() => {
          if (action.prompt !== 'none') {
            setIsOpen(true)
            return
          }
          onSubmit({
            unitId: action.unitId,
            unitName: action.unitName,
            familyAvailable: action.familyAvailable,
            occupantName: '',
            reason: '',
          })
        }}
        className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-full border px-1.5 py-0.5 text-xs font-medium disabled:opacity-40"
      >
        {action.label}
      </button>
    </>
  )
}
