/**
 * WaitlistAnalysis - Waitlist-focused registration analysis.
 *
 * Four use cases:
 * 1. Currently waitlisted with no other enrolled sessions (highest priority)
 * 2. Currently waitlisted but enrolled in another session
 * 3. Previously waitlisted, now accepted (enrolled)
 * 4. Previously waitlisted, declined (cancelled/withdrawn/dismissed)
 */

import { Loader2, AlertCircle, AlertTriangle, CheckCircle, XCircle, Users, Clock } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useWaitlistMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { BreakdownChart } from '../../../components/metrics/BreakdownChart'
import type { WaitlistSessionBreakdown } from '../../../types/metrics'

const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag']

export default function WaitlistAnalysis() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId } = useMetricsSession()
  const sessionTypesParam = DEFAULT_SESSION_TYPES.join(',')

  const { data, isLoading, error } = useWaitlistMetrics(
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading waitlist data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load waitlist data: {error.message}</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No data available
      </div>
    )
  }

  // Transform grade data for chart
  const gradeChartData = (data.by_grade || []).map((g) => ({
    name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    value: g.count,
    percentage: g.percentage,
  }))

  // Transform session data for stacked display
  const sessionChartData = (data.by_session || []).map((s) => ({
    name: s.session_name,
    value: s.waitlisted,
    id: s.session_cm_id,
    no_enrollment: s.no_enrollment,
    has_enrollment: s.has_enrollment,
  }))

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          title="Total Waitlisted"
          value={data.total_waitlisted}
          className="border-amber-200 dark:border-amber-800"
        />
        <MetricCard
          title="No Other Sessions"
          value={data.waitlisted_no_enrollment}
          subtitle="May not attend camp"
          className={
            data.waitlisted_no_enrollment > 0
              ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30'
              : ''
          }
        />
        <MetricCard
          title="Has Other Sessions"
          value={data.waitlisted_has_enrollment}
          subtitle="Enrolled elsewhere"
        />
        <MetricCard
          title="Accepted"
          value={data.total_accepted}
          subtitle="From waitlist"
        />
        <MetricCard
          title="Declined"
          value={data.total_declined}
          subtitle="From waitlist"
        />
      </div>

      {/* Charts Row */}
      {(sessionChartData.length > 0 || gradeChartData.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {sessionChartData.length > 0 && (
            <div className="card-lodge p-4">
              <h3 className="text-foreground mb-3 text-sm font-semibold">Waitlist by Session</h3>
              <BreakdownChart data={sessionChartData} title="" type="bar" height={200} />
            </div>
          )}
          {gradeChartData.length > 0 && (
            <div className="card-lodge p-4">
              <h3 className="text-foreground mb-3 text-sm font-semibold">Grade Distribution</h3>
              <BreakdownChart data={gradeChartData} title="" type="bar" height={200} />
            </div>
          )}
        </div>
      )}

      {/* Session Details Table */}
      {data.by_session.length > 0 && (
        <div className="card-lodge overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-foreground text-sm font-semibold">Session Details</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium">Session</th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                      No Enrollment
                    </span>
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3 text-amber-500" />
                      Has Enrollment
                    </span>
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-emerald-500" />
                      Accepted
                    </span>
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-red-500" />
                      Declined
                    </span>
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.by_session.map((session: WaitlistSessionBreakdown) => (
                  <tr key={session.session_cm_id} className="border-b border-border/50">
                    <td className="px-4 py-2 font-medium">{session.session_name}</td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={
                          session.no_enrollment > 0 ? 'font-semibold text-red-600 dark:text-red-400' : ''
                        }
                      >
                        {session.no_enrollment}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{session.has_enrollment}</td>
                    <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">
                      {session.accepted}
                    </td>
                    <td className="px-4 py-2 text-right text-red-600 dark:text-red-400">
                      {session.declined}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{session.waitlisted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical note when no history data */}
      {data.total_accepted === 0 && data.total_declined === 0 && data.total_waitlisted > 0 && (
        <div className="card-lodge flex items-start gap-3 p-4">
          <Clock className="text-muted-foreground mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="text-foreground text-sm font-medium">Status History Tracking</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Status transitions are tracked each time the attendee sync runs. Historical
              accepted/declined data will accumulate over time as waitlisted campers change status.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
