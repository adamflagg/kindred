/**
 * SessionBunkHeatmap - Grouped heatmap showing retention rates by session and bunk.
 *
 * Groups bunks by session with colored cells indicating retention rate.
 * Green (>=60%), amber (40-60%), red (<40%) matching RetentionRateBarChart colors.
 */

import { useMemo } from 'react'
import type { RetentionBySessionBunk } from '../../types/metrics'

function getCellColor(rate: number): string {
  const pct = Math.round(rate * 100)
  if (pct >= 60) return 'bg-emerald-600/80 text-white'
  if (pct >= 40) return 'bg-amber-500/80 text-white'
  return 'bg-red-600/80 text-white'
}

interface SessionBunkHeatmapProps {
  data: RetentionBySessionBunk[]
}

export function SessionBunkHeatmap({ data }: SessionBunkHeatmapProps) {
  const grouped = useMemo(() => {
    if (!data.length) return new Map<string, RetentionBySessionBunk[]>()

    const map = new Map<string, RetentionBySessionBunk[]>()
    for (const item of data) {
      const existing = map.get(item.session)
      if (existing) {
        existing.push(item)
      } else {
        map.set(item.session, [item])
      }
    }

    // Sort bunks naturally within each group
    for (const bunks of map.values()) {
      bunks.sort((a, b) => a.bunk.localeCompare(b.bunk, undefined, { numeric: true }))
    }

    return map
  }, [data])

  if (grouped.size === 0) return null

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-sm font-medium">Retention by Session + Bunk</h3>

      <div className="space-y-4">
        {[...grouped.entries()].map(([session, bunks]) => (
          <div key={session}>
            <h4 className="text-foreground mb-2 text-xs font-semibold">{session}</h4>
            <div className="flex flex-wrap gap-1.5">
              {bunks.map((item) => {
                const pct = Math.round(item.retention_rate * 100)
                return (
                  <div
                    key={`${item.session}-${item.bunk}`}
                    data-testid="heatmap-cell"
                    className={`group relative rounded px-2 py-1 text-xs font-medium ${getCellColor(item.retention_rate)}`}
                  >
                    <div>{item.bunk}</div>
                    <div>{pct}%</div>
                    <div className="invisible absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg group-hover:visible">
                      {item.returned_count} of {item.base_count} returned ({pct}%)
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">Retention:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-red-600/80" />
          Low (&lt;40%)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-amber-500/80" />
          Mid (40-60%)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-emerald-600/80" />
          High (&ge;60%)
        </span>
      </div>
    </div>
  )
}
