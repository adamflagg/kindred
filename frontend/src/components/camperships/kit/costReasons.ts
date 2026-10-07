import { keyWords } from '../season/rules/rulesModel'

/**
 * The cost override's reason codes in staff words. The raw key is never shown; `headcount` reads
 * "Number of people", as the approved cost-override-v2 mock's select draws it.
 */
const REASON_WORDS: Record<string, string> = {
  headcount: 'Number of people',
  partial_session: 'Part of the session',
  discount: 'Discount',
  missing_catalog: 'No catalog price',
  typed_household_total: "Family's total from the form",
}

export function costReasonWords(code: string): string {
  return REASON_WORDS[code] ?? keyWords(code)
}

/** The words with only the first letter lower-cased, for mid-sentence use. */
export function costReasonLower(code: string): string {
  const words = costReasonWords(code)
  return words.charAt(0).toLowerCase() + words.slice(1)
}

/** Every code the page carries, in its order, worded. */
export function costReasonOptions(
  codes: readonly string[]
): Array<{ value: string; label: string }> {
  return codes.map((code) => ({ value: code, label: costReasonWords(code) }))
}
