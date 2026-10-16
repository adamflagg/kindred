/**
 * App-wide number formatting (decision 43, #3207), the shared home decision 8 points the
 * analytics pages at on the way to an app-wide kit. Camperships' kit already followed these
 * rules (spec §4.2); its MINUS, formatCount and formatPct now come from here.
 *
 * - Counts carry thousands separators: "1,293".
 * - One percent convention: a 0-100 percentage to one decimal, "42.5%" (what the server rounds
 *   to). `formatRate` reads a 0-1 fraction as the same thing.
 * - A negative is a true minus sign (U+2212), never an ASCII hyphen; a change that rounds to
 *   zero never reads "−0".
 * - "—" is a missing value; "0" is a real zero. They never look alike.
 * - CSV export is not this: a file writes plain signed numbers.
 */

export const MINUS = '−'

const MISSING = '—'

type Maybe = number | null | undefined

function withMinus(text: string): string {
  return text.startsWith('-') ? MINUS + text.slice(1) : text
}

/** "1,293"; "−1,200"; "0" for a real zero; "—" when there is nothing to count. */
export function formatCount(value: Maybe): string {
  if (value === null || value === undefined) return MISSING
  return withMinus(value.toLocaleString('en-US'))
}

function oneDecimal(value: number): string {
  const text = value.toFixed(1)
  return text === '-0.0' ? '0.0' : withMinus(text)
}

/** A 0-100 percentage to one decimal: "42.5%"; "—" when missing. */
export function formatPercent(value: Maybe): string {
  if (value === null || value === undefined) return MISSING
  return `${oneDecimal(value)}%`
}

/** A 0-1 fraction (a retention rate) as a percentage: 0.679 is "67.9%". */
export function formatRate(value: Maybe): string {
  if (value === null || value === undefined) return MISSING
  return formatPercent(value * 100)
}

/** A change in a count: "+1,234", "−56", "0". */
export function formatSignedCount(value: number): string {
  const rounded = Math.round(value)
  if (rounded === 0) return '0'
  return rounded > 0 ? `+${formatCount(rounded)}` : formatCount(rounded)
}

/** A change in a percentage, one decimal: "+5.0%", "−7.3%", "0.0%". */
export function formatSignedPercent(value: number): string {
  const text = oneDecimal(value)
  if (text === '0.0') return '0.0%'
  return value > 0 ? `+${text}%` : `${text}%`
}

/** What a card shows: a number as a count, a pre-formatted string as given. */
export function formatValue(value: string | number): string {
  return typeof value === 'number' ? formatCount(value) : value
}
