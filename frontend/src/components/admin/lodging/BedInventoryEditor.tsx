/**
 * Bed inventory, as a set of chips rather than a column of rows.
 *
 * Capacity is amorphous — it depends on bed size and on who can share a bed.
 * So this produces a SUGGESTION and never writes `sleeps` itself; the parent
 * form offers a one-click adopt. `sleeps` stays the number every consumer
 * reads.
 *
 * WHY CHIPS. One row per bed type meant a unit's height tracked its variety:
 * the multi-bed buildings — the ones whose inventory a staffer most needs to
 * see whole — pushed everything below them off the fold, in the one column
 * that was already the tallest. Nine types is nine rows stacked, but three
 * rows wrapped. The add control sits in the same wrap so the whole inventory
 * reads as one assembled set, which is what it is.
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
    <ul className="flex flex-wrap items-center gap-1.5">
      {beds.map((bed) => (
        <li
          key={bed.type}
          className="border-border bg-muted/40 inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-sm"
        >
          {/* The spinners are suppressed because a chip is too small to hold
              them without the number losing the middle of the pill. */}
          <input
            type="number"
            min={1}
            className="w-8 [appearance:textfield] bg-transparent text-center font-semibold tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label={`${bedTypeLabel(bed.type)} count`}
            value={bed.count}
            onChange={(e) => {
              // NOTHING TYPED HERE MAY REMOVE THE CHIP. `setCount` reads <= 0
              // as a removal because that is what the X passes it, so a typed
              // 0 — select-all, type zero — used to delete the row mid-edit and
              // take the focused input with it. A blank field is the same
              // keystroke one step earlier.
              //
              // Number, not Number.parseInt: parseInt read "2.5" as 2 and
              // committed it, so a stray keypress wrote a bed count nobody
              // chose. Anything that is not a whole number of beds is treated
              // as mid-edit and left alone.
              const next = Number(e.target.value)
              if (!Number.isInteger(next) || next < 1) return
              setCount(bed.type, next)
            }}
          />
          <span className="text-muted-foreground" aria-hidden="true">
            ×
          </span>
          <span className="whitespace-nowrap">{bedTypeLabel(bed.type)}</span>
          <button
            type="button"
            aria-label={`Remove ${bedTypeLabel(bed.type)}`}
            onClick={() => {
              setCount(bed.type, 0)
            }}
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full p-1 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}

      {/* In the same wrap as the chips, so adding a bed reads as extending the
          set rather than operating a separate control below it. */}
      <li className="inline-flex items-center gap-1.5">
        <label className="sr-only" htmlFor="bed-type-picker">
          Add a bed type
        </label>
        <select
          id="bed-type-picker"
          aria-label="Add a bed type"
          className={`${FIELD} py-1`}
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
        <button type="button" onClick={addBed} className={`${BUTTON_SECONDARY} px-2.5 py-1`}>
          <Plus className="h-3.5 w-3.5" />
          Add bed
        </button>
      </li>
    </ul>
  )
}
