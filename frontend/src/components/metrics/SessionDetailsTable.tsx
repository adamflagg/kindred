import type { SessionBreakdown } from '../../types/metrics'
import { sessionName } from '../../utils/sessionName'
import { MUTED_PILL_CLASS } from '../velocity'
import { buildSessionDetailRows, type SessionDetailRow } from './sessionDetailRows'
import { formatCount, formatPercent, formatSignedCount } from '../../utils/numberFormat'
import { deltaInk } from '../../utils/deltaTokens'
import { useTableSort } from '../../hooks/useTableSort'
import { MetricSortHeader } from './MetricSortHeader'
import { TableExportButtons } from './TableExportButtons'
import { csvFilename } from './exportFilename'

type Field = 'name' | 'enrolled' | 'capacity' | 'utilization' | 'prior' | 'delta'

/** The Total row: sums of the column; utilization is over the sessions that have a capacity. */
export function sessionDetailTotals(rows: readonly SessionDetailRow[]) {
  const sum = (pick: (r: SessionDetailRow) => number | null) =>
    rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0)
  const capacity = sum((r) => r.capacity)
  const enrolledWithCapacity = sum((r) => (r.capacity ? r.enrolled : null))
  return {
    enrolled: sum((r) => r.enrolled),
    capacity,
    utilization: capacity > 0 ? (enrolledWithCapacity / capacity) * 100 : null,
    priorEnrolled: sum((r) => r.priorEnrolled),
    delta: sum((r) => r.delta),
  }
}

function deltaClass(delta: number | null): string {
  return deltaInk(delta ?? 0, 'up-good')
}

function utilizationClass(utilization: number): string {
  if (utilization > 100) return 'text-red-600 dark:text-red-400'
  if (utilization >= 90) return 'text-emerald-600 dark:text-emerald-400'
  return 'text-foreground'
}

/**
 * The Overview's Session Details table. In compare mode a prior-year session with no current
 * match shows as its own row after the current ones, with a muted "not offered in {year}" pill
 * (decision 43 / K8).
 */
export function SessionDetailsTable({
  current,
  prior,
  isComparing,
  currentYear,
  compareYear,
}: {
  current: readonly SessionBreakdown[]
  prior: readonly SessionBreakdown[] | null | undefined
  isComparing: boolean
  currentYear: number
  compareYear: number | null
}) {
  const comparing = isComparing && prior != null
  const naturalRows = buildSessionDetailRows(current, prior, isComparing)
  const sort = useTableSort<Field>('name')
  const rows = sort.apply(naturalRows, (row, field) => {
    switch (field) {
      case 'name':
        return sessionName(row.sessionName, undefined, 'chart')
      case 'enrolled':
        return row.enrolled
      case 'capacity':
        return row.capacity
      case 'utilization':
        return row.utilization
      case 'prior':
        return row.priorEnrolled
      case 'delta':
        return row.delta
    }
  })
  const totals = sessionDetailTotals(naturalRows)

  const headers = [
    'Session',
    'Enrolled',
    'Capacity',
    'Utilization %',
    ...(comparing ? [`${String(compareYear)} Enrolled`, 'Delta'] : []),
  ]
  const exportRows = [
    ...rows.map((row) => [
      sessionName(row.sessionName, undefined, 'chart') +
        (row.retired ? ` (not offered in ${String(currentYear)})` : ''),
      row.enrolled,
      row.capacity,
      row.utilization === null ? null : Math.round(row.utilization * 10) / 10,
      ...(comparing ? [row.priorEnrolled, row.delta] : []),
    ]),
    [
      'Total',
      totals.enrolled,
      totals.capacity,
      totals.utilization === null ? null : Math.round(totals.utilization * 10) / 10,
      ...(comparing ? [totals.priorEnrolled, totals.delta] : []),
    ],
  ]

  return (
    <>
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-foreground text-base font-semibold">Session Details</h3>
        <TableExportButtons
          filename={csvFilename(currentYear, 'Session Details')}
          headers={headers}
          rows={exportRows}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/30 border-b">
              <MetricSortHeader
                label="Session"
                align="left"
                direction={sort.direction('name')}
                onSort={() => sort.toggle('name')}
              />
              <MetricSortHeader
                label="Enrolled"
                direction={sort.direction('enrolled')}
                onSort={() => sort.toggle('enrolled')}
              />
              <MetricSortHeader
                label="Capacity"
                direction={sort.direction('capacity')}
                onSort={() => sort.toggle('capacity')}
              />
              <MetricSortHeader
                label="Utilization"
                direction={sort.direction('utilization')}
                onSort={() => sort.toggle('utilization')}
              />
              {comparing && (
                <>
                  <MetricSortHeader
                    label={`${String(compareYear)} Enrolled`}
                    direction={sort.direction('prior')}
                    onSort={() => sort.toggle('prior')}
                  />
                  <MetricSortHeader
                    label="Delta"
                    direction={sort.direction('delta')}
                    onSort={() => sort.toggle('delta')}
                  />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
              >
                <td className="text-foreground px-4 py-3 font-medium">
                  {sessionName(row.sessionName, undefined, 'chart')}
                  {row.priorName && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      (was: {row.priorName})
                    </span>
                  )}
                  {row.retired && (
                    <span className={MUTED_PILL_CLASS}>not offered in {currentYear}</span>
                  )}
                </td>
                <td className="text-foreground px-4 py-3 text-right">
                  {formatCount(row.enrolled)}
                </td>
                <td className="text-foreground px-4 py-3 text-right">
                  {formatCount(row.capacity)}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.utilization !== null ? (
                    <span className={utilizationClass(row.utilization)}>
                      {formatPercent(row.utilization)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {comparing && (
                  <>
                    <td className="text-foreground px-4 py-3 text-right">
                      {formatCount(row.priorEnrolled)}
                    </td>
                    <td className={`px-4 py-3 text-right ${deltaClass(row.delta)}`}>
                      {row.delta !== null ? formatSignedCount(row.delta) : '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
            <tr className="border-border bg-muted/30 border-t font-semibold">
              <td className="text-foreground px-4 py-3">Total</td>
              <td className="text-foreground px-4 py-3 text-right">
                {formatCount(totals.enrolled)}
              </td>
              <td className="text-foreground px-4 py-3 text-right">
                {formatCount(totals.capacity)}
              </td>
              <td className="px-4 py-3 text-right">
                {totals.utilization !== null ? (
                  <span className={utilizationClass(totals.utilization)}>
                    {formatPercent(totals.utilization)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              {comparing && (
                <>
                  <td className="text-foreground px-4 py-3 text-right">
                    {formatCount(totals.priorEnrolled)}
                  </td>
                  <td className={`px-4 py-3 text-right ${deltaClass(totals.delta)}`}>
                    {formatSignedCount(totals.delta)}
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
