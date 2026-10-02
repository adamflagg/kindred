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

/** Where on the page a hold's cause is fixed: "Enter income ↓" to the income, "Set shares ↓" to the card. */
export function fixLink(code: string, requestId: string): { label: string; href: string } | null {
  if (code === 'household_income_conflict' || code === 'placeholder_income') {
    return { label: 'Enter income ↓', href: '#income' }
  }
  if (code === 'payer_shares_incomplete')
    return { label: 'Set shares ↓', href: `#request-${requestId}` }
  return null
}
