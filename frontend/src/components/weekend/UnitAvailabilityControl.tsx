/**
 * Holding a cabin back for a weekend, or releasing one to families.
 *
 * `PUT /api/lodging/availability` shipped with no caller: `lodging_availability`
 * has never held a row, and the request model required a scenario nobody could
 * supply. Landing the model with no writer is how it drifted, so this is the
 * writer.
 *
 * ## One button, not a menu
 *
 * `family_available` has three reachable outcomes and a unit is always in
 * exactly one of them, so `availabilityAction` resolves the single action this
 * card can offer and the button IS the gate — no modal carrying its own
 * eligibility logic. Writing a value that AGREES with the unit's role is
 * deliberately unreachable: it would pin the unit against a later registry
 * edit while changing nothing staff can see.
 *
 * ## Why the reason is required here and not at the schema
 *
 * `reason` is `Field("", max_length=500)` server-side, because a row written by
 * an ingest or a fixture has no author to ask. Through this control there is
 * always an author, and a cabin taken out of service with no stated reason is
 * the row a staff member cannot act on next week — they can see it is closed
 * and have no way to learn whether the pipe has been fixed. Clearing asks for
 * none: it restores the unit's standing role rather than asserting anything.
 */
import { useState } from 'react'

import type { LodgingUnitRow } from '../../types/lodging'
import { availabilityAction } from './unitBadges'

export interface UnitAvailabilityControlProps {
  unit: LodgingUnitRow
  /**
   * `bunking.manage`, with a weekend selected.
   *
   * NOT the board's `canPlace`, which also requires a scenario. Availability
   * carries no scenario since 1500000135 — a burst pipe closes a cabin in
   * every plan for that weekend — so requiring one to record it would put the
   * deleted dimension back at the UI layer, and staff looking at the
   * CampMinder mirror could not close a cabin at all.
   */
  canManage: boolean
  /**
   * Whether the slot this unit sits in already holds a party this scenario —
   * a fact read off the CARD, never off availability itself. Owner ruling on
   * #2090: held and occupied are mutually exclusive states, so an occupied
   * unit offers no "Hold" action. Kept separate from `canManage`: folding
   * occupancy into the permission gate would resurrect the scenario
   * dimension 1500000135 deleted from availability.
   */
  occupied: boolean
  /** True while THIS unit's write is in flight. */
  isSaving: boolean
  onSubmit: (write: { familyAvailable: boolean | null; reason: string }) => void
}

export function UnitAvailabilityControl({
  unit,
  canManage,
  occupied,
  isSaving,
  onSubmit,
}: UnitAvailabilityControlProps) {
  const [reason, setReason] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [wantsReason, setWantsReason] = useState(false)
  const action = availabilityAction(unit, occupied)

  const close = () => {
    setIsOpen(false)
    setWantsReason(false)
    // Cleared on the way out, not on the way in: a reason left over from an
    // abandoned edit is how a burst-pipe note ends up on the wrong cabin.
    setReason('')
  }

  // Shown to everyone, including a reader without `bunking.manage`. Knowing a
  // cabin is closed for a burst pipe is not a write, and the staff member who
  // needs it most may not hold the permission.
  const storedReason = unit.reason ?? ''
  const explanation =
    unit.family_available_override !== null &&
    unit.family_available_override !== undefined &&
    storedReason !== '' ? (
      <span className="text-muted-foreground w-full text-sm italic">{storedReason}</span>
    ) : null

  if (action === null || !canManage) return explanation

  if (isOpen && action.needsReason) {
    return (
      <>
        {explanation}
        <form
          className="flex w-full flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = reason.trim()
            // The ONLY place an empty reason is refused. The submit button is
            // deliberately NOT disabled while the box is empty: a disabled
            // button plus a guard here mask each other — deleting either leaves
            // the other quietly holding the rule, so a test can pin neither,
            // which is exactly what a surviving mutation caught. An inert
            // button also explains nothing to the staff member wondering why
            // their click did nothing.
            if (trimmed === '') {
              setWantsReason(true)
              return
            }
            onSubmit({ familyAvailable: action.familyAvailable, reason: trimmed })
            close()
          }}
        >
          <input
            type="text"
            aria-label="Reason"
            placeholder="Burst pipe, caretaker…"
            value={reason}
            maxLength={500}
            // deliberate: this input only mounts when the staff member just clicked
            // "Hold"/"Release" (a modal-open equivalent), and the whole point of the click is to
            // type a reason next.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            aria-invalid={wantsReason && reason.trim() === ''}
            onChange={(event) => {
              setReason(event.target.value)
              setWantsReason(false)
            }}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none aria-[invalid=true]:border-amber-500"
          />
          {wantsReason && reason.trim() === '' && (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Say why, so next week&rsquo;s staff can act on it.
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
        // "Hold" is unusable with a screen reader.
        aria-label={`${action.label} ${unit.name}`}
        onClick={() => {
          if (action.needsReason) {
            setIsOpen(true)
            return
          }
          onSubmit({ familyAvailable: action.familyAvailable, reason: '' })
        }}
        className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-full border px-1.5 py-0.5 text-xs font-medium disabled:opacity-40"
      >
        {action.label}
      </button>
    </>
  )
}
