/**
 * RegistrationOverview - Display registration breakdown for the current year.
 *
 * This is the main registration metrics view showing:
 * - Summary cards (enrolled, waitlisted, cancelled, new/returning)
 * - Gender breakdown and gender by grade charts
 * - Campers by age (season year minus birth year)
 * - Session and session length breakdowns
 * - Years at camp analysis
 * - Session details table
 * - Demographic breakdowns (school, city, synagogue)
 *
 * Supports year-over-year comparison mode when compareYear is set via
 * the metrics session context. Comparison data renders alongside primary
 * data using ComparisonSummaryTable for delta details.
 */

import { formatPercent } from '../../../utils/numberFormat'
import { useCallback, useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { ComparisonSummaryTable } from '../../../components/metrics/ComparisonSummaryTable'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { SessionDetailsTable } from '../../../components/metrics/SessionDetailsTable'
import { BreakdownChart } from '../../../components/metrics/BreakdownChart'
import { CssHorizontalBarChart } from '../../../components/metrics/CssHorizontalBarChart'
import { SESSION_LABEL_WIDTH } from '../../../components/metrics/cssChartUtils'
import { CssVerticalStackedBarChart } from '../../../components/metrics/CssVerticalStackedBarChart'
import { buildSessionComparisonData } from '../../../utils/sessionComparisonData'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
  compareByDateCampThenQuest,
} from '../../../utils/sessionUtils'
import {
  transformAgeData,
  transformGenderData,
  transformGradeData,
  transformSessionData,
  transformSummerYearsData,
  transformFirstSummerYearData,
  transformNewVsReturningData,
} from '../../../utils/metricsTransforms'
import {
  GENDER_DISPLAY_COLORS,
  genderGroupRow,
  genderGroupSegments,
} from '../../../components/metrics/genderColors'
import {
  AnotherIdentityLine,
  GenderFallbackLine,
  GenderFallbackPairLine,
  genderNote,
} from '../../../components/metrics/genderIdentityNotes'
import { Loader2 } from 'lucide-react'
import { DefinitionNotes, DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import { PRIORITY_DAY_PENDING } from '../../../utils/priorityDay'
import { describeCompareBasis } from './overviewCompareBasis'
import { AverageSummersLine } from '../../../components/metrics/AverageSummersLine'
import { tenureNote } from '../../../components/metrics/tenureNotes'
import { OVERVIEW_NOTES } from '../cancelledNotes'
import { AgeChart } from '../../../components/metrics/AgeChart'
import { ageNote } from '../../../components/metrics/ageNotes'
import type {
  DrilldownFilter,
  GenderByGradeBreakdown,
  GenderBySessionLengthBreakdown,
  SessionLengthBySessionBreakdown,
} from '../../../types/metrics'
import type { SessionDateLookup, SessionTypeLookup } from '../../../utils/sessionUtils'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'

// Color palette for session length stacked bars
const SESSION_COLORS = [
  'hsl(160, 100%, 35%)',
  'hsl(42, 92%, 50%)',
  'hsl(200, 70%, 50%)',
  'hsl(280, 60%, 50%)',
  'hsl(350, 70%, 50%)',
  'hsl(100, 60%, 45%)',
  'hsl(30, 80%, 50%)',
  'hsl(180, 60%, 45%)',
]

interface StackedChartItem {
  name: string
  total: number
  [key: string]: string | number | null
}

/**
 * Build CssVerticalStackedBarChart data from SessionLengthBySessionBreakdown.
 */
function buildSessionLengthCssData(
  slsData: SessionLengthBySessionBreakdown[],
  sessionDateLookup: SessionDateLookup,
  sessionTypeLookup: SessionTypeLookup
): {
  chartData: StackedChartItem[]
  segments: Array<{ key: string; label: string; color: string }>
} | null {
  if (slsData.length === 0) return null

  // Collect all unique sessions, sorted camp-then-quest
  const allSessions = new Map<number, string>()
  for (const item of slsData) {
    for (const s of item.sessions) {
      allSessions.set(s.session_cm_id, s.session_name)
    }
  }
  const sessionList = Array.from(allSessions.entries()).sort((a, b) =>
    compareByDateCampThenQuest(a[1], b[1], sessionDateLookup, sessionTypeLookup)
  )

  const segments = sessionList.map(([id, name], i) => ({
    key: `session_${id}`,
    label: name,
    color: SESSION_COLORS[i % SESSION_COLORS.length] ?? 'hsl(0, 0%, 50%)',
  }))

  const chartData: StackedChartItem[] = slsData.map((item) => {
    const row: StackedChartItem = {
      name: item.length_category,
      total: item.total,
    }
    for (const [sessionId] of sessionList) {
      const sessionData = item.sessions.find((s) => s.session_cm_id === sessionId)
      row[`session_${sessionId}`] = sessionData?.count ?? 0
    }
    return row
  })

  return { chartData, segments }
}

/** Gender-by-grade rows: one column per gender identity group (#2898, #75 a). */
function transformGenderByGrade(data: GenderByGradeBreakdown[] | undefined) {
  return (data ?? []).map((g) => ({
    name: g.grade !== null ? String(g.grade) : '?',
    tooltipLabel: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    total: g.total,
    grade: g.grade,
    ...genderGroupRow(g.by_gender),
  }))
}

/** Gender-by-session-length rows: one column per gender identity group. */
function transformGenderByLength(data: GenderBySessionLengthBreakdown[] | undefined) {
  return (data ?? []).map((g) => ({
    name: g.length_category,
    total: g.total,
    ...genderGroupRow(g.by_gender),
  }))
}

export default function RegistrationOverview() {
  const { currentYear } = useCurrentYear()

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const {
    selectedSessionCmId,
    sessions,
    activeSessionTypes,
    compareYear,
    isComparing,
    durationParam,
    filterOptions,
  } = useMetricsSession()

  // Always use enrolled status only
  const statusesParam = 'enrolled'

  // Drilldown state management
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: [statusesParam],
    duration: durationParam,
  })

  const handleNewVsReturningClick = useCallback(
    (filter: DrilldownFilter) => {
      const value = filter.label === 'New Campers' ? 'new' : 'returning'
      setFilter({ ...filter, type: 'returning_status', value })
    },
    [setFilter]
  )

  const handleFirstSummerYearClick = useCallback(
    (filter: DrilldownFilter) => {
      setFilter({
        type: 'first_summer_year',
        value: filter.value,
        label: `First Summer ${filter.label}`,
      })
    },
    [setFilter]
  )

  // Build session lookups for date-aware and camp-then-quest sorting
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  // Fetch registration data with optional comparison year
  const { primary, comparison } = useComparisonRegistrationData(
    currentYear,
    compareYear,
    {
      ...filterOptions,
      statuses: statusesParam,
    },
    { samePoint: true }
  )
  const { data, isLoading, error, refetch, isPlaceholderData } = primary
  const compData = comparison?.data
  // The compare query keeps its previous result too, so a new compare year gets the busy cue
  // as well: its label must not sit over the last compare year's numbers (D-UNCOVERED, #3207).
  const busy = isPlaceholderData || comparison?.isPlaceholderData === true
  const busyYear = isPlaceholderData || compareYear === null ? currentYear : compareYear

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading registration data...</span>
      </div>
    )
  }

  if (error) {
    return <MetricsLoadError label="registration" error={error} onRetry={() => void refetch()} />
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No data available
      </div>
    )
  }

  // Transform data for charts using utility functions
  const genderChartData = transformGenderData(data.by_gender)
  const gradeChartData = transformGradeData(data.by_grade)
  const sessionChartData = transformSessionData(
    data.by_session,
    sessionDateLookup,
    sessionTypeLookup
  )
  const summerYearsData = transformSummerYearsData(data.by_summer_years)
  const firstSummerYearData = transformFirstSummerYearData(data.by_first_summer_year)
  const newVsReturningData = transformNewVsReturningData(data.new_vs_returning)
  const genderByLengthData = transformGenderByLength(data.by_gender_by_session_length)
  const compGenderByLengthData = compData
    ? transformGenderByLength(compData.by_gender_by_session_length)
    : []
  const gradeRows = transformGenderByGrade(data.by_gender_grade)
  const compGradeRows = compData ? transformGenderByGrade(compData.by_gender_grade) : []

  // Fallback to years_at_camp if summer years not available
  const yearsChartData =
    summerYearsData.length > 0
      ? summerYearsData
      : data.by_years_at_camp.map((y) => ({
          name: y.years === 1 ? '1 year' : `${y.years} years`,
          value: y.count,
          percentage: y.percentage,
        }))

  // Decision 7: the compare year is read at the same point while this season is live, at its final
  // after. On the priority date itself the card deltas wait a day (ruling 9).
  // One note list in page order (decision 11), numbered by position: Total Cancelled, the age
  // chart when it has bars, the Summers at Camp average when it exists, then the compare notes
  // while Compare is on.
  // #2898: the gender charts sit under the cards, so Gender's note follows Total Cancelled's. Ruling 58's
  // Gender field count shows only when a season shown counted anyone that way (#73 a).
  const fallbackSeasons = [
    { season: currentYear, count: data.gender_fallback_count ?? 0 },
    ...(compareYear !== null && compData
      ? [{ season: compareYear, count: compData.gender_fallback_count ?? 0 }]
      : []),
  ]
  const genderNoteN = fallbackSeasons.some((s) => s.count > 0)
    ? OVERVIEW_NOTES.length + 1
    : undefined
  const beforeAge = OVERVIEW_NOTES.length + (genderNoteN !== undefined ? 1 : 0)
  const ageNoteN = transformAgeData(data.by_age).length > 0 ? beforeAge + 1 : undefined
  const tenureNoteN =
    data.average_summers_at_camp != null
      ? beforeAge + (ageNoteN !== undefined ? 1 : 0) + 1
      : undefined
  const fallbackLine = (count: number | undefined) =>
    genderNoteN !== undefined && <GenderFallbackLine n={genderNoteN} count={count ?? 0} />
  const groupLine = (rows: ReadonlyArray<{ by_gender: Record<string, number> }> | undefined) => (
    <AnotherIdentityLine counts={(rows ?? []).map((r) => r.by_gender)} />
  )
  const pageNotes = [
    ...OVERVIEW_NOTES,
    ...(genderNoteN !== undefined ? [genderNote(genderNoteN, fallbackSeasons)] : []),
    ...(ageNoteN !== undefined ? [ageNote(ageNoteN)] : []),
    ...(tenureNoteN !== undefined ? [tenureNote(tenureNoteN)] : []),
  ]
  const compareBasis = describeCompareBasis(compareYear, compData, pageNotes.length + 1)
  const pending = compareBasis?.pending ?? false
  const vsCompare = (value: number | null | undefined) =>
    pending || value == null ? undefined : value
  const pendingTrend = pending
    ? { trend: 'neutral' as const, trendValue: PRIORITY_DAY_PENDING }
    : {}
  const waitlistComparable = compareBasis?.waitlistComparable ?? true

  // Sort sessions for table (chart uses sorted version from transformSessionData)
  const sortedBySession = sortSessionDataByCampThenQuest(
    data.by_session,
    sessionDateLookup,
    sessionTypeLookup
  )

  return (
    <MetricsBusy busy={busy} what={String(busyYear)}>
      <div className="space-y-6">
        {compareBasis && (
          <p className="text-muted-foreground -mb-3 text-sm">
            <span className="text-foreground font-medium">{compareBasis.label}</span>
            {': '}
            <span>{compareBasis.text}</span>
            {compareBasis.notes.map((note) => (
              <DefRef key={note.n} n={note.n} />
            ))}
          </p>
        )}

        {/* Summary Cards */}
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5"
          data-tour="reg-overview-summary"
        >
          <MetricCard
            title="Total Enrolled"
            value={data.total_enrolled}
            compareValue={vsCompare(compData?.total_enrolled)}
            {...pendingTrend}
            compareYear={compareYear ?? undefined}
            subtitle={
              selectedSessionCmId ? 'In selected session' : `Active enrollments for ${currentYear}`
            }
            onClick={() =>
              setFilter({
                type: 'status',
                value: 'enrolled',
                label: 'Enrolled Campers',
              })
            }
          />
          <MetricCard
            title="Total Waitlisted"
            value={data.total_waitlisted ?? '—'}
            compareValue={waitlistComparable ? vsCompare(compData?.total_waitlisted) : undefined}
            {...(waitlistComparable ? pendingTrend : {})}
            compareYear={compareYear ?? undefined}
            sentiment="muted"
            subtitle="On waitlist"
            onClick={() =>
              // The Waitlist page's Total list: waitlist columns, Enrolled In (decision 43)
              setFilter({
                type: 'waitlist_total',
                value: 'all',
                label: 'Total Waitlisted',
              })
            }
          />
          <MetricCard
            title="Total Cancelled"
            note={1}
            value={data.total_cancelled}
            compareValue={vsCompare(compData?.total_cancelled)}
            {...pendingTrend}
            compareYear={compareYear ?? undefined}
            sentiment="inverse"
            subtitle="Cancellations"
            onClick={() =>
              // The Cancellations page's Total list (decision 43), scoped to the status this card
              // counts: Cancelled only, where the page also counts withdrawn and dismissed
              setFilter({
                type: 'cancellation_total',
                value: 'all',
                label: 'Total Cancelled',
                statusOverride: ['cancelled'],
              })
            }
          />
          <MetricCard
            title="New Campers"
            value={data.new_vs_returning.new_count}
            compareValue={vsCompare(compData?.new_vs_returning.new_count)}
            {...pendingTrend}
            compareYear={compareYear ?? undefined}
            sentiment="neutral"
            subtitle={`${formatPercent(data.new_vs_returning.new_percentage)} of enrolled`}
            onClick={() =>
              setFilter({
                type: 'returning_status',
                value: 'new',
                label: 'New Campers',
              })
            }
          />
          <MetricCard
            title="Returning Campers"
            value={data.new_vs_returning.returning_count}
            compareValue={vsCompare(compData?.new_vs_returning.returning_count)}
            {...pendingTrend}
            compareYear={compareYear ?? undefined}
            subtitle={`${formatPercent(data.new_vs_returning.returning_percentage)} of enrolled`}
            onClick={() =>
              setFilter({
                type: 'returning_status',
                value: 'returning',
                label: 'Returning Campers',
              })
            }
          />
        </div>

        {/* Charts Row 1: Gender + Gender by Grade */}
        <div className="space-y-6" data-tour="reg-overview-demographics">
          {compareYear !== null && compData ? (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BreakdownChart
                  title={`${currentYear} Gender`}
                  data={genderChartData}
                  showPercentage
                  height={250}
                  breakdownType="gender"
                  onSegmentClick={setFilter}
                  colorMap={GENDER_DISPLAY_COLORS}
                  footer={fallbackLine(data.gender_fallback_count)}
                />
                <BreakdownChart
                  title={`${compareYear} Gender`}
                  data={transformGenderData(compData.by_gender)}
                  showPercentage
                  height={250}
                  colorMap={GENDER_DISPLAY_COLORS}
                  footer={fallbackLine(compData.gender_fallback_count)}
                />
              </div>
              <ComparisonSummaryTable
                title="Gender Comparison"
                primaryYear={currentYear}
                compareYear={compareYear}
                primaryData={genderChartData}
                compareData={transformGenderData(compData.by_gender)}
                categoryLabel="Gender"
                colorMap={GENDER_DISPLAY_COLORS}
                footer={
                  genderNoteN !== undefined && (
                    <GenderFallbackPairLine n={genderNoteN} seasons={fallbackSeasons} />
                  )
                }
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CssVerticalStackedBarChart
                  key={`gender-grade-${selectedSessionCmId ?? 'all'}`}
                  title={`${currentYear} Gender by Grade`}
                  data={gradeRows}
                  segments={genderGroupSegments(gradeRows)}
                  footer={
                    <>
                      {groupLine(data.by_gender_grade)}
                      {fallbackLine(data.gender_fallback_count)}
                    </>
                  }
                  height={250}
                  onBarClick={(item) => {
                    const grade = item['grade']
                    const value = grade !== null ? String(grade) : 'null'
                    const label = grade !== null ? `Grade ${String(grade)}` : 'Unknown'
                    setFilter({ type: 'grade', value, label })
                  }}
                />
                <CssVerticalStackedBarChart
                  title={`${compareYear} Gender by Grade`}
                  data={compGradeRows}
                  segments={genderGroupSegments(compGradeRows)}
                  footer={
                    <>
                      {groupLine(compData.by_gender_grade)}
                      {fallbackLine(compData.gender_fallback_count)}
                    </>
                  }
                  height={250}
                />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <BreakdownChart
                title="Enrollment by Gender"
                data={genderChartData}
                showPercentage
                height={250}
                breakdownType="gender"
                onSegmentClick={setFilter}
                colorMap={GENDER_DISPLAY_COLORS}
                footer={fallbackLine(data.gender_fallback_count)}
              />
              <CssVerticalStackedBarChart
                key={`gender-grade-${selectedSessionCmId ?? 'all'}`}
                title="Gender by Grade"
                data={gradeRows}
                segments={genderGroupSegments(gradeRows)}
                footer={
                  <>
                    {groupLine(data.by_gender_grade)}
                    {fallbackLine(data.gender_fallback_count)}
                  </>
                }
                height={250}
                onBarClick={(item) => {
                  const grade = item['grade']
                  const value = grade !== null ? String(grade) : 'null'
                  const label = grade !== null ? `Grade ${String(grade)}` : 'Unknown'
                  setFilter({ type: 'grade', value, label })
                }}
              />
            </div>
          )}
        </div>

        {/* Charts Row 2: New vs Returning + Grade */}
        {compareYear !== null && compData ? (
          <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <BreakdownChart
                title={`${currentYear} New vs Returning`}
                data={newVsReturningData}
                showPercentage
                height={250}
                breakdownType="returning_status"
                onSegmentClick={handleNewVsReturningClick}
              />
              <BreakdownChart
                title={`${compareYear} New vs Returning`}
                data={transformNewVsReturningData(compData.new_vs_returning)}
                showPercentage
                height={250}
              />
            </div>
            <ComparisonSummaryTable
              title="New vs Returning Comparison"
              primaryYear={currentYear}
              compareYear={compareYear}
              primaryData={newVsReturningData}
              compareData={transformNewVsReturningData(compData.new_vs_returning)}
            />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <CssHorizontalBarChart
                title={`${currentYear} Grade`}
                data={gradeChartData}
                height={300}
                breakdownType="grade"
                onBarClick={setFilter}
              />
              <CssHorizontalBarChart
                title={`${compareYear} Grade`}
                data={transformGradeData(compData.by_grade)}
                height={300}
              />
            </div>
            <ComparisonSummaryTable
              title="Grade Comparison"
              primaryYear={currentYear}
              compareYear={compareYear}
              primaryData={gradeChartData}
              compareData={transformGradeData(compData.by_grade)}
            />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <AgeChart
                title={`${currentYear} Age`}
                data={data.by_age}
                onBarClick={setFilter}
                note={ageNoteN}
              />
              <AgeChart title={`${compareYear} Age`} data={compData.by_age} note={ageNoteN} />
            </div>
            <ComparisonSummaryTable
              title="Age Comparison"
              primaryYear={currentYear}
              compareYear={compareYear}
              primaryData={transformAgeData(data.by_age)}
              compareData={transformAgeData(compData.by_age)}
            />
          </>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BreakdownChart
              title="New vs Returning Campers"
              data={newVsReturningData}
              showPercentage
              height={250}
              breakdownType="returning_status"
              onSegmentClick={handleNewVsReturningClick}
            />
            <CssHorizontalBarChart
              key={`grade-${selectedSessionCmId ?? 'all'}`}
              title="Enrollment by Grade"
              data={gradeChartData}
              height={300}
              breakdownType="grade"
              onBarClick={setFilter}
            />
            <AgeChart
              note={ageNoteN}
              key={`age-${selectedSessionCmId ?? 'all'}`}
              title="Enrollment by Age"
              data={data.by_age}
              onBarClick={setFilter}
            />
          </div>
        )}

        {/* Charts Row 3: Session + Session Length (hidden when single session selected) */}
        {!selectedSessionCmId && (
          <>
            {compareYear !== null && compData ? (
              <>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <CssHorizontalBarChart
                    title={`${currentYear} Session`}
                    data={sessionChartData}
                    height={300}
                    labelWidth={SESSION_LABEL_WIDTH}
                    breakdownType="session"
                    onBarClick={setFilter}
                    percentageLabel="Capacity"
                  />
                  <CssHorizontalBarChart
                    title={`${compareYear} Session`}
                    data={transformSessionData(
                      compData.by_session,
                      sessionDateLookup,
                      sessionTypeLookup
                    )}
                    height={300}
                    labelWidth={SESSION_LABEL_WIDTH}
                    percentageLabel="Capacity"
                  />
                </div>
                <ComparisonSummaryTable
                  title="Session Enrollment Comparison"
                  sortable
                  primaryYear={currentYear}
                  compareYear={compareYear}
                  {...buildSessionComparisonData(
                    data.by_session,
                    compData.by_session,
                    sessionDateLookup,
                    sessionTypeLookup
                  )}
                  matchKey="pairKey"
                  categoryLabel="Session"
                />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {(() => {
                    const result = buildSessionLengthCssData(
                      data.by_session_length_by_session ?? [],
                      sessionDateLookup,
                      sessionTypeLookup
                    )
                    if (!result) return null
                    return (
                      <CssVerticalStackedBarChart
                        data={result.chartData}
                        segments={result.segments}
                        title={`${currentYear} Session Length`}
                        showTotalLabel
                        rotateLabels={result.chartData.length > 3}
                        height={300}
                        onBarClick={(item) =>
                          setFilter({
                            type: 'session_length',
                            value: String(item['name'] ?? ''),
                            label: `${String(item['name'] ?? '')} Sessions`,
                          })
                        }
                      />
                    )
                  })()}
                  {(() => {
                    const result = buildSessionLengthCssData(
                      compData.by_session_length_by_session ?? [],
                      sessionDateLookup,
                      sessionTypeLookup
                    )
                    if (!result) return null
                    return (
                      <CssVerticalStackedBarChart
                        data={result.chartData}
                        segments={result.segments}
                        title={`${compareYear} Session Length`}
                        showTotalLabel
                        rotateLabels={result.chartData.length > 3}
                        height={300}
                      />
                    )
                  })()}
                </div>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {genderByLengthData.length > 0 && (
                    <CssVerticalStackedBarChart
                      title={`${currentYear} Gender by Session Length`}
                      data={genderByLengthData}
                      segments={genderGroupSegments(genderByLengthData)}
                      footer={
                        <>
                          {groupLine(data.by_gender_by_session_length)}
                          {fallbackLine(data.gender_fallback_count)}
                        </>
                      }
                      showTotalLabel
                      height={300}
                      onBarClick={(item) =>
                        setFilter({
                          type: 'session_length',
                          value: String(item['name'] ?? ''),
                          label: `${String(item['name'] ?? '')} Sessions`,
                        })
                      }
                    />
                  )}
                  {compGenderByLengthData.length > 0 && (
                    <CssVerticalStackedBarChart
                      title={`${compareYear} Gender by Session Length`}
                      data={compGenderByLengthData}
                      segments={genderGroupSegments(compGenderByLengthData)}
                      footer={
                        <>
                          {groupLine(compData?.by_gender_by_session_length)}
                          {fallbackLine(compData?.gender_fallback_count)}
                        </>
                      }
                      showTotalLabel
                      height={300}
                    />
                  )}
                </div>
                {genderByLengthData.length > 0 && (
                  <ComparisonSummaryTable
                    title="Gender by Session Length Comparison"
                    primaryYear={currentYear}
                    compareYear={compareYear}
                    primaryData={genderByLengthData.map((g) => ({
                      name: g.name,
                      value: g.total,
                    }))}
                    compareData={compGenderByLengthData.map((g) => ({
                      name: g.name,
                      value: g.total,
                    }))}
                  />
                )}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CssHorizontalBarChart
                  key={`session-${selectedSessionCmId ?? 'all'}`}
                  title="Enrollment by Session"
                  data={sessionChartData}
                  height={300}
                  labelWidth={SESSION_LABEL_WIDTH}
                  breakdownType="session"
                  onBarClick={setFilter}
                  percentageLabel="Capacity"
                />
                {(() => {
                  const result = buildSessionLengthCssData(
                    data.by_session_length_by_session ?? [],
                    sessionDateLookup,
                    sessionTypeLookup
                  )
                  if (!result) return null
                  return (
                    <CssVerticalStackedBarChart
                      data={result.chartData}
                      segments={result.segments}
                      title="Enrollment by Session Length"
                      showTotalLabel
                      rotateLabels={result.chartData.length > 3}
                      height={300}
                      onBarClick={(item) =>
                        setFilter({
                          type: 'session_length',
                          value: String(item['name'] ?? ''),
                          label: `${String(item['name'] ?? '')} Sessions`,
                        })
                      }
                    />
                  )
                })()}
                {genderByLengthData.length > 0 && (
                  <CssVerticalStackedBarChart
                    key={`gender-session-length-${selectedSessionCmId ?? 'all'}`}
                    title="Gender by Session Length"
                    data={genderByLengthData}
                    segments={genderGroupSegments(genderByLengthData)}
                    footer={
                      <>
                        {groupLine(data.by_gender_by_session_length)}
                        {fallbackLine(data.gender_fallback_count)}
                      </>
                    }
                    showTotalLabel
                    height={300}
                    onBarClick={(item) =>
                      setFilter({
                        type: 'session_length',
                        value: String(item['name'] ?? ''),
                        label: `${String(item['name'] ?? '')} Sessions`,
                      })
                    }
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* Charts Row 4: Years at Camp + First Summer Year */}
        {compareYear !== null && compData ? (
          <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <CssHorizontalBarChart
                title={`${currentYear} ${summerYearsData.length > 0 ? 'Summers at Camp' : 'Years at Camp'}`}
                data={yearsChartData}
                height={300}
                breakdownType="years_at_camp"
                onBarClick={setFilter}
                footer={
                  <AverageSummersLine average={data.average_summers_at_camp} note={tenureNoteN} />
                }
              />
              <CssHorizontalBarChart
                title={`${compareYear} ${(compData.by_summer_years?.length ?? 0) > 0 ? 'Summers at Camp' : 'Years at Camp'}`}
                data={
                  (compData.by_summer_years?.length ?? 0) > 0
                    ? transformSummerYearsData(compData.by_summer_years ?? [])
                    : compData.by_years_at_camp.map((y) => ({
                        name: y.years === 1 ? '1 year' : `${y.years} years`,
                        value: y.count,
                        percentage: y.percentage,
                      }))
                }
                height={300}
                footer={
                  <AverageSummersLine
                    average={compData.average_summers_at_camp}
                    note={tenureNoteN}
                  />
                }
              />
            </div>
            <ComparisonSummaryTable
              title="Summers at Camp Comparison"
              primaryYear={currentYear}
              compareYear={compareYear}
              primaryData={yearsChartData}
              compareData={
                (compData.by_summer_years?.length ?? 0) > 0
                  ? transformSummerYearsData(compData.by_summer_years ?? [])
                  : compData.by_years_at_camp.map((y) => ({
                      name: y.years === 1 ? '1 year' : `${y.years} years`,
                      value: y.count,
                      percentage: y.percentage,
                    }))
              }
            />
            {firstSummerYearData.length > 0 && (
              <>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <CssHorizontalBarChart
                    title={`${currentYear} First Summer Year`}
                    data={firstSummerYearData}
                    height={300}
                    breakdownType="first_summer_year"
                    onBarClick={handleFirstSummerYearClick}
                  />
                  <CssHorizontalBarChart
                    title={`${compareYear} First Summer Year`}
                    data={transformFirstSummerYearData(compData.by_first_summer_year)}
                    height={300}
                  />
                </div>
                <ComparisonSummaryTable
                  title="First Summer Year Comparison"
                  primaryYear={currentYear}
                  compareYear={compareYear}
                  primaryData={firstSummerYearData}
                  compareData={transformFirstSummerYearData(compData.by_first_summer_year)}
                />
              </>
            )}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CssHorizontalBarChart
              key={`years-${selectedSessionCmId ?? 'all'}`}
              title={
                summerYearsData.length > 0
                  ? 'Enrollment by Summers at Camp'
                  : 'Enrollment by Years at Camp'
              }
              data={yearsChartData}
              height={300}
              breakdownType="years_at_camp"
              onBarClick={setFilter}
              footer={
                <AverageSummersLine average={data.average_summers_at_camp} note={tenureNoteN} />
              }
            />
            {firstSummerYearData.length > 0 && (
              <CssHorizontalBarChart
                key={`first-year-${selectedSessionCmId ?? 'all'}`}
                title="Enrollment by First Summer Year"
                data={firstSummerYearData}
                height={300}
                breakdownType="first_summer_year"
                onBarClick={handleFirstSummerYearClick}
              />
            )}
          </div>
        )}

        {/* Session Details Table */}
        <div className="card-lodge overflow-hidden" data-tour="reg-overview-session-table">
          <SessionDetailsTable
            current={sortedBySession}
            prior={compData?.by_session}
            isComparing={isComparing}
            currentYear={currentYear}
            compareYear={compareYear}
          />
        </div>

        <DefinitionNotes notes={[...pageNotes, ...(compareBasis?.notes ?? [])]} />

        {/* Drill-down Modal */}
        <DrilldownModal />
      </div>
    </MetricsBusy>
  )
}
