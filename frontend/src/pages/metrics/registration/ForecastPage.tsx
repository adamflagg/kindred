import { useMemo } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useForecast } from '../../../hooks/useForecast'
import { MetricCard } from '../../../components/metrics/MetricCard'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
} from '../../../utils/sessionUtils'
import type { SessionForecast } from '../../../types/forecast'

function pctColor(pct: number | null): string {
  if (pct === null) return ''
  if (pct >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function fmt(value: number | null, suffix = ''): string {
  if (value === null) return '---'
  return `${value.toLocaleString()}${suffix}`
}

function deltaColor(value: number | null): string {
  if (value === null || value === 0) return 'text-muted-foreground'
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

function fmtSigned(value: number | null): string {
  if (value === null) return '---'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toLocaleString()}`
}

function fmtSignedCurrency(value: number | null): string {
  if (value === null) return '---'
  const abs = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  if (value > 0) return `+$${abs}`
  if (value < 0) return `-$${abs}`
  return `$${abs}`
}

function fmtCurrency(value: number | null): string {
  if (value === null) return '---'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(value: number | null): string {
  if (value === null) return '---'
  return `${value.toFixed(1)}%`
}

function ForecastTableHeader() {
  return (
    <thead>
      <tr className="bg-muted/50">
        <th className="px-3 py-2 text-left text-xs font-semibold">Session</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Goal</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Enrolled</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">WL</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">% Goal</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">vs Budget</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Prior Yr</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">vs Prior</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">2yr Prior</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Capacity</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Util%</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Fee</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Budget Rev</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Actual Rev</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Delta $</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Rev%</th>
      </tr>
    </thead>
  )
}

function SessionRow({ session, isTotal }: { session: SessionForecast; isTotal?: boolean }) {
  const rowClass = isTotal ? 'font-bold bg-muted/30' : 'border-border border-b last:border-b-0'

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2 text-sm whitespace-nowrap">{session.session_name}</td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.participant_goal)}</td>
      <td className="px-3 py-2 text-right text-sm font-medium">{session.enrolled.toLocaleString()}</td>
      <td className="px-3 py-2 text-right text-sm">{session.waitlisted.toLocaleString()}</td>
      <td className={`px-3 py-2 text-right text-sm font-medium ${pctColor(session.pct_of_goal)}`}>
        {fmtPct(session.pct_of_goal)}
      </td>
      <td className={`px-3 py-2 text-right text-sm ${deltaColor(session.participants_vs_budget)}`}>
        {fmtSigned(session.participants_vs_budget)}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.prior_year_count)}</td>
      <td className={`px-3 py-2 text-right text-sm ${deltaColor(session.participants_vs_prior_year)}`}>
        {fmtSigned(session.participants_vs_prior_year)}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.two_year_prior_count)}</td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.capacity)}</td>
      <td className={`px-3 py-2 text-right text-sm ${pctColor(session.utilization_pct)}`}>
        {fmtPct(session.utilization_pct)}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm lg:table-cell">
        {isTotal ? '---' : fmtCurrency(session.session_fee)}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm lg:table-cell">
        {isTotal ? '---' : fmtCurrency(session.budget_revenue)}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm lg:table-cell">
        {isTotal ? '---' : fmtCurrency(session.actual_revenue)}
      </td>
      <td className={`hidden px-3 py-2 text-right text-sm lg:table-cell ${deltaColor(session.revenue_delta)}`}>
        {isTotal ? '---' : fmtSignedCurrency(session.revenue_delta)}
      </td>
      <td className={`hidden px-3 py-2 text-right text-sm lg:table-cell ${pctColor(session.revenue_pct)}`}>
        {isTotal ? '---' : fmtPct(session.revenue_pct)}
      </td>
    </tr>
  )
}

export default function ForecastPage() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam, sessions: metricsSessions } = useMetricsSession()

  const { data, isLoading, error } = useForecast(currentYear, {
    sessionCmId: selectedSessionCmId,
    sessionTypes: sessionTypesParam,
  })

  // Build lookups for camp-then-quest sorting from the session context
  const dateLookup = useMemo(() => buildSessionDateLookup(metricsSessions), [metricsSessions])
  const typeLookup = useMemo(() => buildSessionTypeLookup(metricsSessions), [metricsSessions])

  // Sort sessions: camp chronologically, then quests chronologically
  const allSessions = useMemo(
    () => (data ? sortSessionDataByCampThenQuest(data.sessions, dateLookup, typeLookup) : []),
    [data, dateLookup, typeLookup]
  )

  // Split into camp (main + embedded + ag) and quest tables
  const campSessions = useMemo(
    () => allSessions.filter((s) => s.session_type !== 'quest'),
    [allSessions]
  )
  const questSessions = useMemo(
    () => allSessions.filter((s) => s.session_type === 'quest'),
    [allSessions]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading forecast data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-red-500" />
        <p className="text-sm text-red-700 dark:text-red-300">Failed to load forecast data</p>
      </div>
    )
  }

  if (!data) return null

  const { grand_total } = data

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Registration Forecast</h2>
        <p className="text-muted-foreground text-sm">
          Budget goals, capacity, and revenue projections for {currentYear}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Total Enrolled vs Goal"
          value={grand_total.enrolled}
          subtitle={grand_total.participant_goal !== null ? `Goal: ${grand_total.participant_goal.toLocaleString()}` : 'No goal set'}
        />
        <MetricCard
          title="Overall % of Goal"
          value={grand_total.pct_of_goal !== null ? `${grand_total.pct_of_goal.toFixed(1)}%` : 'N/A'}
          subtitle={grand_total.pct_of_goal !== null ? `${grand_total.enrolled} / ${grand_total.participant_goal}` : 'No budget configured'}
        />
        <MetricCard
          title="Total Capacity"
          value={grand_total.capacity !== null ? grand_total.capacity.toLocaleString() : 'N/A'}
          subtitle={grand_total.capacity !== null ? `${allSessions.length} sessions` : 'No bunk plans'}
        />
        <MetricCard
          title="Overall Utilization"
          value={grand_total.utilization_pct !== null ? `${grand_total.utilization_pct.toFixed(1)}%` : 'N/A'}
          subtitle={grand_total.capacity !== null ? `${grand_total.enrolled} / ${grand_total.capacity}` : 'No capacity data'}
        />
      </div>

      {/* Camp sessions table (main + embedded + AG) */}
      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse">
          <ForecastTableHeader />
          <tbody>
            {campSessions.map((session) => (
              <SessionRow key={session.session_cm_id} session={session} />
            ))}
          </tbody>
          <tfoot>
            <SessionRow session={grand_total} isTotal />
          </tfoot>
        </table>
      </div>

      {/* Quest sessions table */}
      {questSessions.length > 0 && (
        <>
          <h3 className="text-muted-foreground text-sm font-semibold uppercase">Quests</h3>
          <div className="border-border overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse">
              <ForecastTableHeader />
              <tbody>
                {questSessions.map((session) => (
                  <SessionRow key={session.session_cm_id} session={session} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
