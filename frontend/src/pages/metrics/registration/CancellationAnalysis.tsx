/**
 * CancellationAnalysis - Cancellation-focused registration analysis.
 *
 * Analyzes cancelled/withdrawn/dismissed attendees:
 * 1. Was Enrolled - cancelled after being enrolled (lost confirmed spot)
 * 2. Was Waitlisted - cancelled after being waitlisted (left the waitlist)
 * 3. Has Other Sessions - cancelled but still enrolled elsewhere
 * 4. No Other Sessions - cancelled with no remaining enrollment
 * 5. Re-enrolled - cancelled then later re-enrolled (recovery)
 */

import { useMemo } from 'react'
import { XCircle, Users, UserMinus, AlertTriangle, Clock } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { useComparisonCancellationData } from '../../../hooks/useComparisonCancellationData'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { CancellationBySessionChart } from '../../../components/metrics/CancellationBySessionChart'
import { CancellationGradeChart } from '../../../components/metrics/CancellationGradeChart'
import { CancellationGenderChart } from '../../../components/metrics/CancellationGenderChart'
import { transformGenderData } from '../../../utils/metricsTransforms'
import { SESSION_NAME_ALIASES, resolveSessionAlias } from '../../../utils/sessionAliases'
import { ComparisonSummaryTable } from '../../../components/metrics/ComparisonSummaryTable'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
} from '../../../utils/sessionUtils'
import type { CancellationSessionBreakdown } from '../../../types/metrics'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'

export default function CancellationAnalysis() {
  const { currentYear } = useCurrentYear()
  const {
    selectedSessionCmId,
    sessions,
    sessionTypesParam,
    activeSessionTypes,
    compareYear,
    isComparing,
  } = useMetricsSession()
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  const { primary, comparison } = useComparisonCancellationData(
    currentYear,
    compareYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )
  const { data, isLoading, error } = primary
  const compData = comparison?.data

  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['cancelled', 'withdrawn', 'dismissed'],
  })

  return (
    <MetricsQueryGuard isLoading={isLoading} error={error} data={data} label="cancellations">
      {(data) => {
        return (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                title="Total Cancelled"
                value={data.total_cancelled}
                className="border-red-200 dark:border-red-800"
                compareValue={compData?.total_cancelled}
                compareYear={compareYear ?? undefined}
                sentiment="inverse"
                onClick={() =>
                  setFilter({
                    type: 'cancellation_total',
                    value: 'all',
                    label: 'Total Cancelled',
                  })
                }
              />
              <MetricCard
                title="Was Enrolled"
                value={data.was_enrolled}
                subtitle="Lost confirmed spot"
                className={
                  data.was_enrolled > 0
                    ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30'
                    : ''
                }
                compareValue={compData?.was_enrolled}
                compareYear={compareYear ?? undefined}
                sentiment="inverse"
                onClick={() =>
                  setFilter({
                    type: 'cancellation_was_enrolled',
                    value: 'true',
                    label: 'Was Enrolled',
                    titleFormat: 'adjective',
                  })
                }
              />
              <MetricCard
                title="Was Waitlisted"
                value={data.was_waitlisted}
                subtitle="Left the waitlist"
                compareValue={compData?.was_waitlisted}
                compareYear={compareYear ?? undefined}
                sentiment="inverse"
                onClick={() =>
                  setFilter({
                    type: 'cancellation_was_waitlisted',
                    value: 'true',
                    label: 'Was Waitlisted',
                    titleFormat: 'adjective',
                  })
                }
              />
              {data.was_applied > 0 && (
                <MetricCard
                  title="Was Applied"
                  value={data.was_applied}
                  subtitle="Left after applying"
                  compareValue={compData?.was_applied}
                  compareYear={compareYear ?? undefined}
                  sentiment="inverse"
                />
              )}
              {data.other_prior_status > 0 && (
                <MetricCard
                  title="Other Prior"
                  value={data.other_prior_status}
                  subtitle="Inquiry, incomplete, etc."
                  compareValue={compData?.other_prior_status}
                  compareYear={compareYear ?? undefined}
                  sentiment="inverse"
                />
              )}
              <MetricCard
                title="Has Other Sessions"
                value={data.has_other_sessions}
                subtitle="Still attending"
                compareValue={compData?.has_other_sessions}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'cancellation_has_other_sessions',
                    value: 'true',
                    label: 'Has Other Sessions',
                  })
                }
              />
              <MetricCard
                title="No Other Sessions"
                value={data.no_other_sessions}
                subtitle="Fully lost to camp"
                className={
                  data.no_other_sessions > 0
                    ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30'
                    : ''
                }
                compareValue={compData?.no_other_sessions}
                compareYear={compareYear ?? undefined}
                sentiment="inverse"
                onClick={() =>
                  setFilter({
                    type: 'cancellation_no_other_sessions',
                    value: 'true',
                    label: 'No Other Sessions',
                  })
                }
              />
              <MetricCard
                title="Re-enrolled"
                value={data.total_re_enrolled}
                subtitle="Recovery rate"
                compareValue={compData?.total_re_enrolled}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'cancellation_re_enrolled',
                    value: 'true',
                    label: 'Re-enrolled',
                    titleFormat: 'adjective',
                    statusOverride: ['enrolled'],
                  })
                }
              />
            </div>

            {/* Session Chart */}
            {data.by_session.length > 0 && (
              <>
                {isComparing && compData ? (
                  <>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <CancellationBySessionChart
                        data={sortSessionDataByCampThenQuest(
                          data.by_session,
                          sessionDateLookup,
                          sessionTypeLookup
                        )}
                        onBarClick={setFilter}
                        title={`${currentYear} Cancellations by Session`}
                      />
                      <CancellationBySessionChart
                        data={sortSessionDataByCampThenQuest(
                          compData.by_session,
                          sessionDateLookup,
                          sessionTypeLookup
                        )}
                        title={`${compareYear} Cancellations by Session`}
                      />
                    </div>
                    <ComparisonSummaryTable
                      title="Cancellations by Session Comparison"
                      primaryYear={currentYear}
                      compareYear={compareYear!}
                      primaryData={sortSessionDataByCampThenQuest(
                        data.by_session,
                        sessionDateLookup,
                        sessionTypeLookup
                      ).map((s) => ({
                        name: s.session_name,
                        value: s.total_cancelled,
                      }))}
                      compareData={sortSessionDataByCampThenQuest(
                        compData.by_session,
                        sessionDateLookup,
                        sessionTypeLookup
                      ).map((s) => ({
                        name: s.session_name,
                        value: s.total_cancelled,
                      }))}
                      aliasMap={SESSION_NAME_ALIASES}
                      categoryLabel="Session"
                    />
                  </>
                ) : (
                  <CancellationBySessionChart
                    data={sortSessionDataByCampThenQuest(
                      data.by_session,
                      sessionDateLookup,
                      sessionTypeLookup
                    )}
                    onBarClick={setFilter}
                  />
                )}
              </>
            )}

            {/* Grade + Gender Charts Row */}
            {((data.by_grade || []).length > 0 || (data.by_gender || []).length > 0) && (
              <>
                {isComparing && compData ? (
                  <>
                    {(data.by_grade || []).length > 0 && (
                      <>
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                          <CancellationGradeChart
                            data={data.by_grade}
                            onBarClick={setFilter}
                            title={`${currentYear} Grade Distribution`}
                          />
                          <CancellationGradeChart
                            data={compData.by_grade || []}
                            title={`${compareYear} Grade Distribution`}
                          />
                        </div>
                        <ComparisonSummaryTable
                          title="Grade Distribution Comparison"
                          primaryYear={currentYear}
                          compareYear={compareYear!}
                          primaryData={(data.by_grade || []).map((g) => ({
                            name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
                            value: g.count,
                          }))}
                          compareData={(compData.by_grade || []).map((g) => ({
                            name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
                            value: g.count,
                          }))}
                        />
                      </>
                    )}
                    {(data.by_gender || []).length > 0 && (
                      <>
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                          <CancellationGenderChart
                            data={data.by_gender}
                            onSegmentClick={setFilter}
                            title={`${currentYear} Gender Distribution`}
                          />
                          <CancellationGenderChart
                            data={compData.by_gender || []}
                            title={`${compareYear} Gender Distribution`}
                          />
                        </div>
                        <ComparisonSummaryTable
                          title="Gender Distribution Comparison"
                          primaryYear={currentYear}
                          compareYear={compareYear!}
                          primaryData={transformGenderData(data.by_gender)}
                          compareData={transformGenderData(compData.by_gender)}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2">
                    {(data.by_grade || []).length > 0 && (
                      <CancellationGradeChart data={data.by_grade} onBarClick={setFilter} />
                    )}
                    {(data.by_gender || []).length > 0 && (
                      <CancellationGenderChart data={data.by_gender} onSegmentClick={setFilter} />
                    )}
                  </div>
                )}
              </>
            )}

            {/* Session Details Table */}
            {data.by_session.length > 0 && (
              <div className="card-lodge overflow-hidden">
                <div className="border-border border-b px-4 py-3">
                  <h3 className="text-foreground text-base font-semibold">Session Details</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-border bg-muted/30 border-b">
                        <th className="px-4 py-2 text-left font-medium">Session</th>
                        <th className="px-4 py-2 text-right font-medium">
                          <span className="inline-flex items-center gap-1">
                            <UserMinus className="h-3 w-3 text-blue-500" />
                            Was Enrolled
                          </span>
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          <span className="inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                            Was Waitlisted
                          </span>
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          Was Applied
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          Other
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          Unknown
                        </th>
                        <th className="border-border border-l px-4 py-2 text-right font-medium">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3 text-emerald-500" />
                            Has Other
                          </span>
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          <span className="inline-flex items-center gap-1">
                            <XCircle className="h-3 w-3 text-red-500" />
                            No Other
                          </span>
                        </th>
                        <th className="px-4 py-2 text-right font-medium">Total</th>
                        {isComparing && compData && (
                          <>
                            <th className="px-4 py-2 text-right font-medium">
                              {compareYear} Total
                            </th>
                            <th className="px-4 py-2 text-right font-medium">Delta</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sortSessionDataByCampThenQuest(
                        data.by_session,
                        sessionDateLookup,
                        sessionTypeLookup
                      ).map((session: CancellationSessionBreakdown) => (
                        <tr key={session.session_cm_id} className="border-border/50 border-b">
                          <td className="px-4 py-2 font-medium">
                            {session.session_name}
                            {isComparing &&
                              compData &&
                              (() => {
                                const compSession = compData.by_session.find(
                                  (s) =>
                                    resolveSessionAlias(s.session_name) ===
                                    resolveSessionAlias(session.session_name)
                                )
                                return compSession &&
                                  compSession.session_name !== session.session_name ? (
                                  <span className="text-muted-foreground ml-1 text-xs">
                                    (was: {compSession.session_name})
                                  </span>
                                ) : null
                              })()}
                          </td>
                          <td className="px-4 py-2 text-right text-blue-600 dark:text-blue-400">
                            {session.was_enrolled}
                          </td>
                          <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">
                            {session.was_waitlisted}
                          </td>
                          <td className="px-4 py-2 text-right text-purple-600 dark:text-purple-400">
                            {session.was_applied}
                          </td>
                          <td className="text-muted-foreground px-4 py-2 text-right">
                            {session.other_prior_status}
                          </td>
                          <td className="text-muted-foreground px-4 py-2 text-right">
                            {session.total_cancelled - session.was_enrolled - session.was_waitlisted - session.was_applied - session.other_prior_status}
                          </td>
                          <td className="border-border border-l px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">
                            {session.has_other_sessions}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span
                              className={
                                session.no_other_sessions > 0
                                  ? 'font-semibold text-red-600 dark:text-red-400'
                                  : ''
                              }
                            >
                              {session.no_other_sessions}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            {session.total_cancelled}
                          </td>
                          {isComparing &&
                            compData &&
                            (() => {
                              const compSession = compData.by_session.find(
                                (s) =>
                                  resolveSessionAlias(s.session_name) ===
                                  resolveSessionAlias(session.session_name)
                              )
                              const delta = compSession
                                ? session.total_cancelled - compSession.total_cancelled
                                : null
                              return (
                                <>
                                  <td className="px-4 py-2 text-right">
                                    {compSession?.total_cancelled ?? '\u2014'}
                                  </td>
                                  <td
                                    className={`px-4 py-2 text-right ${delta && delta > 0 ? 'text-red-600 dark:text-red-400' : delta && delta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
                                  >
                                    {delta !== null ? (delta > 0 ? `+${delta}` : delta) : '\u2014'}
                                  </td>
                                </>
                              )
                            })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Status history note */}
            {data.total_cancelled === 0 && (
              <div className="card-lodge flex items-start gap-3 p-4">
                <Clock className="text-muted-foreground mt-0.5 h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="text-foreground text-sm font-medium">Status History Tracking</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Cancellation data is tracked from the attendee sync. Prior status (enrolled vs
                    waitlisted) is determined from status history transitions detected during sync
                    runs.
                  </p>
                </div>
              </div>
            )}

            <DrilldownModal />
          </div>
        )
      }}
    </MetricsQueryGuard>
  )
}
