import { CS_BTN, CS_BTN2 } from '../kit/csType'
import { exactButtonWords } from './bulkPlaceModel'

/**
 * The bulk buttons on To place's one toolbar row (§4.10; P-6; design-language §5; the Requests grid's
 * grammar): "Confirm the N Exact Matches…" checks every exact single match and opens the dialog at
 * once; lines checked by hand confirm through "Confirm the N Checked…" with Clear. How many are checked
 * and how many of them the search hides (still checked, still sent: owner ruling 2026-10-02) is the
 * toolbar's status, not a row of its own.
 */
export function BulkPlaceBar({
  count,
  exact,
  onConfirmExact,
  onConfirmChecked,
  onClear,
}: {
  count: number
  /** How many open lines are exact single matches (`bulkEligible`). */
  exact: number
  onConfirmExact: () => void
  onConfirmChecked: () => void
  onClear: () => void
}) {
  if (count > 0) {
    return (
      <>
        <button type="button" className={CS_BTN} onClick={onConfirmChecked}>
          {`Confirm the ${String(count)} Checked…`}
        </button>
        <button type="button" className={CS_BTN2} onClick={onClear}>
          Clear
        </button>
      </>
    )
  }
  if (exact === 0) return null
  return (
    <button
      type="button"
      className={CS_BTN2}
      title={`The ${String(exact)} exact single ${exact === 1 ? 'match' : 'matches'}: one candidate request and an exact amount. It checks them, then asks before it writes.`}
      onClick={onConfirmExact}
    >
      {exactButtonWords(exact)}
    </button>
  )
}
