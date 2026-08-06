/**
 * One unit row.
 *
 * Extracted from the panel so neither file accumulates conditionals — the spec
 * names `BunkingBoardByArea.tsx` (849 lines) as the thing not to repeat.
 *
 * The row carries the SAME amenity vocabulary the weekend board's
 * `LodgingUnitCard` shows: bathroom, then the `AMENITY_FLAGS` glyphs. Read the
 * same way on both surfaces, so an amenity means the same thing in Manage as
 * it does on the board. It also makes "Confirm" mean something — the button
 * asserts that these amenity values are right, and until they were on the row
 * staff had to open the form to find out what they were confirming.
 *
 * Every action is labelled with the unit name (`Confirm Cabin A`, not
 * `Confirm`) so a screen reader — and a test — can tell 93 identical buttons
 * apart.
 */
import { Bath } from 'lucide-react'

import type { LodgingUnitRecord } from '../../../types/lodging'
import { normaliseBeds, totalBedCount } from '../../../types/beds'
import { ACTION_LINK, MUTED_PILL, PILL } from './lodgingStyles'
import { AMENITY_FLAGS } from './unitAmenities'

export interface LodgingUnitRowProps {
  unit: LodgingUnitRecord
  isSelected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onConfirm: () => void
  onDeactivate: () => void
}

export function LodgingUnitRow({
  unit,
  isSelected,
  onToggleSelect,
  onEdit,
  onConfirm,
  onDeactivate,
}: LodgingUnitRowProps) {
  const beds = normaliseBeds(unit.beds)
  const bedCount = totalBedCount(beds)

  return (
    <tr
      className={`border-border/50 border-b transition-colors ${
        // forest-700, not forest-950: the scale stops at 900, so a `forest-950`
        // class generates nothing and the row keeps its light tint in the dark.
        isSelected ? 'bg-forest-50/70 dark:bg-forest-700/40' : 'hover:bg-muted/30'
      }`}
    >
      <td className="py-1.5 pr-2">
        <input
          type="checkbox"
          aria-label={`Select ${unit.name}`}
          checked={isSelected}
          onChange={onToggleSelect}
        />
      </td>
      <td className="py-1.5 font-medium" data-testid="unit-name">
        {unit.name}
      </td>
      <td className="py-1.5 tabular-nums">
        {/* 0 means UNKNOWN — PocketBase stores unset numbers as 0. */}
        {unit.sleeps > 0 ? unit.sleeps : <span className="text-muted-foreground">—</span>}
        {bedCount > 0 && (
          <span className="text-muted-foreground ml-1.5 text-xs">
            ({bedCount} {bedCount === 1 ? 'bed' : 'beds'})
          </span>
        )}
      </td>
      <td className="py-1.5">
        {unit.inventory_class === 'staff_default' ? 'Held for staff' : 'Available to guests'}
      </td>
      <td className="py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {unit.is_container && <span className={MUTED_PILL}>Building</span>}
          {!unit.is_active && <span className={MUTED_PILL}>Inactive</span>}
          {(unit.bathroom === 'private' || unit.bathroom === 'shared') && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Bath className="h-3.5 w-3.5" aria-hidden="true" />
              {unit.bathroom === 'private' ? 'Private' : 'Shared'}
            </span>
          )}
          {AMENITY_FLAGS.filter((flag) => unit[flag.key]).map((flag) => {
            const Icon = flag.icon
            return (
              <span key={flag.key} title={flag.label} className="text-muted-foreground">
                <Icon className="h-3.5 w-3.5" role="img" aria-label={flag.label} />
              </span>
            )
          })}
          {/* Last, because it qualifies everything before it: these are the
              amenities, and nobody has verified them. */}
          {!unit.is_confirmed && (
            <span
              className={`bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 ${PILL}`}
            >
              Unconfirmed
            </span>
          )}
        </div>
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {!unit.is_confirmed && (
          <button
            type="button"
            onClick={onConfirm}
            aria-label={`Confirm ${unit.name}`}
            className={`text-forest-700 dark:text-forest-300 mr-3 ${ACTION_LINK}`}
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${unit.name}`}
          className={`text-primary mr-3 ${ACTION_LINK}`}
        >
          Edit
        </button>
        {unit.is_active && (
          <button
            type="button"
            onClick={onDeactivate}
            aria-label={`Deactivate ${unit.name}`}
            className={`text-muted-foreground hover:text-foreground ${ACTION_LINK}`}
          >
            Deactivate
          </button>
        )}
      </td>
    </tr>
  )
}
