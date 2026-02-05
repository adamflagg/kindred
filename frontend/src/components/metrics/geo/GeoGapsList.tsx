/**
 * GeoGapsList - Shows items not matched by canonical lookup.
 *
 * Items without coordinates are "gaps" - they weren't found in the
 * canonical JSON lookup (schools.json, congregations.json, etc.).
 * Sorted by count descending so high-impact gaps appear first,
 * making it easy to identify which entries to add to the lookup data.
 */

import { AlertCircle } from 'lucide-react'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategory } from './GeoCategoryTabs'

interface GeoGapsListProps {
  gaps: GeoDataItem[]
  category: GeoCategory
}

const CATEGORY_PLURALS: Record<GeoCategory, string> = {
  city: 'Cities',
  school: 'Schools',
  synagogue: 'Synagogues',
}

export function GeoGapsList({ gaps, category }: GeoGapsListProps) {
  if (gaps.length === 0) return null

  const sorted = [...gaps].sort((a, b) => b.count - a.count)

  return (
    <div className="card-lodge overflow-hidden">
      <div className="bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4" />
          <span>
            {gaps.length} Unmapped {CATEGORY_PLURALS[category]}
          </span>
        </div>
      </div>
      <div className="max-h-60 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {sorted.map((item) => (
              <tr key={item.name} className="border-border border-t">
                <td className="text-foreground px-4 py-1.5">{item.name}</td>
                <td className="text-foreground w-16 px-4 py-1.5 text-right font-medium">
                  {item.count}
                </td>
                <td className="text-muted-foreground w-16 px-4 py-1.5 text-right text-xs">
                  {item.percentage.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default GeoGapsList
