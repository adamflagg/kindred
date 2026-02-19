/**
 * RetentionNotableOutliers - Compact display of geographic categories
 * with retention rates notably above or below the overall average.
 */

import { TrendingUp, TrendingDown } from 'lucide-react'
import type { RetentionOutlier } from '../../utils/retentionTransforms'

interface RetentionNotableOutliersProps {
  cityOutliers: RetentionOutlier[]
  schoolOutliers: RetentionOutlier[]
  synagogueOutliers: RetentionOutlier[]
  maxPerCategory?: number
}

export function OutlierSection({ outliers, max }: { outliers: RetentionOutlier[]; max: number }) {
  if (outliers.length === 0) return null

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground text-base font-semibold">Notable Changes</h3>
      <ul className="divide-border mt-2 divide-y">
        {outliers.slice(0, max).map((o) => {
          const rate = Math.round(o.retentionRate * 100)
          const isAbove = o.deviation > 0
          const Icon = isAbove ? TrendingUp : TrendingDown
          return (
            <li key={o.name} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-foreground truncate text-sm font-medium">{o.name}</span>
                  <span className="text-muted-foreground text-sm">{rate}%</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {o.returnedCount} of {o.baseCount} returned
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                  isAbove
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                }`}
              >
                <Icon className="h-3 w-3" />
                {isAbove ? '+' : ''}
                {o.deviation}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function RetentionNotableOutliers({
  cityOutliers,
  schoolOutliers,
  synagogueOutliers,
  maxPerCategory = 5,
}: RetentionNotableOutliersProps) {
  if (cityOutliers.length === 0 && schoolOutliers.length === 0 && synagogueOutliers.length === 0) {
    return null
  }

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-3 text-base font-semibold">Notable Outliers</h3>
      <div className="space-y-3">
        <OutlierSection outliers={cityOutliers} max={maxPerCategory} />
        <OutlierSection outliers={schoolOutliers} max={maxPerCategory} />
        <OutlierSection outliers={synagogueOutliers} max={maxPerCategory} />
      </div>
    </div>
  )
}
