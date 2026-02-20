/**
 * Shared retention color coding used by SessionBunkHeatmap and StaffCabinAnalysisPage.
 *
 * Green (>=60%), amber (40-60%), red (<40%).
 */
export function getRetentionCellColor(rate: number): string {
  const pct = Math.round(rate * 100)
  if (pct >= 60) return 'bg-emerald-600/80 text-white'
  if (pct >= 40) return 'bg-amber-500/80 text-white'
  return 'bg-red-600/80 text-white'
}
