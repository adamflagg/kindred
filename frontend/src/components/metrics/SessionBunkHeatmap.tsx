/**
 * SessionBunkHeatmap - 2D grid showing retention rates by session (rows) × bunk (columns).
 *
 * Split into sub-tables by gender area: Boys (B-*), Girls (G-*), All-Gender (AG-*).
 * Sessions sorted by date when sessionDateLookup provided, else by name.
 * Cells show retention percentages, color-coded:
 * Green (>=60%), amber (40-60%), red (<40%).
 * Missing session-bunk combos show "—" with neutral background.
 * Hovering any data cell shows retention stats; cells with staff also show counselors.
 */

import { useMemo, useState, useCallback } from 'react'
import type { RetentionBySessionBunk } from '../../types/metrics'
import type { SessionDateLookup } from '../../utils/sessionUtils'
import { compareByDateThenName } from '../../utils/sessionUtils'
import type { BunkStaffInfo } from '../../hooks/useBunkStaff'
import { BunkCellTooltip } from './BunkStaffTooltip'
import { getRetentionCellColor as getCellColor } from '../../utils/retentionColors'

type BunkCategory = 'boys' | 'girls' | 'ag'

const CATEGORY_LABELS: Record<BunkCategory, string> = {
  boys: 'Boys Cabins',
  girls: 'Girls Cabins',
  ag: 'All-Gender Cabins',
}

const CATEGORY_ORDER: BunkCategory[] = ['boys', 'girls', 'ag']

function categorizeBunk(bunk: string): BunkCategory | null {
  if (bunk.startsWith('AG-')) return 'ag'
  if (bunk.startsWith('B-')) return 'boys'
  if (bunk.startsWith('G-')) return 'girls'
  return null
}

function bunkSortKey(bunk: string): number {
  const level = bunk.replace(/^(AG-|[BG]-)/, '')
  if (level === 'Aleph') return -2
  if (level === 'Bet') return -1
  const n = parseInt(level, 10)
  return isNaN(n) ? 999 : n
}

interface BunkHeatmapTableProps {
  title: string
  sessions: string[]
  bunks: string[]
  lookup: Map<string, RetentionBySessionBunk>
  bunkStaff?: Map<string, BunkStaffInfo[]> | undefined
}

function BunkHeatmapTable({ title, sessions, bunks, lookup, bunkStaff }: BunkHeatmapTableProps) {
  const [hoveredCell, setHoveredCell] = useState<{ session: string; bunk: string } | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const staffMap = bunkStaff instanceof Map ? bunkStaff : undefined

  const handleMouseEnter = useCallback((session: string, bunk: string, e: React.MouseEvent) => {
    setHoveredCell({ session, bunk })
    setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!hoveredCell) return
      setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
    },
    [hoveredCell]
  )

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null)
  }, [])

  const hoveredItem = hoveredCell ? lookup.get(`${hoveredCell.session}|${hoveredCell.bunk}`) : null
  const hoveredStaff =
    hoveredCell && staffMap ? staffMap.get(`${hoveredCell.session}|${hoveredCell.bunk}`) : undefined

  return (
    <div data-section>
      <h4 className="text-muted-foreground mb-3 text-sm font-semibold">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="bg-muted text-muted-foreground sticky left-0 z-10 px-3 py-2 text-left font-medium" />
              {bunks.map((bunk) => (
                <th key={bunk} className="text-muted-foreground px-2 py-2 text-center font-medium">
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
                  className="bg-muted text-foreground border-border/50 sticky left-0 z-10 border px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                >
                  {session}
                </th>
                {bunks.map((bunk) => {
                  const item = lookup.get(`${session}|${bunk}`)
                  const hasStaff = staffMap?.has(`${session}|${bunk}`)
                  if (!item) {
                    return (
                      // No explicit role: <td> already has an implicit
                      // "cell" role in a plain (non-grid) table — restating
                      // it as role="cell" is what trips
                      // no-interactive-element-to-noninteractive-role, since
                      // aria-query's <td> schema is ambiguous between
                      // "cell" and "gridcell". getByRole('cell') still
                      // matches via the implicit role.
                      <td
                        key={bunk}
                        className="bg-muted/30 text-muted-foreground border-border/50 min-w-[2.5rem] border px-2 py-2 text-center"
                      >
                        —
                      </td>
                    )
                  }
                  const pct = Math.round(item.retention_rate * 100)
                  const cellClass = [
                    'min-w-[2.5rem] border border-border/50 px-2 py-2 text-center font-medium',
                    getCellColor(item.retention_rate),
                    hasStaff ? 'cursor-help' : 'cursor-default',
                  ].join(' ')
                  return (
                    // See the empty-cell branch above: role="cell" is
                    // redundant on a <td> and trips the interactive-role
                    // check via aria-query's ambiguous gridcell/cell schema.
                    <td
                      key={bunk}
                      className={cellClass}
                      onMouseEnter={(e) => handleMouseEnter(session, bunk, e)}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
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
      {hoveredCell && hoveredItem && (
        <BunkCellTooltip
          bunkName={hoveredCell.bunk}
          retention={{
            returnedCount: hoveredItem.returned_count,
            baseCount: hoveredItem.base_count,
            rate: hoveredItem.retention_rate,
          }}
          staff={hoveredStaff}
          isVisible={true}
          position={tooltipPos}
        />
      )}
    </div>
  )
}

interface SessionBunkHeatmapProps {
  data: RetentionBySessionBunk[]
  sessionDateLookup?: SessionDateLookup
  bunkStaff?: Map<string, BunkStaffInfo[]> | undefined
}

export function SessionBunkHeatmap({
  data,
  sessionDateLookup = {},
  bunkStaff,
}: SessionBunkHeatmapProps) {
  // The generic is load-bearing. Both `categoryBunks` maps are built as
  // `Record<string, string[]>` but read with a `BunkCategory` key, and the
  // empty-data branch returns a bare `{}`. Without an annotation those two
  // branches infer as a union (`Record<string, string[]> | {}`) that cannot be
  // indexed at all (tsc TS7053). This used to be held together by four
  // `as Partial<Record<BunkCategory, string[]>>` assertions, which
  // no-unnecessary-type-assertion flagged and #2669's sweep removed; stating
  // the memo's return type once is what they were approximating.
  const { categoryBunks, categorySessions, lookup } = useMemo<{
    categoryBunks: Partial<Record<BunkCategory, string[]>>
    categorySessions: Partial<Record<BunkCategory, string[]>>
    lookup: Map<string, RetentionBySessionBunk>
  }>(() => {
    if (!data.length)
      return {
        categoryBunks: {},
        categorySessions: {},
        lookup: new Map(),
      }

    const bunksByCategory = new Map<BunkCategory, Set<string>>()
    const sessionsByCategory = new Map<BunkCategory, Set<string>>()
    const map = new Map<string, RetentionBySessionBunk>()

    for (const item of data) {
      const cat = categorizeBunk(item.bunk)
      if (!cat) continue // skip bunks with non-standard prefixes

      let bunkSet = bunksByCategory.get(cat)
      if (!bunkSet) {
        bunkSet = new Set()
        bunksByCategory.set(cat, bunkSet)
      }
      bunkSet.add(item.bunk)

      let sessSet = sessionsByCategory.get(cat)
      if (!sessSet) {
        sessSet = new Set()
        sessionsByCategory.set(cat, sessSet)
      }
      sessSet.add(item.session)

      map.set(`${item.session}|${item.bunk}`, item)
    }

    const catBunks: Record<string, string[]> = {}
    for (const [cat, bunkSet] of bunksByCategory) {
      catBunks[cat] = [...bunkSet].sort((a, b) => bunkSortKey(a) - bunkSortKey(b))
    }

    const catSessions: Record<string, string[]> = {}
    for (const [cat, sessSet] of sessionsByCategory) {
      catSessions[cat] = [...sessSet].sort((a, b) => compareByDateThenName(a, b, sessionDateLookup))
    }

    return {
      categoryBunks: catBunks,
      categorySessions: catSessions,
      lookup: map,
    }
  }, [data, sessionDateLookup])

  const hasData = CATEGORY_ORDER.some((cat) => (categoryBunks[cat]?.length ?? 0) > 0)
  if (!hasData) return null

  return (
    <div className="card-lodge p-4">
      <div className="space-y-6">
        {CATEGORY_ORDER.filter((cat) => (categoryBunks[cat]?.length ?? 0) > 0).map((cat) => (
          <BunkHeatmapTable
            key={cat}
            title={CATEGORY_LABELS[cat]}
            sessions={categorySessions[cat] ?? []}
            bunks={categoryBunks[cat] ?? []}
            lookup={lookup}
            bunkStaff={bunkStaff}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-3 text-xs" data-tour="retention-bunks-legend">
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
