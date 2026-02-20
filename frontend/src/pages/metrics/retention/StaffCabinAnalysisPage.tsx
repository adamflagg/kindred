/**
 * StaffCabinAnalysisPage - Staff-centric view of cabin retention rates.
 *
 * Table layout: rows = staff members, columns = sessions, cells = bunk name + retention %.
 * Overall column shows weighted average retention across all sessions.
 * Sortable by staff name or overall retention.
 */

import { useState, useMemo } from 'react'
import { Users, ArrowUp, ArrowDown } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useStaffRetentionData } from '../../../hooks/useStaffRetentionData'
import type { StaffRetentionRow } from '../../../hooks/useStaffRetentionData'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'
import { getRetentionCellColor } from '../../../utils/retentionColors'

type SortField = 'name' | 'overall'
type SortDir = 'asc' | 'desc'

function sortRows(rows: StaffRetentionRow[], field: SortField, dir: SortDir): StaffRetentionRow[] {
  return [...rows].sort((a, b) => {
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

  const { staffRows, sessions, isLoading, error } = useStaffRetentionData(priorYear, currentYear)

  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? (
      <ArrowUp className="inline h-3 w-3" />
    ) : (
      <ArrowDown className="inline h-3 w-3" />
    )
  }

  // Wrap data for MetricsQueryGuard: it needs a truthy data object
  const guardData = staffRows.length > 0 ? { staffRows, sessions } : undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground flex items-center gap-2 text-2xl font-bold">
          <Users className="text-primary h-6 w-6" />
          Staff Cabin Analysis ({priorYear})
        </h1>
        <p className="text-muted-foreground mt-1">
          Retention rates by staff member across their cabin assignments
        </p>
      </div>

      <MetricsQueryGuard
        isLoading={isLoading}
        error={error}
        data={guardData}
        label="staff retention"
        emptyMessage="No staff retention data available"
      >
        {() => (
          <div className="card-lodge p-4">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" role="table">
                <thead>
                  <tr>
                    <th
                      role="columnheader"
                      className="bg-muted/50 text-muted-foreground sticky left-0 z-10 cursor-pointer px-3 py-2 text-left font-medium select-none"
                      onClick={() => handleSort('name')}
                    >
                      Staff <SortIcon field="name" />
                    </th>
                    {sessions.map((session) => (
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
                    >
                      Overall <SortIcon field="overall" />
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
                        {row.name}
                      </th>
                      {sessions.map((session) => {
                        const data = row.sessionData.get(session)
                        if (!data) {
                          return (
                            <td
                              key={session}
                              className="bg-muted/30 text-muted-foreground px-2 py-2 text-center"
                            >
                              ---
                            </td>
                          )
                        }
                        const pct = Math.round(data.retentionRate * 100)
                        return (
                          <td
                            key={session}
                            className={`px-2 py-2 text-center ${getRetentionCellColor(data.retentionRate)}`}
                            title={`${data.returnedCount} of ${data.baseCount} returned`}
                          >
                            <div className="text-[10px] leading-tight opacity-80">
                              {data.bunkName}
                            </div>
                            <div className="font-bold">{pct}%</div>
                          </td>
                        )
                      })}
                      <td
                        className={`sticky right-0 z-10 px-3 py-2 text-center font-bold ${getRetentionCellColor(row.overallRetention)}`}
                        title={`${row.totalReturnedCount} of ${row.totalBaseCount} returned`}
                      >
                        {Math.round(row.overallRetention * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        )}
      </MetricsQueryGuard>
    </div>
  )
}
