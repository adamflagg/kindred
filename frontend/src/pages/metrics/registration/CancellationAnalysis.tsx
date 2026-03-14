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
import {
  XCircle,
  Users,
  UserMinus,
  AlertTriangle,
  Clock,
  ArrowLeftRight,
  CalendarDays,
} from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { useComparisonCancellationData } from '../../../hooks/useComparisonCancellationData'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { CancellationGenderChart } from '../../../components/metrics/CancellationGenderChart'
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
import type { CancellationSessionBreakdown } from '../../../types/metrics'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'

const CANCEL_SEGMENTS: StackedSegment[] = [
  { key: 'was_enrolled', label: 'Was Enrolled', color: 'hsl(200, 70%, 50%)' },
  { key: 'was_waitlisted', label: 'Was Waitlisted', color: 'hsl(42, 92%, 50%)' },
  { key: 'was_applied', label: 'Was Applied', color: 'hsl(280, 60%, 55%)' },
  { key: 'other_prior_status', label: 'Other Prior Status', color: 'hsl(200, 15%, 55%)' },
  { key: 'unknown', label: 'Unknown', color: 'hsl(0, 0%, 75%)' },
]

function transformCancelSessionData(
  bySession: CancellationSessionBreakdown[],
  sessionDateLookup: Record<string, string>,
  sessionTypeLookup: Record<string, string>
): { data: StackedBarDataItem[]; sorted: CancellationSessionBreakdown[] } {
  const sorted = sortSessionDataByCampThenQuest(bySession, sessionDateLookup, sessionTypeLookup)
  const data = sorted.map((item) => {
    const known =
      item.was_enrolled +
      item.was_waitlisted +
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- optional fields may be undefined at runtime
      (item.was_applied ?? 0) +
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- optional fields may be undefined at runtime
      (item.other_prior_status ?? 0)
    return {
      name: item.session_name,
      total: item.total_cancelled,
      was_enrolled: item.was_enrolled,
      was_waitlisted: item.was_waitlisted,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- optional fields may be undefined at runtime
      was_applied: item.was_applied ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- optional fields may be undefined at runtime
      other_prior_status: item.other_prior_status ?? 0,
      unknown: Math.max(0, item.total_cancelled - known),
    }
  })
  return { data, sorted }
}

function transformCancelGradeData(
  byGrade: Array<{
    grade: number | null
    count: number
    was_enrolled?: number
    was_waitlisted?: number
    was_applied?: number
    other_prior_status?: number
  }>
): StackedBarDataItem[] {
  return byGrade.map((item) => {
    const known =
      (item.was_enrolled ?? 0) +
      (item.was_waitlisted ?? 0) +
      (item.was_applied ?? 0) +
      (item.other_prior_status ?? 0)
    return {
      name: item.grade !== null ? `Grade ${item.grade}` : 'Unknown',
      total: item.count,
      was_enrolled: item.was_enrolled ?? 0,
      was_waitlisted: item.was_waitlisted ?? 0,
      was_applied: item.was_applied ?? 0,
      other_prior_status: item.other_prior_status ?? 0,
      unknown: Math.max(0, item.count - known),
    }
  })
}

export default function CancellationAnalysis() {
  const { currentYear } = useCurrentYear()
  const {
    selectedSessionCmId,
    sessions,
    sessionTypesParam,
    activeSessionTypes,
    compareYear,
    isComparing,
    durationParam,
  } = useMetricsSession()
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  const { primary, comparison } = useComparisonCancellationData(currentYear, compareYear, {
    sessionTypes: sessionTypesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
    duration: durationParam,
  })
  const { data, isLoading, error } = primary
  const compData = comparison?.data

  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['cancelled', 'withdrawn', 'dismissed'],
    duration: durationParam,
  })

  const primarySession = useMemo(
    () =>
      data
        ? transformCancelSessionData(data.by_session, sessionDateLookup, sessionTypeLookup)
        : null,
    [data, sessionDateLookup, sessionTypeLookup]
  )
  const compSessionData = useMemo(
    () =>
      compData
        ? transformCancelSessionData(compData.by_session, sessionDateLookup, sessionTypeLookup)
        : null,
    [compData, sessionDateLookup, sessionTypeLookup]
  )

  const primaryGrade = useMemo(() => (data ? transformCancelGradeData(data.by_grade) : []), [data])
  const compGrade = useMemo(
    () => (compData ? transformCancelGradeData(compData.by_grade) : []),
    [compData]
  )

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

            {/* Cancellation Timing Insights */}
            {(data.session_swap_count != null || data.avg_days_to_cancellation != null) && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {data.session_swap_count != null && data.session_swap_count > 0 && (
                  <div className="border-border bg-card rounded-lg border p-4">
                    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Session Swaps
                    </div>
                    <div className="text-foreground text-2xl font-bold">
                      {data.session_swap_count}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Cancelled one session, enrolled in another
                    </p>
                  </div>
                )}
                {data.true_departure_count != null && data.true_departure_count > 0 && (
                  <div className="border-border bg-card rounded-lg border p-4">
                    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <UserMinus className="h-3.5 w-3.5" />
                      True Departures
                    </div>
                    <div className="text-foreground text-2xl font-bold">
                      {data.true_departure_count}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">Left camp entirely</p>
                  </div>
                )}
                {data.avg_days_to_cancellation != null && (
                  <div className="border-border bg-card rounded-lg border p-4">
                    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <Clock className="h-3.5 w-3.5" />
                      Avg Time to Cancel
                    </div>
                    <div className="text-foreground text-2xl font-bold">
                      {Math.round(data.avg_days_to_cancellation)} days
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      From registration to cancellation
                    </p>
                  </div>
                )}
                {data.median_days_to_cancellation != null && (
                  <div className="border-border bg-card rounded-lg border p-4">
                    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Median Time to Cancel
                    </div>
                    <div className="text-foreground text-2xl font-bold">
                      {Math.round(data.median_days_to_cancellation)} days
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Middle value, less affected by outliers
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Time-to-Cancellation + Registration Month side by side */}
            {(data.time_to_cancellation_buckets?.length ?? 0) > 0 ||
            (data.by_registration_month?.length ?? 0) > 0 ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {data.time_to_cancellation_buckets &&
                  data.time_to_cancellation_buckets.length > 0 && (
                    <div className="border-border bg-card rounded-lg border p-4">
                      <h3 className="text-foreground mb-3 text-sm font-semibold">
                        Time to Cancellation Distribution
                      </h3>
                      <div className="space-y-2">
                        {data.time_to_cancellation_buckets.map((bucket) => (
                          <div key={bucket.label} className="flex items-center gap-3">
                            <span className="text-muted-foreground w-24 text-xs">
                              {bucket.label}
                            </span>
                            <div className="bg-muted h-5 flex-1 overflow-hidden rounded">
                              <div
                                className="h-full rounded bg-red-400 dark:bg-red-600"
                                style={{ width: `${bucket.percentage}%` }}
                              />
                            </div>
                            <span className="text-foreground w-16 text-right text-xs font-medium">
                              {bucket.count} ({bucket.percentage}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {data.by_registration_month && data.by_registration_month.length > 0 && (
                  <div className="border-border bg-card rounded-lg border p-4">
                    <h3 className="text-foreground mb-3 text-sm font-semibold">
                      Cancellations by Registration Month
                    </h3>
                    <div className="space-y-2">
                      {data.by_registration_month.map((item) => (
                        <div key={item.month} className="flex items-center gap-3">
                          <span className="text-muted-foreground w-24 text-xs">{item.month}</span>
                          <div className="bg-muted h-5 flex-1 overflow-hidden rounded">
                            <div
                              className="h-full rounded bg-amber-400 dark:bg-amber-600"
                              style={{ width: `${item.percentage}%` }}
                            />
                          </div>
                          <span className="text-foreground w-16 text-right text-xs font-medium">
                            {item.count} ({item.percentage}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Session Chart */}
            {data.by_session.length > 0 && primarySession && (
              <>
                <div className={isComparing ? 'grid grid-cols-1 gap-6 lg:grid-cols-2' : ''}>
                  <CssStackedHorizontalBarChart
                    data={primarySession.data}
                    segments={CANCEL_SEGMENTS}
                    title={
                      isComparing
                        ? `${currentYear} Cancellations by Session`
                        : 'Cancellations by Session'
                    }
                    onBarClick={(item) => {
                      const session = primarySession.sorted.find(
                        (s) => s.session_name === item.name
                      )
                      if (session) {
                        setFilter({
                          type: 'cancellation_total',
                          value: String(session.session_cm_id),
                          label: item.name,
                        })
                      }
                    }}
                  />
                  {isComparing && compSessionData && (
                    <CssStackedHorizontalBarChart
                      data={compSessionData.data}
                      segments={CANCEL_SEGMENTS}
                      title={`${compareYear} Cancellations by Session`}
                    />
                  )}
                </div>
                {compareYear !== null && compSessionData && (
                  <ComparisonSummaryTable
                    title="Cancellations by Session Comparison"
                    primaryYear={currentYear}
                    compareYear={compareYear}
                    primaryData={primarySession.sorted.map((s) => ({
                      name: s.session_name,
                      value: s.total_cancelled,
                    }))}
                    compareData={compSessionData.sorted.map((s) => ({
                      name: s.session_name,
                      value: s.total_cancelled,
                    }))}
                    aliasMap={SESSION_NAME_ALIASES}
                    categoryLabel="Session"
                  />
                )}
              </>
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
                            segments={CANCEL_SEGMENTS}
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
                                  statusOverride: ['cancelled', 'withdrawn', 'dismissed'],
                                })
                              }
                            }}
                          />
                          {compGrade.length > 0 && (
                            <CssStackedHorizontalBarChart
                              data={compGrade}
                              segments={CANCEL_SEGMENTS}
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
                          <CancellationGenderChart
                            data={data.by_gender}
                            onSegmentClick={setFilter}
                            title={`${currentYear} Gender Distribution`}
                          />
                          <CancellationGenderChart
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
                        segments={CANCEL_SEGMENTS}
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
                              statusOverride: ['cancelled', 'withdrawn', 'dismissed'],
                            })
                          }
                        }}
                      />
                    )}
                    {data.by_gender.length > 0 && (
                      <CancellationGenderChart
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
                        <th className="px-4 py-2 text-right font-medium">Was Applied</th>
                        <th className="px-4 py-2 text-right font-medium">Other</th>
                        <th className="px-4 py-2 text-right font-medium">Unknown</th>
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
                            {session.total_cancelled -
                              session.was_enrolled -
                              session.was_waitlisted -
                              session.was_applied -
                              session.other_prior_status}
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
                          <td className="border-border border-l px-4 py-2 text-right font-medium">
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
