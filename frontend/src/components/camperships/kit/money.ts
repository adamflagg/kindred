/**
 * Camperships money formatting (spec §4.2; D74, D20, D59; mockups/money-format.html).
 *
 * - "—" is nothing there yet (no decision, nothing posted, not reported, round not open);
 *   "$0" is a real zero. They never look alike.
 * - Whole dollars, with cents only where a figure has them ($2,399.72). Comparisons are exact
 *   to the cent, so a $0.28 gap reads "short $0.28", never a rounded "confirmed".
 * - Aid is a positive amount everywhere (the server flips CampMinder's credits once, D21).
 * - No "+" on increases. A negative is a true minus sign (U+2212), inked red by the components
 *   (red means negative, not bad: a scenario that saves money is red too).
 * - CSV writes plain signed numbers with an ASCII hyphen, whatever the screen shows (§11).
 */

export const MINUS = '−'

/** Whole cents, so float noise in the JSON (1800.0000001) never decides a comparison. */
export function toCents(value: number): number {
  return Math.round(value * 100)
}

function absDollars(cents: number): string {
  const abs = Math.abs(cents)
  const showCents = abs % 100 !== 0
  return (
    '$' +
    (abs / 100).toLocaleString('en-US', {
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    })
  )
}

/** "—" · "$0" · "$1,800" · "$2,399.72" · "−$1,200". */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const cents = toCents(value)
  if (cents === 0) return '$0'
  return cents < 0 ? MINUS + absDollars(cents) : absDollars(cents)
}

/**
 * The Remaining line's figure (D48, spec §7.3; Decision 2, RULED 2026-10-01): "$153k". Thousands
 * round toward zero, so the line never shows more than is left ($1,500 is "$1k", never "$2k").
 * Under $1,000 it is the exact figure ("$840", "$999.60"), so a nearly spent pool never reads "$0k".
 */
export function formatMoneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const cents = toCents(value)
  if (cents === 0) return '$0'
  const abs = Math.abs(cents)
  const body =
    abs < 100_000 ? absDollars(abs) : `$${Math.trunc(abs / 100_000).toLocaleString('en-US')}k`
  return cents < 0 ? MINUS + body : body
}

export function isNegativeMoney(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && toCents(value) < 0
}

/** D59's wording beside a Posted figure: "short $210" / "over $300"; null when CampMinder agrees. */
export function formatGap(locked: number, inCampMinder: number): string | null {
  const gap = toCents(inCampMinder) - toCents(locked)
  if (gap === 0) return null
  return `${gap < 0 ? 'short' : 'over'} ${absDollars(gap)}`
}

/** A money cell in a CSV (§11): "1800", "2399.72", "-1200"; "" for nothing there. */
export function moneyCsv(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const cents = toCents(value)
  if (cents === 0) return '0'
  const abs = Math.abs(cents)
  const body = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2)
  return cents < 0 ? `-${body}` : body
}
