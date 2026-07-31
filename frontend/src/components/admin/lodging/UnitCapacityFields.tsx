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
 */
import { suggestedSleeps, type BedInventory } from '../../../types/beds'
import { BedInventoryEditor } from './BedInventoryEditor'
import { FIELD, LABEL, SECTION } from './lodgingStyles'

export interface UnitCapacity {
  /** A string because blank is a real value: UNKNOWN. */
  sleeps: string
  beds: BedInventory
}

export interface UnitCapacityFieldsProps {
  value: UnitCapacity
  onChange: (next: UnitCapacity) => void
}

export function UnitCapacityFields({ value, onChange }: UnitCapacityFieldsProps) {
  const suggestion = suggestedSleeps(value.beds)

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
        {value.beds.length > 0 && (
          <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
            <span>Suggested: sleeps {suggestion}</span>
            <button
              type="button"
              onClick={() => {
                onChange({ ...value, sleeps: String(suggestion) })
              }}
              className="text-primary font-medium hover:underline"
            >
              Use suggested
            </button>
          </div>
        )}
      </div>
    </>
  )
}
