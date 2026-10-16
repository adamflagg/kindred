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
import { SESSION_LABEL_WIDTH } from '../../../components/metrics/cssChartUtils'
import { transformGenderData } from '../../../utils/metricsTransforms'
import { GENDER_DISPLAY_COLORS } from '../../../components/metrics/genderColors'
import {
  GenderFallbackLine,
  GenderFallbackPairLine,
} from '../../../components/metrics/genderIdentityNotes'
import { genderNote, shownFallbackSeasons } from '../../../components/metrics/genderNotes'
import { SESSION_NAME_ALIASES, resolveSessionAlias } from '../../../utils/sessionAliases'
import { ComparisonSummaryTable } from '../../../components/metrics/ComparisonSummaryTable'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
} from '../../../utils/sessionUtils'
import type { CancellationSessionBreakdown } from '../../../types/metrics'
import { sessionName } from '../../../utils/sessionName'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'
import { DefinitionNotes, DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import { formatCount, formatPercent, formatSignedCount } from '../../../utils/numberFormat'
import { CANCELLATIONS_NOTES } from '../cancelledNotes'
import { deltaInk } from '../../../utils/deltaTokens'

const CANCEL_SEGMENTS: StackedSegment[] = [
  { key: 'was_enrolled', label: 'Was Enrolled', color: 'hsl(200, 70%, 50%)' },
  { key: 'was_waitlisted', label: 'Was Waitlisted', color: 'hsl(42, 92%, 50%)' },
  { key: 'was_applied', label: 'Was Applied', color: 'hsl(280, 60%, 55%)' },
  { key: 'other_prior_status', label: 'Other Prior Status', color: 'hsl(200, 15%, 55%)' },
  { key: 'unknown', label: 'Unknown', color: 'hsl(0, 0%, 75%)' },
]

/**
 * The chart's fixed 300px clips rows past 11 into overflow-hidden (All Summer has more). Past
 * that, size it for calculateBarSizing's dense path: 20px rows, 1px gaps, a 28px axis.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function cancelSessionChartHeight(rows: number): number {
  return rows > 11 ? rows * 21 + 28 : 300
}

// eslint-disable-next-line react-refresh/only-export-components
export function transformCancelSessionData(
  bySession: CancellationSessionBreakdown[],
  sessionDateLookup: Record<string, string>,
  sessionTypeLookup: Record<string, string>
): { data: StackedBarDataItem[]; sorted: CancellationSessionBreakdown[] } {
  const sorted = sortSessionDataByCampThenQuest(bySession, sessionDateLookup, sessionTypeLookup)
  const data = sorted.map((item) => {
    const known =
      item.was_enrolled +
      item.was_waitlisted +
      (item.was_applied ?? 0) +
      (item.other_prior_status ?? 0)
    return {
      // The shared short form (board 6), not CampMinder's raw name.
      name: sessionName(item.session_name, sessionTypeLookup[item.session_name], 'short'),
      total: item.total_cancelled,
      was_enrolled: item.was_enrolled,
      was_waitlisted: item.was_waitlisted,
      was_applied: item.was_applied ?? 0,
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
    activeSessionTypes,
    compareYear,
    isComparing,
    durationParam,
    filterOptions,
  } = useMetricsSession()
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  const { primary, comparison } = useComparisonCancellationData(
    currentYear,
    compareYear,
    filterOptions
  )
  const { data, isLoading, error, refetch, isPlaceholderData } = primary
  const compData = comparison?.data
  // The compare query keeps its previous result too, so a new compare year gets the busy cue
  // as well: its label must not sit over the last compare year's numbers (D-UNCOVERED, #3207).
  const busy = isPlaceholderData || comparison?.isPlaceholderData === true
  const busyYear = isPlaceholderData || compareYear === null ? currentYear : compareYear

  // #2898 ruling 58: campers with no identity answer count by the Gender field; a visible line under each
  // gender chart and a page-foot note say how many, only when a season shown has any (#73 a).
  const fallbackSeasons = shownFallbackSeasons(currentYear, data, compareYear, compData)
  const genderNoteN = fallbackSeasons.some((s) => s.count > 0)
    ? CANCELLATIONS_NOTES.length + 1
    : undefined
  const pageNotes = [
    ...CANCELLATIONS_NOTES,
    ...(genderNoteN !== undefined ? [genderNote(genderNoteN, fallbackSeasons)] : []),
  ]
  const fallbackLine = (count: number | undefined) =>
    genderNoteN !== undefined && <GenderFallbackLine n={genderNoteN} count={count ?? 0} />

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
    <MetricsQueryGuard
      onRetry={() => void refetch()}
      isPlaceholderData={busy}
      loadingLabel={String(busyYear)}
      isLoading={isLoading}
      error={error}
      data={data}
      label="cancellations"
    >
      {(data) => {
        return (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
              data-tour="reg-cancel-summary"
            >
              <MetricCard
                title="Total Cancelled"
                note={1}
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-tour="reg-cancel-timing">
                {data.session_swap_count != null && data.session_swap_count > 0 && (
                  <div className="border-border bg-card rounded-lg border p-4">
                    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Session Swaps
                      <DefRef n={2} />
                    </div>
                    <div className="text-foreground text-2xl font-bold tabular-nums">
                      {formatCount(data.session_swap_count)}
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
                      <DefRef n={2} />
                    </div>
                    <div className="text-foreground text-2xl font-bold tabular-nums">
                      {formatCount(data.true_departure_count)}
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
                      {formatCount(Math.round(data.avg_days_to_cancellation))} days
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
                      {formatCount(Math.round(data.median_days_to_cancellation))} days
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
                              {formatCount(bucket.count)} ({formatPercent(bucket.percentage)})
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
                            {formatCount(item.count)} ({formatPercent(item.percentage)})
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
                    labelWidth={SESSION_LABEL_WIDTH}
                    height={cancelSessionChartHeight(primarySession.data.length)}
                    onBarClick={(item) => {
                      // Bars carry the short name; find the row by position, not by name.
                      const session = primarySession.sorted[primarySession.data.indexOf(item)]
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
                      labelWidth={SESSION_LABEL_WIDTH}
                      height={cancelSessionChartHeight(
                        Math.max(primarySession.data.length, compSessionData.data.length)
                      )}
                    />
                  )}
                </div>
                {compareYear !== null && compSessionData && (
                  <ComparisonSummaryTable
                    title="Cancellations by Session Comparison"
                    sortable
                    sentiment="inverse"
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
                          sentiment="inverse"
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
                            footer={fallbackLine(data.gender_fallback_count)}
                            onSegmentClick={setFilter}
                            title={`${currentYear} Gender Distribution`}
                          />
                          <CancellationGenderChart
                            data={compData.by_gender}
                            footer={fallbackLine(compData.gender_fallback_count)}
                            title={`${compareYear} Gender Distribution`}
                          />
                        </div>
                        <ComparisonSummaryTable
                          title="Gender Distribution Comparison"
                          sentiment="inverse"
                          primaryYear={currentYear}
                          compareYear={compareYear}
                          primaryData={transformGenderData(data.by_gender)}
                          compareData={transformGenderData(compData.by_gender)}
                          categoryLabel="Gender"
                          colorMap={GENDER_DISPLAY_COLORS}
                          footer={
                            genderNoteN !== undefined && (
                              <GenderFallbackPairLine n={genderNoteN} seasons={fallbackSeasons} />
                            )
                          }
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
                        footer={fallbackLine(data.gender_fallback_count)}
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
                            {formatCount(session.was_enrolled)}
                          </td>
                          <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">
                            {formatCount(session.was_waitlisted)}
                          </td>
                          <td className="px-4 py-2 text-right text-purple-600 dark:text-purple-400">
                            {formatCount(session.was_applied ?? 0)}
                          </td>
                          <td className="text-muted-foreground px-4 py-2 text-right">
                            {formatCount(session.other_prior_status ?? 0)}
                          </td>
                          <td className="text-muted-foreground px-4 py-2 text-right">
                            {formatCount(
                              session.total_cancelled -
                                session.was_enrolled -
                                session.was_waitlisted -
                                (session.was_applied ?? 0) -
                                (session.other_prior_status ?? 0)
                            )}
                          </td>
                          <td className="border-border border-l px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">
                            {formatCount(session.has_other_sessions)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span
                              className={
                                session.no_other_sessions > 0
                                  ? 'font-semibold text-red-600 dark:text-red-400'
                                  : ''
                              }
                            >
                              {formatCount(session.no_other_sessions)}
                            </span>
                          </td>
                          <td className="border-border border-l px-4 py-2 text-right font-medium">
                            {formatCount(session.total_cancelled)}
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
                                    {formatCount(compSession?.total_cancelled)}
                                  </td>
                                  <td
                                    className={`px-4 py-2 text-right ${deltaInk(delta ?? 0, 'up-bad')}`}
                                  >
                                    {delta !== null ? formatSignedCount(delta) : '\u2014'}
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

            <DefinitionNotes notes={pageNotes} />
            <DrilldownModal />
          </div>
        )
      }}
    </MetricsQueryGuard>
  )
}
