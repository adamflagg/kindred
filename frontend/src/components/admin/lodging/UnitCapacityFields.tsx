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
  /** The sheet's `Capacity`. Context for a human, never an input to the rule. */
  maxBeds: number | null
}

export function UnitCapacityFields({
  value,
  onChange,
  isConfirmed,
  isContainer,
  maxBeds,
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

        {/* Outside the flag, and shown whether or not there is one. Folded in,
            it would read as corroboration for the comparison; it is not. See
            LodgingUnitRecord.max_beds for why it cannot be.

            0 is excluded for the same reason `sleeps` and the derived total
            are: PocketBase cannot store NULL in a number column, so 0 is how
            the 15 units the sheet gave no capacity come back. */}
        {maxBeds !== null && maxBeds > 0 && (
          <p className="text-muted-foreground mt-1.5 text-xs">Sheet capacity: {maxBeds}</p>
        )}
      </div>
    </>
  )
}
