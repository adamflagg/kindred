/**
 * Shared constants and utilities used by both VelocityPage and CancellationVelocityPage.
 */

export const PRIOR_YEAR_COLORS = [
  'hsl(220, 60%, 65%)',
  'hsl(280, 50%, 60%)',
  'hsl(35, 70%, 55%)',
  'hsl(340, 55%, 60%)',
  'hsl(180, 50%, 45%)',
]

export const GENDER_COLORS = {
  boys: 'hsl(210, 70%, 55%)',
  girls: 'hsl(340, 65%, 55%)',
}

/**
 * Format a Recharts <LabelList> value as a localized integer.
 * Recharts passes `value` as `unknown` (number | string | undefined depending on data shape).
 */
export function formatLabelListValue(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString()
  return String(value ?? '')
}

/**
 * Format a Recharts <LabelList> value as a percentage with one decimal.
 * Returns the raw stringified value when not numeric (matches prior fallback).
 */
export function formatLabelListPercent(value: unknown): string {
  if (typeof value === 'number') return `${value.toFixed(1)}%`
  return String(value ?? '')
}

/** Format a date string (YYYY-MM-DD) to short display like "Jan 6". */
export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Compute the calendar date for a prior year at a given day offset from its season start. */
export function priorYearDailyDateLabel(
  seasonStarts: Record<number, string> | undefined,
  year: number,
  dayOffset: number
): string | null {
  const seasonStart = seasonStarts?.[year]
  if (!seasonStart) return null
  const d = new Date(seasonStart + 'T00:00:00')
  d.setDate(d.getDate() + dayOffset)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
