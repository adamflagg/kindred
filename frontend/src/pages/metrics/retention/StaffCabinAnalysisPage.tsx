/**
 * StaffCabinAnalysisPage - Staff-centric view of cabin retention rates.
 *
 * Table layout: rows = staff members, columns = sessions, cells = bunk name + retention %.
 * Overall column shows weighted average retention across all sessions.
 * Sortable by staff name or overall retention.
 * Portal-based tooltips with co-staff info on hover.
 * Session columns sorted chronologically.
 */

import { useState, useMemo, useCallback } from 'react'
import { Users } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useStaffRetentionData } from '../../../hooks/useStaffRetentionData'
import type { StaffRetentionRow } from '../../../hooks/useStaffRetentionData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'
import { SortIcon } from '../../../components/metrics/SortIcon'
import { BunkCellTooltip } from '../../../components/metrics/BunkStaffTooltip'
import type { BunkStaffInfo } from '../../../hooks/useBunkStaff'
import { getRetentionCellColor } from '../../../utils/retentionColors'
import { buildSessionDateLookup, compareByDateThenName } from '../../../utils/sessionUtils'

type SortField = 'name' | 'overall'
type SortDir = 'asc' | 'desc'

interface HoveredCell {
  rowPersonId: string
  session: string // session name or '__overall__'
  bunkName: string
}

function sortRows(rows: StaffRetentionRow[], field: SortField, dir: SortDir): StaffRetentionRow[] {
  return rows.toSorted((a, b) => {
    let cmp: number
    if (field === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else {
      cmp = a.overallRetention - b.overallRetention
    }
    return dir === 'desc' ? -cmp : cmp
  })
}

export default function StaffCabinAnalysisPage() {
  const { currentYear } = useCurrentYear()
  const priorYear = currentYear - 1

  const { staffRows, sessions, bunkStaff, isLoading, error } = useStaffRetentionData(
    priorYear,
    currentYear
  )
  const { campSessions } = useMetricsSession()
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Sort sessions chronologically
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(campSessions), [campSessions])
  const sortedSessions = useMemo(
    () => sessions.toSorted((a, b) => compareByDateThenName(a, b, sessionDateLookup)),
    [sessions, sessionDateLookup]
  )

  const sortedRows = useMemo(
    () => sortRows(staffRows, sortField, sortDir),
    [staffRows, sortField, sortDir]
  )

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'overall' ? 'desc' : 'asc')
    }
  }

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, rowPersonId: string, session: string, bunkName: string) => {
      setHoveredCell({ rowPersonId, session, bunkName })
      setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
    },
    []
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (hoveredCell) {
        setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
      }
    },
    [hoveredCell]
  )

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null)
  }, [])

  // Compute tooltip data from hovered cell
  const tooltipData = useMemo(() => {
    if (!hoveredCell) return null

    const row = staffRows.find((r) => r.personId === hoveredCell.rowPersonId)
    if (!row) return null

    if (hoveredCell.session === '__overall__') {
      return {
        bunkName: 'Overall',
        retention: {
          returnedCount: row.totalReturnedCount,
          baseCount: row.totalBaseCount,
          rate: row.overallRetention,
        },
        staff: undefined as BunkStaffInfo[] | undefined,
      }
    }

    const sessionData = row.sessionData.get(hoveredCell.session)
    if (!sessionData) return null

    // Look up co-staff from bunkStaff map, filtering out current row's person
    const key = `${hoveredCell.session}|${hoveredCell.bunkName}`
    const allStaff = bunkStaff.get(key)
    const coStaff = allStaff?.filter((s: BunkStaffInfo) => s.personId !== hoveredCell.rowPersonId)
    const staffList = coStaff && coStaff.length > 0 ? coStaff : undefined

    return {
      bunkName: hoveredCell.bunkName,
      retention: {
        returnedCount: sessionData.returnedCount,
        baseCount: sessionData.baseCount,
        rate: sessionData.retentionRate,
      },
      staff: staffList,
    }
  }, [hoveredCell, staffRows, bunkStaff])

  // Wrap data for MetricsQueryGuard: it needs a truthy data object
  const guardData = staffRows.length > 0 ? { staffRows, sessions } : undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
            <Users className="text-primary h-5 w-5" />
            Staff Cabin Analysis ({priorYear})
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Retention rates by staff member across their cabin assignments
          </p>
        </div>
      </div>

      <MetricsQueryGuard
        isLoading={isLoading}
        error={error}
        data={guardData}
        label="staff retention"
        emptyMessage="No staff retention data available"
      >
        {() => (
          <div className="card-lodge p-4" data-tour="retention-staff-table">
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-xs" role="table">
                <thead>
                  <tr>
                    <th
                      role="columnheader"
                      className="bg-muted/50 text-muted-foreground sticky left-0 z-10 cursor-pointer px-3 py-2 text-left font-medium select-none"
                      onClick={() => handleSort('name')}
                      data-tour="retention-staff-sort-name"
                    >
                      Staff{' '}
                      <SortIcon
                        field="name"
                        activeField={sortField}
                        direction={sortDir}
                        className="inline h-3 w-3"
                      />
                    </th>
                    {sortedSessions.map((session) => (
                      <th
                        key={session}
                        role="columnheader"
                        className="text-muted-foreground px-2 py-2 text-center font-medium"
                      >
                        {session}
                      </th>
                    ))}
                    <th
                      role="columnheader"
                      className="bg-muted/50 text-muted-foreground sticky right-0 z-10 cursor-pointer px-3 py-2 text-center font-medium select-none"
                      onClick={() => handleSort('overall')}
                      data-tour="retention-staff-sort-overall"
                    >
                      Overall{' '}
                      <SortIcon
                        field="overall"
                        activeField={sortField}
                        direction={sortDir}
                        className="inline h-3 w-3"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.personId}>
                      <th
                        scope="row"
                        className="bg-muted/50 text-foreground sticky left-0 z-10 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                      >
                        {row.status && row.status !== 'active' ? (
                          <>
                            <span className="line-through opacity-60">{row.name}</span>{' '}
                            <span className="text-muted-foreground text-[10px] font-normal">
                              ({row.status})
                            </span>
                          </>
                        ) : (
                          row.name
                        )}
                      </th>
                      {sortedSessions.map((session) => {
                        const data = row.sessionData.get(session)
                        if (!data) {
                          return (
                            <td
                              key={session}
                              className="bg-muted/30 text-muted-foreground border-border/50 min-w-[2.5rem] border px-2 py-2 text-center"
                            >
                              ---
                            </td>
                          )
                        }
                        const pct = Math.round(data.retentionRate * 100)
                        return (
                          <td
                            key={session}
                            className={`border-border/50 min-w-[2.5rem] cursor-help border px-2 py-2 text-center ${getRetentionCellColor(data.retentionRate)}`}
                            onMouseEnter={(e) =>
                              handleMouseEnter(e, row.personId, session, data.bunkName)
                            }
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                          >
                            <div className="text-[10px] leading-tight opacity-80">
                              {data.bunkName}
                            </div>
                            <div className="font-bold">{pct}%</div>
                          </td>
                        )
                      })}
                      <td
                        className={`border-border/50 sticky right-0 z-10 cursor-help border px-3 py-2 text-center font-bold ${getRetentionCellColor(row.overallRetention)}`}
                        onMouseEnter={(e) =>
                          handleMouseEnter(e, row.personId, '__overall__', 'Overall')
                        }
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                      >
                        {Math.round(row.overallRetention * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div
              className="mt-4 flex items-center gap-3 text-xs"
              data-tour="retention-staff-legend"
            >
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

            <BunkCellTooltip
              bunkName={tooltipData?.bunkName ?? ''}
              retention={tooltipData?.retention ?? { returnedCount: 0, baseCount: 0, rate: 0 }}
              staff={tooltipData?.staff}
              staffLabel="Co-Staff"
              isVisible={!!tooltipData}
              position={tooltipPos}
            />
          </div>
        )}
      </MetricsQueryGuard>
    </div>
  )
}
