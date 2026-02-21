/**
 * WaitlistAnalysis - Waitlist-focused registration analysis.
 *
 * Four use cases:
 * 1. Currently waitlisted with no other enrolled sessions (highest priority)
 * 2. Currently waitlisted but enrolled in another session
 * 3. Previously waitlisted, now accepted (enrolled)
 * 4. Previously waitlisted, declined (cancelled/withdrawn/dismissed)
 */

import { useMemo } from 'react'
import { AlertTriangle, CheckCircle, XCircle, Users, Clock } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { useComparisonWaitlistData } from '../../../hooks/useComparisonWaitlistData'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { WaitlistBySessionChart } from '../../../components/metrics/WaitlistBySessionChart'
import { WaitlistGradeChart } from '../../../components/metrics/WaitlistGradeChart'
import { WaitlistGenderChart } from '../../../components/metrics/WaitlistGenderChart'
import { transformGenderData } from '../../../utils/metricsTransforms'
import { SESSION_NAME_ALIASES, resolveSessionAlias } from '../../../utils/sessionAliases'
import { ComparisonSummaryTable } from '../../../components/metrics/ComparisonSummaryTable'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
} from '../../../utils/sessionUtils'
import type { WaitlistSessionBreakdown } from '../../../types/metrics'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'

export default function WaitlistAnalysis() {
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

  const { primary, comparison } = useComparisonWaitlistData(
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
    statusFilter: ['waitlisted'],
  })

  return (
    <MetricsQueryGuard isLoading={isLoading} error={error} data={data} label="waitlist">
      {(data) => {
        return (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard
                title="Total Waitlisted"
                value={data.total_waitlisted}
                className="border-amber-200 dark:border-amber-800"
                compareValue={compData?.total_waitlisted}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'waitlist_total',
                    value: 'all',
                    label: 'Total Waitlisted',
                  })
                }
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
                compareValue={compData?.waitlisted_no_enrollment}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'waitlist_no_enrollment',
                    value: 'true',
                    label: 'No Other Sessions',
                  })
                }
              />
              <MetricCard
                title="Has Other Sessions"
                value={data.waitlisted_has_enrollment}
                subtitle="Enrolled elsewhere"
                compareValue={compData?.waitlisted_has_enrollment}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'waitlist_has_enrollment',
                    value: 'true',
                    label: 'Has Other Sessions',
                  })
                }
              />
              <MetricCard
                title="Accepted"
                value={data.total_accepted}
                subtitle="From waitlist"
                compareValue={compData?.total_accepted}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'waitlist_accepted',
                    value: 'true',
                    label: 'Accepted from Waitlist',
                  })
                }
              />
              <MetricCard
                title="Declined"
                value={data.total_declined}
                subtitle="From waitlist"
                sentiment="inverse"
                compareValue={compData?.total_declined}
                compareYear={compareYear ?? undefined}
                onClick={() =>
                  setFilter({
                    type: 'waitlist_declined',
                    value: 'true',
                    label: 'Declined from Waitlist',
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
                      <WaitlistBySessionChart
                        data={sortSessionDataByCampThenQuest(
                          data.by_session,
                          sessionDateLookup,
                          sessionTypeLookup
                        )}
                        onBarClick={setFilter}
                        sessionDateLookup={sessionDateLookup}
                        sessionTypeLookup={sessionTypeLookup}
                        title={`${currentYear} Waitlist by Session`}
                      />
                      <WaitlistBySessionChart
                        data={sortSessionDataByCampThenQuest(
                          compData.by_session,
                          sessionDateLookup,
                          sessionTypeLookup
                        )}
                        sessionDateLookup={sessionDateLookup}
                        sessionTypeLookup={sessionTypeLookup}
                        title={`${compareYear} Waitlist by Session`}
                      />
                    </div>
                    <ComparisonSummaryTable
                      title="Waitlist by Session Comparison"
                      primaryYear={currentYear}
                      compareYear={compareYear!}
                      primaryData={sortSessionDataByCampThenQuest(
                        data.by_session,
                        sessionDateLookup,
                        sessionTypeLookup
                      ).map((s) => ({
                        name: s.session_name,
                        value: s.waitlisted,
                      }))}
                      compareData={sortSessionDataByCampThenQuest(
                        compData.by_session,
                        sessionDateLookup,
                        sessionTypeLookup
                      ).map((s) => ({
                        name: s.session_name,
                        value: s.waitlisted,
                      }))}
                      aliasMap={SESSION_NAME_ALIASES}
                      categoryLabel="Session"
                    />
                  </>
                ) : (
                  <WaitlistBySessionChart
                    data={sortSessionDataByCampThenQuest(
                      data.by_session,
                      sessionDateLookup,
                      sessionTypeLookup
                    )}
                    onBarClick={setFilter}
                    sessionDateLookup={sessionDateLookup}
                    sessionTypeLookup={sessionTypeLookup}
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
                          <WaitlistGradeChart
                            data={data.by_grade}
                            onBarClick={setFilter}
                            title={`${currentYear} Grade Distribution`}
                          />
                          <WaitlistGradeChart
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
                          <WaitlistGenderChart
                            data={data.by_gender}
                            onSegmentClick={setFilter}
                            title={`${currentYear} Gender Distribution`}
                          />
                          <WaitlistGenderChart
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
                      <WaitlistGradeChart data={data.by_grade} onBarClick={setFilter} />
                    )}
                    {(data.by_gender || []).length > 0 && (
                      <WaitlistGenderChart data={data.by_gender} onSegmentClick={setFilter} />
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
                        <th className="border-border border-l px-4 py-2 text-right font-medium">
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
                        <th className="border-border border-l px-4 py-2 text-right font-medium">
                          Total
                        </th>
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
                      ).map((session: WaitlistSessionBreakdown) => (
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
                          <td className="px-4 py-2 text-right">
                            <span
                              className={
                                session.no_enrollment > 0
                                  ? 'font-semibold text-red-600 dark:text-red-400'
                                  : ''
                              }
                            >
                              {session.no_enrollment}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">{session.has_enrollment}</td>
                          <td className="border-border border-l px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">
                            {session.accepted}
                          </td>
                          <td className="px-4 py-2 text-right text-red-600 dark:text-red-400">
                            {session.declined}
                          </td>
                          <td className="border-border border-l px-4 py-2 text-right font-medium">
                            {session.waitlisted}
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
                                ? session.waitlisted - compSession.waitlisted
                                : null
                              return (
                                <>
                                  <td className="px-4 py-2 text-right">
                                    {compSession?.waitlisted ?? '\u2014'}
                                  </td>
                                  <td
                                    className={`px-4 py-2 text-right ${delta && delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta && delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
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

            {/* Historical note when no history data */}
            {data.total_accepted === 0 &&
              data.total_declined === 0 &&
              data.total_waitlisted > 0 && (
                <div className="card-lodge flex items-start gap-3 p-4">
                  <Clock className="text-muted-foreground mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="text-foreground text-sm font-medium">Status History Tracking</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Status transitions are tracked each time the attendee sync runs. Historical
                      accepted/declined data will accumulate over time as waitlisted campers change
                      status.
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
