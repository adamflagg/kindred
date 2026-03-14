/**
 * RegistrationOverview - Display registration breakdown for the current year.
 *
 * This is the main registration metrics view showing:
 * - Summary cards (enrolled, waitlisted, cancelled, new/returning)
 * - Gender breakdown and gender by grade charts
 * - Session and session length breakdowns
 * - Years at camp analysis
 * - Session details table
 * - Demographic breakdowns (school, city, synagogue)
 *
 * Supports year-over-year comparison mode when compareYear is set via
 * the metrics session context. Comparison data renders alongside primary
 * data using ComparisonSummaryTable for delta details.
 */

import { useCallback, useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { ComparisonSummaryTable } from '../../../components/metrics/ComparisonSummaryTable'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { BreakdownChart } from '../../../components/metrics/BreakdownChart'
import { CssHorizontalBarChart } from '../../../components/metrics/CssHorizontalBarChart'
import { CssVerticalStackedBarChart } from '../../../components/metrics/CssVerticalStackedBarChart'
import { getSessionChartLabel } from '../../../utils/sessionDisplay'
import { SESSION_NAME_ALIASES, resolveSessionAlias } from '../../../utils/sessionAliases'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
  compareByDateCampThenQuest,
} from '../../../utils/sessionUtils'
import {
  transformGenderData,
  transformGradeData,
  transformSessionData,
  transformSummerYearsData,
  transformFirstSummerYearData,
  transformNewVsReturningData,
} from '../../../utils/metricsTransforms'
import { GENDER_COLORS, GENDER_SEGMENTS } from '../../../components/metrics/genderColors'
import { Loader2, AlertCircle } from 'lucide-react'
import type { DrilldownFilter, SessionLengthBySessionBreakdown } from '../../../types/metrics'
import type { SessionDateLookup, SessionTypeLookup } from '../../../utils/sessionUtils'

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

/** Transform gender-by-grade API data into chart-ready format */
function transformGenderByGrade(
  data:
    | Array<{ grade: number | null; total: number; male_count: number; female_count: number }>
    | undefined
) {
  return (data ?? []).map((g) => ({
    name: g.grade !== null ? String(g.grade) : '?',
    tooltipLabel: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    total: g.total,
    male_count: g.male_count,
    female_count: g.female_count,
    grade: g.grade,
  }))
}

export default function RegistrationOverview() {
  const { currentYear } = useCurrentYear()

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const {
    selectedSessionCmId,
    sessions,
    sessionTypesParam,
    activeSessionTypes,
    compareYear,
    isComparing,
    durationParam,
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
        label: `First Summer ${filter.value}`,
      })
    },
    [setFilter]
  )

  // Build session lookups for date-aware and camp-then-quest sorting
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  // Fetch registration data with optional comparison year
  const { primary, comparison } = useComparisonRegistrationData(currentYear, compareYear, {
    sessionTypes: sessionTypesParam,
    statuses: statusesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
    duration: durationParam,
  })
  const { data, isLoading, error } = primary
  const compData = comparison?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading registration data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load registration data: {error.message}</span>
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
  const genderByLengthData = (data.by_gender_by_session_length ?? []).map((g) => ({
    name: g.length_category,
    total: g.total,
    male_count: g.male_count,
    female_count: g.female_count,
  }))
  const compGenderByLengthData = compData
    ? (compData.by_gender_by_session_length ?? []).map((g) => ({
        name: g.length_category,
        total: g.total,
        male_count: g.male_count,
        female_count: g.female_count,
      }))
    : []

  // Fallback to years_at_camp if summer years not available
  const yearsChartData =
    summerYearsData.length > 0
      ? summerYearsData
      : data.by_years_at_camp.map((y) => ({
          name: y.years === 1 ? '1 year' : `${y.years} years`,
          value: y.count,
          percentage: y.percentage,
        }))

  // Sort sessions for table (chart uses sorted version from transformSessionData)
  const sortedBySession = sortSessionDataByCampThenQuest(
    data.by_session,
    sessionDateLookup,
    sessionTypeLookup
  )

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Total Enrolled"
          value={data.total_enrolled}
          compareValue={compData?.total_enrolled}
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
          value={data.total_waitlisted}
          compareValue={compData?.total_waitlisted}
          compareYear={compareYear ?? undefined}
          subtitle="On waitlist"
          onClick={() =>
            setFilter({
              type: 'status',
              value: 'waitlisted',
              label: 'Waitlisted Campers',
              statusOverride: ['waitlisted'],
            })
          }
        />
        <MetricCard
          title="Total Cancelled"
          value={data.total_cancelled}
          compareValue={compData?.total_cancelled}
          compareYear={compareYear ?? undefined}
          sentiment="inverse"
          subtitle="Cancellations"
          onClick={() =>
            setFilter({
              type: 'status',
              value: 'cancelled',
              label: 'Cancelled Campers',
              statusOverride: ['cancelled'],
            })
          }
        />
        <MetricCard
          title="New Campers"
          value={data.new_vs_returning.new_count}
          compareValue={compData?.new_vs_returning.new_count}
          compareYear={compareYear ?? undefined}
          sentiment="neutral"
          subtitle={`${data.new_vs_returning.new_percentage.toFixed(1)}% of enrolled`}
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
          compareValue={compData?.new_vs_returning.returning_count}
          compareYear={compareYear ?? undefined}
          subtitle={`${data.new_vs_returning.returning_percentage.toFixed(1)}% of enrolled`}
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
      {isComparing && compData ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BreakdownChart
              title={`${currentYear} Gender`}
              data={genderChartData}
              showPercentage
              height={250}
              breakdownType="gender"
              onSegmentClick={setFilter}
              colorMap={GENDER_COLORS}
            />
            <BreakdownChart
              title={`${compareYear} Gender`}
              data={transformGenderData(compData.by_gender)}
              showPercentage
              height={250}
              colorMap={GENDER_COLORS}
            />
          </div>
          <ComparisonSummaryTable
            title="Gender Comparison"
            primaryYear={currentYear}
            compareYear={compareYear!}
            primaryData={genderChartData}
            compareData={transformGenderData(compData.by_gender)}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CssVerticalStackedBarChart
              key={`gender-grade-${selectedSessionCmId ?? 'all'}`}
              title={`${currentYear} Gender by Grade`}
              data={transformGenderByGrade(data.by_gender_grade)}
              segments={[
                { key: 'female_count', label: 'Female', color: 'hsl(350, 70%, 50%)' },
                { key: 'male_count', label: 'Male', color: 'hsl(200, 70%, 50%)' },
              ]}
              height={250}
              onBarClick={(item) => {
                const grade = item['grade']
                const value = grade !== null ? String(grade) : 'null'
                const label = grade !== null ? `Grade ${grade}` : 'Unknown'
                setFilter({ type: 'grade', value, label })
              }}
            />
            <CssVerticalStackedBarChart
              title={`${compareYear} Gender by Grade`}
              data={transformGenderByGrade(compData.by_gender_grade)}
              segments={[
                { key: 'female_count', label: 'Female', color: 'hsl(350, 70%, 50%)' },
                { key: 'male_count', label: 'Male', color: 'hsl(200, 70%, 50%)' },
              ]}
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
            colorMap={GENDER_COLORS}
          />
          <CssVerticalStackedBarChart
            key={`gender-grade-${selectedSessionCmId ?? 'all'}`}
            title="Gender by Grade"
            data={transformGenderByGrade(data.by_gender_grade)}
            segments={[
              { key: 'female_count', label: 'Female', color: 'hsl(350, 70%, 50%)' },
              { key: 'male_count', label: 'Male', color: 'hsl(200, 70%, 50%)' },
            ]}
            height={250}
            onBarClick={(item) => {
              const grade = item['grade']
              const value = grade !== null ? String(grade) : 'null'
              const label = grade !== null ? `Grade ${grade}` : 'Unknown'
              setFilter({ type: 'grade', value, label })
            }}
          />
        </div>
      )}

      {/* Charts Row 2: New vs Returning + Grade */}
      {isComparing && compData ? (
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
            compareYear={compareYear!}
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
            compareYear={compareYear!}
            primaryData={gradeChartData}
            compareData={transformGradeData(compData.by_grade)}
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
        </div>
      )}

      {/* Charts Row 3: Session + Session Length (hidden when single session selected) */}
      {!selectedSessionCmId && (
        <>
          {isComparing && compData ? (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CssHorizontalBarChart
                  title={`${currentYear} Session`}
                  data={sessionChartData}
                  height={300}
                  labelWidth={140}
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
                  labelWidth={140}
                  percentageLabel="Capacity"
                />
              </div>
              <ComparisonSummaryTable
                title="Session Enrollment Comparison"
                primaryYear={currentYear}
                compareYear={compareYear!}
                primaryData={sessionChartData}
                compareData={transformSessionData(
                  compData.by_session,
                  sessionDateLookup,
                  sessionTypeLookup
                )}
                aliasMap={SESSION_NAME_ALIASES}
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
                          label: `${item['name']} Sessions`,
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
                    segments={GENDER_SEGMENTS}
                    showTotalLabel
                    height={300}
                    onBarClick={(item) =>
                      setFilter({
                        type: 'session_length',
                        value: String(item['name'] ?? ''),
                        label: `${item['name']} Sessions`,
                      })
                    }
                  />
                )}
                {compGenderByLengthData.length > 0 && (
                  <CssVerticalStackedBarChart
                    title={`${compareYear} Gender by Session Length`}
                    data={compGenderByLengthData}
                    segments={GENDER_SEGMENTS}
                    showTotalLabel
                    height={300}
                  />
                )}
              </div>
              {genderByLengthData.length > 0 && (
                <ComparisonSummaryTable
                  title="Gender by Session Length Comparison"
                  primaryYear={currentYear}
                  compareYear={compareYear!}
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
                labelWidth={140}
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
                        label: `${item['name']} Sessions`,
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
                  segments={GENDER_SEGMENTS}
                  showTotalLabel
                  height={300}
                  onBarClick={(item) =>
                    setFilter({
                      type: 'session_length',
                      value: String(item['name'] ?? ''),
                      label: `${item['name']} Sessions`,
                    })
                  }
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Charts Row 4: Years at Camp + First Summer Year */}
      {isComparing && compData ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CssHorizontalBarChart
              title={`${currentYear} ${summerYearsData.length > 0 ? 'Summers at Camp' : 'Years at Camp'}`}
              data={yearsChartData}
              height={300}
              breakdownType="years_at_camp"
              onBarClick={setFilter}
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
            />
          </div>
          <ComparisonSummaryTable
            title="Summers at Camp Comparison"
            primaryYear={currentYear}
            compareYear={compareYear!}
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
                compareYear={compareYear!}
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
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">Session Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Session</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Enrolled</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Capacity</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Utilization
                </th>
                {isComparing && compData && (
                  <>
                    <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                      {compareYear} Enrolled
                    </th>
                    <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                      Delta
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedBySession.map((session, index) => (
                <tr
                  key={index}
                  className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                >
                  <td className="text-foreground px-4 py-3 font-medium">
                    {getSessionChartLabel(session.session_name, undefined, sessionDateLookup)}
                    {isComparing &&
                      compData &&
                      (() => {
                        const compSession = compData.by_session.find(
                          (s) =>
                            resolveSessionAlias(s.session_name) ===
                            resolveSessionAlias(session.session_name)
                        )
                        return compSession && compSession.session_name !== session.session_name ? (
                          <span className="text-muted-foreground ml-1 text-xs">
                            (was: {compSession.session_name})
                          </span>
                        ) : null
                      })()}
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">{session.count}</td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {session.capacity ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {session.utilization !== null ? (
                      <span
                        className={
                          session.utilization > 100
                            ? 'text-red-600 dark:text-red-400'
                            : session.utilization >= 90
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-foreground'
                        }
                      >
                        {session.utilization.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {isComparing &&
                    compData &&
                    (() => {
                      const compSession = compData.by_session.find(
                        (s) =>
                          resolveSessionAlias(s.session_name) ===
                          resolveSessionAlias(session.session_name)
                      )
                      const delta = compSession ? session.count - compSession.count : null
                      return (
                        <>
                          <td className="text-foreground px-4 py-3 text-right">
                            {compSession?.count ?? '—'}
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${delta && delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta && delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                          >
                            {delta !== null ? (delta > 0 ? `+${delta}` : delta) : '—'}
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

      {/* Drill-down Modal */}
      <DrilldownModal />
    </div>
  )
}
