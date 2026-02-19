/**
 * SessionBunkHeatmap - 2D grid showing retention rates by session (rows) × bunk (columns).
 *
 * Split into sub-tables by gender area: Boys (B-*), Girls (G-*), All-Gender (AG-*).
 * Sessions sorted by date when sessionDateLookup provided, else by name.
 * Cells show retention percentages, color-coded:
 * Green (>=60%), amber (40-60%), red (<40%).
 * Missing session-bunk combos show "—" with neutral background.
 */

import { useMemo } from 'react'
import type { RetentionBySessionBunk } from '../../types/metrics'
import type { SessionDateLookup } from '../../utils/sessionUtils'
import { compareByDateThenName } from '../../utils/sessionUtils'

function getCellColor(rate: number): string {
  const pct = Math.round(rate * 100)
  if (pct >= 60) return 'bg-emerald-600/80 text-white'
  if (pct >= 40) return 'bg-amber-500/80 text-white'
  return 'bg-red-600/80 text-white'
}

type BunkCategory = 'boys' | 'girls' | 'ag' | 'other'

const CATEGORY_LABELS: Record<BunkCategory, string> = {
  boys: 'Boys Cabins',
  girls: 'Girls Cabins',
  ag: 'All-Gender Cabins',
  other: 'Other Cabins',
}

const CATEGORY_ORDER: BunkCategory[] = ['boys', 'girls', 'ag', 'other']

function categorizeBunk(bunk: string): BunkCategory {
  if (bunk.startsWith('AG-')) return 'ag'
  if (bunk.startsWith('B-')) return 'boys'
  if (bunk.startsWith('G-')) return 'girls'
  return 'other'
}

interface BunkHeatmapTableProps {
  title: string
  sessions: string[]
  bunks: string[]
  lookup: Map<string, RetentionBySessionBunk>
}

function BunkHeatmapTable({ title, sessions, bunks, lookup }: BunkHeatmapTableProps) {
  return (
    <div data-section>
      <h4 className="text-muted-foreground mb-2 text-xs font-semibold">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="bg-muted/50 text-muted-foreground sticky left-0 z-10 px-3 py-2 text-left font-medium" />
              {bunks.map((bunk) => (
                <th
                  key={bunk}
                  className="text-muted-foreground px-2 py-2 text-center font-medium"
                >
                  {bunk}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session}>
                <th
                  scope="row"
                  className="bg-muted/50 text-foreground sticky left-0 z-10 whitespace-nowrap px-3 py-2 text-left text-xs font-semibold"
                >
                  {session}
                </th>
                {bunks.map((bunk) => {
                  const item = lookup.get(`${session}|${bunk}`)
                  if (!item) {
                    return (
                      <td
                        key={bunk}
                        role="cell"
                        className="bg-muted/30 text-muted-foreground px-2 py-2 text-center"
                      >
                        —
                      </td>
                    )
                  }
                  const pct = Math.round(item.retention_rate * 100)
                  return (
                    <td
                      key={bunk}
                      role="cell"
                      title={`${item.returned_count} of ${item.base_count} returned (${pct}%)`}
                      className={`px-2 py-2 text-center font-medium ${getCellColor(item.retention_rate)}`}
                    >
                      {pct}%
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface SessionBunkHeatmapProps {
  data: RetentionBySessionBunk[]
  sessionDateLookup?: SessionDateLookup
}

export function SessionBunkHeatmap({ data, sessionDateLookup = {} }: SessionBunkHeatmapProps) {
  const { sessions, categoryBunks, lookup } = useMemo(() => {
    if (!data.length)
      return {
        sessions: [] as string[],
        categoryBunks: {} as Record<BunkCategory, string[]>,
        lookup: new Map(),
      }

    const sessionSet = new Set<string>()
    const bunksByCategory = new Map<BunkCategory, Set<string>>()
    const map = new Map<string, RetentionBySessionBunk>()

    for (const item of data) {
      sessionSet.add(item.session)
      const cat = categorizeBunk(item.bunk)
      let catSet = bunksByCategory.get(cat)
      if (!catSet) {
        catSet = new Set()
        bunksByCategory.set(cat, catSet)
      }
      catSet.add(item.bunk)
      map.set(`${item.session}|${item.bunk}`, item)
    }

    const sortedSessions = [...sessionSet].sort((a, b) =>
      compareByDateThenName(a, b, sessionDateLookup),
    )

    const catBunks: Record<string, string[]> = {}
    for (const [cat, bunkSet] of bunksByCategory) {
      catBunks[cat] = [...bunkSet].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      )
    }

    return {
      sessions: sortedSessions,
      categoryBunks: catBunks as Record<BunkCategory, string[]>,
      lookup: map,
    }
  }, [data, sessionDateLookup])

  if (sessions.length === 0) return null

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-sm font-medium">
        Retention by Session + Bunk
      </h3>

      <div className="space-y-6">
        {CATEGORY_ORDER.filter((cat) => categoryBunks[cat]?.length > 0).map((cat) => (
          <BunkHeatmapTable
            key={cat}
            title={CATEGORY_LABELS[cat]}
            sessions={sessions}
            bunks={categoryBunks[cat]}
            lookup={lookup}
          />
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
