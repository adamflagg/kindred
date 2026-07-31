/**
 * One unit row.
 *
 * Extracted from the panel so neither file accumulates conditionals — the spec
 * names `BunkingBoardByArea.tsx` (849 lines) as the thing not to repeat.
 *
 * Every action is labelled with the unit name (`Confirm Cabin A`, not
 * `Confirm`) so a screen reader — and a test — can tell 93 identical buttons
 * apart.
 */
import type { LodgingUnitRecord } from '../../../types/lodging'
import { normaliseBeds, totalBedCount } from '../../../types/beds'

const PILL = 'rounded-full px-2 py-0.5 text-xs'

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
    <tr className="border-border/50 hover:bg-muted/30 border-b transition-colors">
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          aria-label={`Select ${unit.name}`}
          checked={isSelected}
          onChange={onToggleSelect}
        />
      </td>
      <td className="py-2 font-medium" data-testid="unit-name">
        {unit.name}
      </td>
      <td className="py-2">
        {/* 0 means UNKNOWN — PocketBase stores unset numbers as 0. */}
        {unit.sleeps > 0 ? unit.sleeps : <span className="text-muted-foreground">—</span>}
        {bedCount > 0 && (
          <span className="text-muted-foreground ml-1.5 text-xs">
            ({bedCount} {bedCount === 1 ? 'bed' : 'beds'})
          </span>
        )}
      </td>
      <td className="py-2">
        {unit.allocation_default === 'staff_default' ? 'Held for staff' : 'Available to guests'}
      </td>
      <td className="flex flex-wrap gap-1 py-2">
        {unit.is_container && (
          <span className={`bg-muted text-muted-foreground ${PILL}`}>Building</span>
        )}
        {!unit.is_active && (
          <span className={`bg-muted text-muted-foreground ${PILL}`}>Inactive</span>
        )}
        {!unit.is_confirmed && (
          <span
            className={`bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 ${PILL}`}
          >
            Unconfirmed
          </span>
        )}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        {!unit.is_confirmed && (
          <button
            type="button"
            onClick={onConfirm}
            aria-label={`Confirm ${unit.name}`}
            className="text-forest-700 dark:text-forest-300 mr-3 text-xs font-medium hover:underline"
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${unit.name}`}
          className="text-primary mr-3 text-xs font-medium hover:underline"
        >
          Edit
        </button>
        {unit.is_active && (
          <button
            type="button"
            onClick={onDeactivate}
            aria-label={`Deactivate ${unit.name}`}
            className="text-muted-foreground text-xs font-medium hover:underline"
          >
            Deactivate
          </button>
        )}
      </td>
    </tr>
  )
}
