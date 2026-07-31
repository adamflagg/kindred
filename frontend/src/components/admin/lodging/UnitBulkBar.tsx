/**
 * The floating bulk-confirm bar.
 *
 * Floating, in the solver's action-bar grammar (`ConfigTab`): 93 rows outrun
 * a viewport, and an inline bar would scroll away exactly when staff are
 * still picking rows further down. Extracted out of `LodgingUnitsPanel` so
 * that file stays under the repo's line-count floor.
 */
import { BUTTON_PRIMARY } from './lodgingStyles'

export interface UnitBulkBarProps {
  count: number
  onConfirm: () => void
  onClear: () => void
}

export function UnitBulkBar({ count, onConfirm, onClear }: UnitBulkBarProps) {
  return (
    <div className="animate-in slide-in-from-bottom-4 border-forest-300 bg-forest-50 dark:border-forest-600 dark:bg-forest-800 fixed right-4 bottom-4 z-50 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-lg duration-200 sm:right-6 sm:bottom-6">
      <span className="text-foreground text-sm font-semibold tabular-nums">{count} selected</span>
      <button type="button" onClick={onConfirm} className={BUTTON_PRIMARY}>
        Confirm {count} selected
      </button>
      <button
        type="button"
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground text-sm font-medium hover:underline"
      >
        Clear
      </button>
    </div>
  )
}
