/**
 * GeoGapsList - Shows items not matched by canonical lookup.
 *
 * Items without coordinates are "gaps" - they weren't found in the
 * canonical JSON lookup (schools.json, congregations.json, etc.).
 *
 * When sourceMappings is provided, gaps are split into two sections:
 * - **Unmapped canonicals**: The normalizer matched them to a canonical,
 *   but the canonical has no coordinates. These need location data added.
 * - **Unresolved values**: Raw values that the normalizer could not match.
 *   Usually one-off typos or genuinely unknown entries.
 *
 * Without sourceMappings, all gaps display as "Unmapped" (legacy behavior).
 * Sorted by count descending so high-impact gaps appear first.
 */

import { AlertCircle, MapPin } from 'lucide-react'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategory } from './GeoCategoryTabs'
import type { SourceMapping } from '../../../hooks/useSourceMappings'

interface GeoGapsListProps {
  gaps: GeoDataItem[]
  category: GeoCategory
  sourceMappings?: Map<string, SourceMapping[]> | undefined
}

const CATEGORY_PLURALS: Record<GeoCategory, string> = {
  city: 'Cities',
  school: 'Schools',
  synagogue: 'Synagogues',
}

const CATEGORY_SINGULARS: Record<GeoCategory, string> = {
  city: 'City',
  school: 'School',
  synagogue: 'Synagogue',
}

function categoryLabel(category: GeoCategory, count: number): string {
  return count === 1 ? CATEGORY_SINGULARS[category] : CATEGORY_PLURALS[category]
}

/** Shared table rendering for a list of gap items */
function GapTable({ items }: { items: GeoDataItem[] }) {
  const sorted = [...items].sort((a, b) => b.count - a.count)
  return (
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
  )
}

export function GeoGapsList({ gaps, category, sourceMappings }: GeoGapsListProps) {
  if (gaps.length === 0) return null

  // Without sourceMappings, show all as "Unmapped" (legacy)
  if (!sourceMappings) {
    return (
      <div className="card-lodge overflow-hidden">
        <div className="bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-4 w-4" />
            <span>
              {gaps.length} Unmapped {categoryLabel(category, gaps.length)}
            </span>
          </div>
        </div>
        <GapTable items={gaps} />
      </div>
    )
  }

  // Split into unmapped canonicals vs unresolved values
  const unmapped: GeoDataItem[] = []
  const unresolved: GeoDataItem[] = []

  for (const item of gaps) {
    if (sourceMappings.has(item.name)) {
      unmapped.push(item)
    } else {
      unresolved.push(item)
    }
  }

  return (
    <div className="space-y-3">
      {unmapped.length > 0 && (
        <div className="card-lodge overflow-hidden">
          <div className="bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <MapPin className="h-4 w-4" />
              <span>
                {unmapped.length} Unmapped {categoryLabel(category, unmapped.length)}
              </span>
            </div>
          </div>
          <GapTable items={unmapped} />
        </div>
      )}
      {unresolved.length > 0 && (
        <div className="card-lodge overflow-hidden">
          <div className="bg-red-50 px-4 py-2.5 dark:bg-red-950/30">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span>
                {unresolved.length} Unresolved {categoryLabel(category, unresolved.length)}
              </span>
            </div>
          </div>
          <GapTable items={unresolved} />
        </div>
      )}
    </div>
  )
}

export default GeoGapsList
