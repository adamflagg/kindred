/**
 * GapsPanel — Three-tier gap display for geo management.
 *
 * Displays gaps in three sections:
 * 1. Canonical — Missing Coordinates: known canonicals without lat/lng
 * 2. Non-Canonical — Grouped: raw values mapped to multiple sources
 * 3. Non-Canonical — Ungrouped: raw values with no grouping
 *
 * Sierra lodge theming with warm amber/brown card styling.
 * All sections sorted by camper count descending (highest-impact first).
 */

import { MapPin, AlertCircle, HelpCircle, CheckCircle } from 'lucide-react'
import type { GapItem, GapsResponse } from '../../../services/geoService'
import type { GeoCategory } from '../geoConstants'

export interface GapsPanelProps {
  gaps: GapsResponse
  category: GeoCategory
  year: number
  onResolve?: (gapName: string, gapType: string) => void
}

/** Sort gap items by count descending (highest-impact first). */
function sortByCount(items: GapItem[]): GapItem[] {
  return [...items].sort((a, b) => b.count - a.count)
}

/** Render a single gap section with items, header, and action buttons. */
function GapSection({
  testId,
  icon,
  title,
  headerClasses,
  items,
  actionLabel,
  gapType,
  onResolve,
}: {
  testId: string
  icon: React.ReactNode
  title: string
  headerClasses: string
  items: GapItem[]
  actionLabel: string
  gapType: string
  onResolve?: ((gapName: string, gapType: string) => void) | undefined
}): React.ReactNode {
  if (items.length === 0) return null

  const sorted = sortByCount(items)

  return (
    <div data-testid={testId} className="card-lodge overflow-hidden">
      <div className={`px-4 py-2.5 ${headerClasses}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          <span>{title}</span>
        </div>
      </div>
      <div className="max-h-60 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {sorted.map((item) => (
              <tr key={item.name} className="border-border border-t">
                <td className="text-foreground px-4 py-1.5">
                  <span data-testid="gap-item-name">{item.name}</span>
                </td>
                <td className="text-foreground w-16 px-4 py-1.5 text-right font-medium">
                  {item.count}
                </td>
                {item.source_count > 0 && (
                  <td className="text-muted-foreground w-20 px-4 py-1.5 text-right text-xs">
                    {item.source_count} {item.source_count === 1 ? 'variant' : 'variants'}
                  </td>
                )}
                <td className="w-28 px-4 py-1.5 text-right">
                  <button
                    className="text-forest-700 hover:text-forest-900 dark:text-forest-400 dark:hover:text-forest-200 text-xs font-medium transition-colors"
                    onClick={() => onResolve?.(item.name, gapType)}
                  >
                    {actionLabel}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function GapsPanel({ gaps, category: _category, year: _year, onResolve }: GapsPanelProps) {
  const hasAnyGaps =
    gaps.canonical_no_coords.length > 0 ||
    gaps.non_canonical_grouped.length > 0 ||
    gaps.non_canonical_ungrouped.length > 0

  if (!hasAnyGaps) {
    return (
      <div className="card-lodge flex items-center gap-3 border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
        <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          No gaps — all entries matched
        </span>
      </div>
    )
  }

  // Spread onResolve only when defined (exactOptionalPropertyTypes compat)
  const resolveProps = onResolve ? { onResolve } : {}

  return (
    <div className="space-y-3">
      <GapSection
        testId="section-canonical-no-coords"
        icon={<MapPin className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
        title={`Canonical — Missing Coordinates (${gaps.canonical_no_coords.length})`}
        headerClasses="bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        items={gaps.canonical_no_coords}
        actionLabel="Add Location"
        gapType="canonical_no_coords"
        {...resolveProps}
      />
      <GapSection
        testId="section-non-canonical-grouped"
        icon={<AlertCircle className="h-4 w-4 text-red-700 dark:text-red-400" />}
        title={`Non-Canonical — Grouped (${gaps.non_canonical_grouped.length})`}
        headerClasses="bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200"
        items={gaps.non_canonical_grouped}
        actionLabel="Resolve"
        gapType="non_canonical_grouped"
        {...resolveProps}
      />
      <GapSection
        testId="section-non-canonical-ungrouped"
        icon={<HelpCircle className="h-4 w-4 text-stone-600 dark:text-stone-400" />}
        title={`Non-Canonical — Ungrouped (${gaps.non_canonical_ungrouped.length})`}
        headerClasses="bg-stone-100 text-stone-700 dark:bg-stone-800/30 dark:text-stone-300"
        items={gaps.non_canonical_ungrouped}
        actionLabel="Resolve"
        gapType="non_canonical_ungrouped"
        {...resolveProps}
      />
    </div>
  )
}

export default GapsPanel
