/**
 * RetentionNotableOutliers - Compact display of geographic categories
 * with retention rates notably above or below the overall average.
 */

import type { RetentionOutlier } from '../../utils/retentionTransforms'

interface RetentionNotableOutliersProps {
  cityOutliers: RetentionOutlier[]
  schoolOutliers: RetentionOutlier[]
  synagogueOutliers: RetentionOutlier[]
  maxPerCategory?: number
}

function OutlierSection({
  label,
  outliers,
  max,
}: {
  label: string
  outliers: RetentionOutlier[]
  max: number
}) {
  if (outliers.length === 0) return null

  return (
    <div className="space-y-1">
      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</h4>
      <ul className="space-y-0.5">
        {outliers.slice(0, max).map((o) => {
          const rate = Math.round(o.retentionRate * 100)
          const isAbove = o.deviation > 0
          return (
            <li key={o.name} className="text-sm">
              <span className="text-foreground font-medium">{o.name}:</span>{' '}
              <span className="text-muted-foreground">
                {rate}% ({o.returnedCount}/{o.baseCount})
              </span>{' '}
              <span
                className={
                  isAbove
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }
              >
                {isAbove ? '+' : ''}
                {o.deviation}pp {isAbove ? 'above' : 'below'} avg
              </span>
              {(() => {
                const diff = Math.abs(o.returnedCount - o.expectedCount)
                if (diff === 0) return null
                return (
                  <span className="text-muted-foreground ml-1 text-xs">
                    (~{diff} {isAbove ? 'more' : 'fewer'} than expected)
                  </span>
                )
              })()}
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
      <h3 className="text-foreground mb-3 text-sm font-semibold">Notable Outliers</h3>
      <div className="space-y-3">
        <OutlierSection label="City" outliers={cityOutliers} max={maxPerCategory} />
        <OutlierSection label="School" outliers={schoolOutliers} max={maxPerCategory} />
        <OutlierSection label="Synagogue" outliers={synagogueOutliers} max={maxPerCategory} />
      </div>
    </div>
  )
}
