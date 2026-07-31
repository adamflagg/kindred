/**
 * Bed inventory rows.
 *
 * Capacity is amorphous — it depends on bed size and on who can share a bed.
 * So this produces a SUGGESTION and never writes `sleeps` itself; the parent
 * form offers a one-click adopt. `sleeps` stays the number every consumer
 * reads.
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import { BED_TYPES, bedTypeLabel, type BedInventory, type BedType } from '../../../types/beds'
import { BUTTON_SECONDARY, FIELD_INLINE as FIELD } from './lodgingStyles'

export interface BedInventoryEditorProps {
  beds: BedInventory
  onChange: (next: BedInventory) => void
}

export function BedInventoryEditor({ beds, onChange }: BedInventoryEditorProps) {
  const [pending, setPending] = useState<BedType>(BED_TYPES[0]?.id ?? 'twin')

  const addBed = () => {
    const existing = beds.find((b) => b.type === pending)
    onChange(
      existing
        ? beds.map((b) => (b.type === pending ? { ...b, count: b.count + 1 } : b))
        : [...beds, { type: pending, count: 1 }]
    )
  }

  const setCount = (type: BedType, count: number) => {
    onChange(
      count <= 0
        ? beds.filter((b) => b.type !== type)
        : beds.map((b) => (b.type === type ? { ...b, count } : b))
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {beds.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {beds.map((bed) => (
            <li key={bed.type} className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min={1}
                className={`${FIELD} w-16`}
                aria-label={`${bedTypeLabel(bed.type)} count`}
                value={bed.count}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10)
                  // A blank field is mid-edit, not a removal. Coercing it to 0
                  // filters the row out on the first keystroke of a retype,
                  // taking the focused input with it. The X button is the
                  // removal affordance, and the only one.
                  if (Number.isNaN(next)) return
                  setCount(bed.type, next)
                }}
              />
              <span className="flex-1">{bedTypeLabel(bed.type)}</span>
              <button
                type="button"
                aria-label={`Remove ${bedTypeLabel(bed.type)}`}
                onClick={() => {
                  setCount(bed.type, 0)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="bed-type-picker">
          Add a bed type
        </label>
        <select
          id="bed-type-picker"
          aria-label="Add a bed type"
          className={FIELD}
          value={pending}
          onChange={(e) => {
            setPending(e.target.value as BedType)
          }}
        >
          {BED_TYPES.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {bed.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={addBed} className={`${BUTTON_SECONDARY} px-3 py-1.5`}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add bed
        </button>
      </div>
    </div>
  )
}
