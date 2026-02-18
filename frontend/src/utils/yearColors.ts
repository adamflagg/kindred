/**
 * Stable year-to-color mapping for multi-year charts.
 *
 * Colors are assigned by offset from the most recent year,
 * so toggling between 3 and 5 years keeps colors consistent.
 */

export const YEAR_PALETTE = [
  'hsl(42, 92%, 50%)', // Gold (most recent: offset 0)
  'hsl(160, 100%, 35%)', // Green (offset 1)
  'hsl(200, 70%, 50%)', // Blue (offset 2)
  'hsl(280, 60%, 50%)', // Purple (offset 3)
  'hsl(350, 70%, 50%)', // Red (offset 4)
]

export function getYearColor(year: number, maxYear: number): string {
  const offset = maxYear - year
  return YEAR_PALETTE[offset] ?? 'hsl(0, 0%, 50%)'
}
