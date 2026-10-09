import { ACTION_LINK, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { exactButtonWords } from './bulkPlaceModel'

/**
 * The bulk bar over To place's lines (§4.10; P-6; money-v2.html's one button): "Confirm the N Exact
 * Single Matches…" checks every exact single match and opens the dialog at once. Lines checked by
 * hand confirm through "Confirm the Selected…", with how many are checked and how many of them the
 * search hides (still checked, still sent: owner ruling 2026-10-02), and Clear. The Requests grid's
 * bulk-bar grammar.
 */
export function BulkPlaceBar({
  count,
  hidden,
  exact,
  onConfirmExact,
  onConfirmSelected,
  onClear,
}: {
  count: number
  hidden: number
  /** How many open lines are exact single matches (`bulkEligible`). */
  exact: number
  onConfirmExact: () => void
  onConfirmSelected: () => void
  onClear: () => void
}) {
  if (count === 0 && exact === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {exact > 0 && (
        <button type="button" className={BUTTON_SECONDARY} onClick={onConfirmExact}>
          {exactButtonWords(exact)}
        </button>
      )}
      {count > 0 && (
        <>
          <span className="font-medium">
            {count} selected
            {hidden > 0 ? ` · ${String(hidden)} hidden by the search` : ''}
          </span>
          <button type="button" className={BUTTON_SECONDARY} onClick={onConfirmSelected}>
            Confirm the Selected…
          </button>
          <button type="button" className={ACTION_LINK} onClick={onClear}>
            Clear
          </button>
        </>
      )}
    </div>
  )
}
