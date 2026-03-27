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
import { WaitlistGenderChart } from '../../../components/metrics/WaitlistGenderChart'
import {
  CssStackedHorizontalBarChart,
  type StackedBarDataItem,
  type StackedSegment,
} from '../../../components/metrics/CssStackedHorizontalBarChart'
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

const SESSION_COLORS = [
  'hsl(160, 100%, 35%)',
  'hsl(42, 92%, 50%)',
  'hsl(200, 70%, 50%)',
  'hsl(280, 60%, 50%)',
  'hsl(100, 60%, 45%)',
  'hsl(30, 80%, 50%)',
  'hsl(180, 60%, 45%)',
  'hsl(350, 70%, 50%)',
]

const WAITLIST_GRADE_SEGMENTS: StackedSegment[] = [
  { key: 'no_enrollment', label: 'No Other Sessions', color: 'hsl(0, 70%, 50%)' },
  { key: 'has_enrollment', label: 'Has Other Sessions', color: 'hsl(160, 100%, 35%)' },
]

function transformWaitlistSessionData(
  bySession: WaitlistSessionBreakdown[],
  sessionDateLookup: Record<string, string>,
  sessionTypeLookup: Record<string, string>
) {
  const sorted = sortSessionDataByCampThenQuest(bySession, sessionDateLookup, sessionTypeLookup)
  const enrolledSessions = new Map<number, string>()
  for (const item of sorted) {
    for (const enrolled of item.enrolled_in) {
      enrolledSessions.set(enrolled.session_cm_id, enrolled.session_name)
    }
  }
  const enrolledList = Array.from(enrolledSessions.entries())
  const segments: StackedSegment[] = [
    { key: 'no_enrollment', label: 'No Enrollment', color: 'hsl(0, 70%, 50%)' },
    ...enrolledList.map(([id, name], i) => ({
      key: `session_${id}`,
      label: name,
      color: SESSION_COLORS[i % SESSION_COLORS.length] ?? 'hsl(160, 100%, 35%)',
    })),
  ]
  const data: StackedBarDataItem[] = sorted.map((item) => {
    const point: StackedBarDataItem = {
      name: item.session_name,
      total: item.no_enrollment + item.has_enrollment,
      no_enrollment: item.no_enrollment,
    }
    for (const [sessionId] of enrolledList) {
      const enrolled = item.enrolled_in.find((e) => e.session_cm_id === sessionId)
      point[`session_${sessionId}`] = enrolled?.count ?? 0
    }
    return point
  })
  return { data, segments, sorted }
}

function transformWaitlistGradeData(
  byGrade: Array<{
    grade: number | null
    count: number
    no_enrollment?: number
    has_enrollment?: number
  }>
): StackedBarDataItem[] {
  return byGrade.map((item) => ({
    name: item.grade !== null ? `Grade ${item.grade}` : 'Unknown',
    total: item.count,
    no_enrollment: item.no_enrollment ?? 0,
    has_enrollment: item.has_enrollment ?? 0,
  }))
}

export default function WaitlistAnalysis() {
  const { currentYear } = useCurrentYear()
  const {
    selectedSessionCmId,
    sessions,
    activeSessionTypes,
    compareYear,
    isComparing,
    durationParam,
    filterOptions,
  } = useMetricsSession()
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  const { primary, comparison } = useComparisonWaitlistData(currentYear, compareYear, filterOptions)
  const { data, isLoading, error } = primary
  const compData = comparison?.data

  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['waitlisted'],
    duration: durationParam,
  })

  const primarySession = useMemo(
    () =>
      data
        ? transformWaitlistSessionData(data.by_session, sessionDateLookup, sessionTypeLookup)
        : null,
    [data, sessionDateLookup, sessionTypeLookup]
  )
  const compSession = useMemo(
    () =>
      compData
        ? transformWaitlistSessionData(compData.by_session, sessionDateLookup, sessionTypeLookup)
        : null,
    [compData, sessionDateLookup, sessionTypeLookup]
  )

  const primaryGrade = useMemo(
    () => (data ? transformWaitlistGradeData(data.by_grade) : []),
    [data]
  )
  const compGrade = useMemo(
    () => (compData ? transformWaitlistGradeData(compData.by_grade) : []),
    [compData]
  )

  return (
    <MetricsQueryGuard isLoading={isLoading} error={error} data={data} label="waitlist">
      {(data) => {
        return (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
              data-tour="reg-waitlist-summary"
            >
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

            {/* Waitlist Duration Insights */}
            {(data.avg_days_to_acceptance != null ||
              data.median_days_to_acceptance != null ||
              data.avg_days_to_decline != null ||
              data.median_days_to_decline != null) && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {data.avg_days_to_acceptance != null && (
                  <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 dark:border-green-800 dark:bg-green-950/30">
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <Clock className="h-4 w-4" />
                      Avg Wait to Accept
                    </div>
                    <div className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
                      {Math.round(data.avg_days_to_acceptance)} days
                    </div>
                  </div>
                )}
                {data.median_days_to_acceptance != null && (
                  <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 dark:border-green-800 dark:bg-green-950/30">
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <Clock className="h-4 w-4" />
                      Median Wait to Accept
                    </div>
                    <div className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
                      {Math.round(data.median_days_to_acceptance)} days
                    </div>
                  </div>
                )}
                {data.avg_days_to_decline != null && (
                  <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-950/30">
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <Clock className="h-4 w-4" />
                      Avg Time to Decline
                    </div>
                    <div className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">
                      {Math.round(data.avg_days_to_decline)} days
                    </div>
                  </div>
                )}
                {data.median_days_to_decline != null && (
                  <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-800 dark:bg-red-950/30">
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <Clock className="h-4 w-4" />
                      Median Time to Decline
                    </div>
                    <div className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">
                      {Math.round(data.median_days_to_decline)} days
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Session Chart */}
            {data.by_session.length > 0 && primarySession && (
              <div data-tour="reg-waitlist-sessions">
                <div className={isComparing ? 'grid grid-cols-1 gap-6 lg:grid-cols-2' : ''}>
                  <CssStackedHorizontalBarChart
                    data={primarySession.data}
                    segments={primarySession.segments}
                    title={
                      isComparing ? `${currentYear} Waitlist by Session` : 'Waitlist by Session'
                    }
                    labelWidth={140}
                    height={340}
                    onBarClick={(item) =>
                      setFilter({
                        type: 'waitlist_total',
                        value: String(
                          primarySession.sorted.find((s) => s.session_name === item.name)
                            ?.session_cm_id ?? ''
                        ),
                        label: item.name,
                      })
                    }
                  />
                  {isComparing && compSession && (
                    <CssStackedHorizontalBarChart
                      data={compSession.data}
                      segments={compSession.segments}
                      title={`${compareYear} Waitlist by Session`}
                      labelWidth={140}
                      height={340}
                    />
                  )}
                </div>
                {compareYear !== null && compSession && (
                  <ComparisonSummaryTable
                    title="Waitlist by Session Comparison"
                    primaryYear={currentYear}
                    compareYear={compareYear}
                    primaryData={primarySession.sorted.map((s) => ({
                      name: s.session_name,
                      value: s.waitlisted,
                    }))}
                    compareData={compSession.sorted.map((s) => ({
                      name: s.session_name,
                      value: s.waitlisted,
                    }))}
                    aliasMap={SESSION_NAME_ALIASES}
                    categoryLabel="Session"
                  />
                )}
              </div>
            )}

            {/* Grade + Gender Charts Row */}
            {(data.by_grade.length > 0 || data.by_gender.length > 0) && (
              <>
                {compareYear !== null && compData ? (
                  <>
                    {data.by_grade.length > 0 && primaryGrade.length > 0 && (
                      <>
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                          <CssStackedHorizontalBarChart
                            data={primaryGrade}
                            segments={WAITLIST_GRADE_SEGMENTS}
                            title={`${currentYear} Grade Distribution`}
                            onBarClick={(item) => {
                              const grade = data.by_grade.find(
                                (g) =>
                                  (g.grade !== null ? `Grade ${g.grade}` : 'Unknown') === item.name
                              )
                              if (grade) {
                                setFilter({
                                  type: 'grade',
                                  value: grade.grade !== null ? String(grade.grade) : 'null',
                                  label: item.name,
                                  statusOverride: ['waitlisted'],
                                  waitlistContext: true,
                                })
                              }
                            }}
                          />
                          {compGrade.length > 0 && (
                            <CssStackedHorizontalBarChart
                              data={compGrade}
                              segments={WAITLIST_GRADE_SEGMENTS}
                              title={`${compareYear} Grade Distribution`}
                            />
                          )}
                        </div>
                        <ComparisonSummaryTable
                          title="Grade Distribution Comparison"
                          primaryYear={currentYear}
                          compareYear={compareYear}
                          primaryData={data.by_grade.map((g) => ({
                            name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
                            value: g.count,
                          }))}
                          compareData={compData.by_grade.map((g) => ({
                            name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
                            value: g.count,
                          }))}
                        />
                      </>
                    )}
                    {data.by_gender.length > 0 && (
                      <>
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                          <WaitlistGenderChart
                            data={data.by_gender}
                            onSegmentClick={setFilter}
                            title={`${currentYear} Gender Distribution`}
                          />
                          <WaitlistGenderChart
                            data={compData.by_gender}
                            title={`${compareYear} Gender Distribution`}
                          />
                        </div>
                        <ComparisonSummaryTable
                          title="Gender Distribution Comparison"
                          primaryYear={currentYear}
                          compareYear={compareYear}
                          primaryData={transformGenderData(data.by_gender)}
                          compareData={transformGenderData(compData.by_gender)}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {data.by_grade.length > 0 && primaryGrade.length > 0 && (
                      <CssStackedHorizontalBarChart
                        data={primaryGrade}
                        segments={WAITLIST_GRADE_SEGMENTS}
                        title="Grade Distribution"
                        onBarClick={(item) => {
                          const grade = data.by_grade.find(
                            (g) => (g.grade !== null ? `Grade ${g.grade}` : 'Unknown') === item.name
                          )
                          if (grade) {
                            setFilter({
                              type: 'grade',
                              value: grade.grade !== null ? String(grade.grade) : 'null',
                              label: item.name,
                              statusOverride: ['waitlisted'],
                              waitlistContext: true,
                            })
                          }
                        }}
                      />
                    )}
                    {data.by_gender.length > 0 && (
                      <WaitlistGenderChart
                        data={data.by_gender}
                        onSegmentClick={setFilter}
                        title="Gender Distribution"
                      />
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
