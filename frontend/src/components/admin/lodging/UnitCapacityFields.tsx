/**
 * How many the unit sleeps, and the beds behind that number.
 *
 * `sleeps` is three-state and blank means UNKNOWN: PocketBase stores an unset
 * number as 0 (columns are NUMERIC DEFAULT 0 NOT NULL, never NULL), so a
 * stored 0 renders as a BLANK field and a blank field submits no `sleeps` key.
 *
 * The bed inventory only ever SUGGESTS an occupancy — capacity depends on bed
 * size and on who can share a bed, which no table knows. Staff adopt the
 * suggestion in one click; nothing writes `sleeps` for them.
 *
 * WHICH of the two advisory states shows, and the far larger set of rows where
 * neither does, is `capacityFlag` — read its header before changing anything
 * here. This file only renders what that decides.
 */
import { type BedInventory } from '../../../types/beds'
import { BedInventoryEditor } from './BedInventoryEditor'
import { capacityFlag } from './capacityFlag'
import { FIELD, LABEL, SECTION } from './lodgingStyles'

export interface UnitCapacity {
  /** A string because blank is a real value: UNKNOWN. */
  sleeps: string
  beds: BedInventory
}

export interface UnitCapacityFieldsProps {
  value: UnitCapacity
  onChange: (next: UnitCapacity) => void
  /**
   * Live amenity-confirmation state, not the stored row. A staffer who ticks
   * "confirmed" has ruled, and the flag should stop arguing immediately rather
   * than at the next reload.
   */
  isConfirmed: boolean
  isContainer: boolean
}

export function UnitCapacityFields({
  value,
  onChange,
  isConfirmed,
  isContainer,
}: UnitCapacityFieldsProps) {
  const flag = capacityFlag({ beds: value.beds, sleeps: value.sleeps, isConfirmed, isContainer })

  return (
    <>
      <p className={SECTION}>Capacity</p>

      <label className="text-sm">
        <span className={LABEL}>Sleeps</span>
        <input
          className={FIELD}
          type="number"
          min={1}
          value={value.sleeps}
          placeholder="Unknown"
          onChange={(e) => {
            onChange({ ...value, sleeps: e.target.value })
          }}
        />
      </label>

      <div className="text-sm">
        <span className={LABEL}>Beds</span>
        <BedInventoryEditor
          beds={value.beds}
          onChange={(beds) => {
            onChange({ ...value, beds })
          }}
        />
        {/* ALWAYS MOUNTED, and that is the whole point: a live region is only
            announced when its contents change while it is ALREADY in the
            document. Rendering the region together with its text — the obvious
            one-liner — is missed by several screen readers, so this one has to
            outlive the advisory it carries.

            It WRAPS the visible text rather than duplicating it into an
            sr-only copy. Two copies would be read twice by anyone navigating
            the form linearly, and hiding the visible one is worse still: a
            region announces on CHANGE, never on mount, so a form opened on an
            existing conflict would then report it to nobody at all.

            The button lives inside, which is the one compromise. Keeping it
            out would mean breaking the text and its action onto separate rows;
            the cost is that the announcement ends with the control's label. */}
        <div role="status" aria-live="polite">
          {flag.kind === 'suggestion' && (
            <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
              <span>Suggested: sleeps {flag.derived}</span>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...value, sleeps: String(flag.derived) })
                }}
                className="text-primary font-medium hover:underline"
              >
                Use suggested
              </button>
            </div>
          )}

          {/* Deliberately no button. Settling this means knowing whether there
              is a mattress on the floor, which is a walk to the cabin, not a
              click — and half of these are +1, where the likeliest explanation
              is a family doubling up and the staff number being right. So it
              states both numbers and asks nothing. */}
          {flag.kind === 'conflict' && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              Beds account for {flag.derived}, but sleeps says {flag.sleeps}.
            </p>
          )}
        </div>

        {/* The Master Housing sheet's `Capacity` column is deliberately NOT
            shown beside these. It reads as a corroborating third number and is
            not one: it agrees with the bed count on only 42 of the 88 units
            carrying both, and sits BELOW the physical bed count on 33 — thirty
            of those at exactly -1, with no cause derivable from the beds, since
            identical bed compositions land on different capacities. Half the
            conflicts this flag raises are themselves ±1, so a column with ±1
            systematic noise cannot adjudicate them. It would lend confidence
            it has not earned. */}
      </div>
    </>
  )
}
