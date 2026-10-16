import type { SessionBreakdown } from '../../types/metrics'
import { sessionName } from '../../utils/sessionName'
import { MUTED_PILL_CLASS } from '../velocity'
import { buildSessionDetailRows } from './sessionDetailRows'
import { formatCount, formatPercent, formatSignedCount } from '../../utils/numberFormat'
import { deltaInk } from '../../utils/deltaTokens'

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
  const rows = buildSessionDetailRows(current, prior, isComparing)

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-border bg-muted/30 border-b">
          <th className="text-muted-foreground px-4 py-3 text-left font-medium">Session</th>
          <th className="text-muted-foreground px-4 py-3 text-right font-medium">Enrolled</th>
          <th className="text-muted-foreground px-4 py-3 text-right font-medium">Capacity</th>
          <th className="text-muted-foreground px-4 py-3 text-right font-medium">Utilization</th>
          {comparing && (
            <>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                {compareYear} Enrolled
              </th>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">Delta</th>
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
                <span className="text-muted-foreground ml-1 text-xs">(was: {row.priorName})</span>
              )}
              {row.retired && (
                <span className={MUTED_PILL_CLASS}>not offered in {currentYear}</span>
              )}
            </td>
            <td className="text-foreground px-4 py-3 text-right">{formatCount(row.enrolled)}</td>
            <td className="text-foreground px-4 py-3 text-right">{formatCount(row.capacity)}</td>
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
      </tbody>
    </table>
  )
}
