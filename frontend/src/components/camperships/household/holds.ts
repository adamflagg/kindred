/**
 * Holds that clear only when their cause is fixed: no release lifts them. This mirrors UNRELEASABLE
 * in bunking/financial_aid/decisions/holds.py, which holds.test.ts reads (Decision 25).
 */
export const UNRELEASABLE_CODES: ReadonlySet<string> = new Set([
  'award_above_cost',
  'household_income_conflict',
  'payer_shares_incomplete',
  'awaiting_approved_rules',
  'unmatched_session',
  'no_approved_rules',
  'not_priceable',
  'manual_hold',
])

/**
 * Where on the page a hold's cause is fixed (B30: Title Case, as the grid's next steps): "Enter the
 * Income ↓" to the income, "Set the Shares ↓" and "Change the Amount ↓" to the request's card, where
 * Payer Shares… and the money editors are.
 */
export function fixLink(code: string, requestId: string): { label: string; href: string } | null {
  if (code === 'household_income_conflict' || code === 'placeholder_income') {
    return { label: 'Enter the Income ↓', href: '#income' }
  }
  if (code === 'payer_shares_incomplete')
    return { label: 'Set the Shares ↓', href: `#request-${requestId}` }
  if (code === 'award_above_cost')
    return { label: 'Change the Amount ↓', href: `#request-${requestId}` }
  return null
}

/**
 * B26 (ruled 10-04 late): an above-cost hold clears only when aid plus grants fits under the cost,
 * so the banner names all three ways through. Only the amount has an editor on this page (the card's);
 * the cost and the grants are fixed where they are entered.
 */
export function fixWords(code: string): string | null {
  return code === 'award_above_cost' ? 'Three fixes: the cost, the grants, or the amount.' : null
}
