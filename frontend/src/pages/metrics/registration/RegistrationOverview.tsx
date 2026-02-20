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

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { ComparisonSummaryTable } from '../../../components/metrics/ComparisonSummaryTable'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { BreakdownChart } from '../../../components/metrics/BreakdownChart'
import { GenderByGradeChart } from '../../../components/metrics/GenderByGradeChart'
import { SessionLengthBySessionChart } from '../../../components/metrics/SessionLengthBySessionChart'
import { getSessionChartLabel } from '../../../utils/sessionDisplay'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
} from '../../../utils/sessionUtils'
import {
  transformGenderData,
  transformGradeData,
  transformSessionData,
  transformSummerYearsData,
  transformFirstSummerYearData,
  transformNewVsReturningData,
} from '../../../utils/metricsTransforms'
import { Loader2, AlertCircle } from 'lucide-react'

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
  } = useMetricsSession()

  // Always use enrolled status only
  const statusesParam = 'enrolled'

  // Drilldown state management
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: [statusesParam],
  })

  // Build session lookups for date-aware and camp-then-quest sorting
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])
  const sessionTypeLookup = useMemo(() => buildSessionTypeLookup(sessions), [sessions])

  // Fetch registration data with optional comparison year
  const { primary, comparison } = useComparisonRegistrationData(
    currentYear,
    compareYear,
    sessionTypesParam,
    statusesParam,
    selectedSessionCmId ?? undefined
  )
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
              type="pie"
              showPercentage
              height={250}
              breakdownType="gender"
              onSegmentClick={setFilter}
            />
            <BreakdownChart
              title={`${compareYear} Gender`}
              data={transformGenderData(compData.by_gender)}
              type="pie"
              showPercentage
              height={250}
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
            <GenderByGradeChart
              data={data.by_gender_grade ?? []}
              title={`${currentYear} Gender by Grade`}
              height={250}
              onBarClick={setFilter}
            />
            <GenderByGradeChart
              data={compData.by_gender_grade ?? []}
              title={`${compareYear} Gender by Grade`}
              height={250}
            />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BreakdownChart
            title="Enrollment by Gender"
            data={genderChartData}
            type="pie"
            showPercentage
            height={250}
            breakdownType="gender"
            onSegmentClick={setFilter}
          />
          <GenderByGradeChart
            data={data.by_gender_grade ?? []}
            title="Gender by Grade"
            height={250}
            onBarClick={setFilter}
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
              type="pie"
              showPercentage
              height={250}
              breakdownType="returning_status"
              onSegmentClick={(filter) => {
                const value = filter.label === 'New Campers' ? 'new' : 'returning'
                setFilter({ ...filter, type: 'returning_status', value })
              }}
            />
            <BreakdownChart
              title={`${compareYear} New vs Returning`}
              data={transformNewVsReturningData(compData.new_vs_returning)}
              type="pie"
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
            <BreakdownChart
              title={`${currentYear} Grade`}
              data={gradeChartData}
              type="bar"
              height={300}
              breakdownType="grade"
              onSegmentClick={setFilter}
            />
            <BreakdownChart
              title={`${compareYear} Grade`}
              data={transformGradeData(compData.by_grade)}
              type="bar"
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
            type="pie"
            showPercentage
            height={250}
            breakdownType="returning_status"
            onSegmentClick={(filter) => {
              const value = filter.label === 'New Campers' ? 'new' : 'returning'
              setFilter({ ...filter, type: 'returning_status', value })
            }}
          />
          <BreakdownChart
            title="Enrollment by Grade"
            data={gradeChartData}
            type="bar"
            height={300}
            breakdownType="grade"
            onSegmentClick={setFilter}
          />
        </div>
      )}

      {/* Charts Row 3: Session + Session Length (hidden when single session selected) */}
      {!selectedSessionCmId && (
        <>
          {isComparing && compData ? (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BreakdownChart
                  title={`${currentYear} Session`}
                  data={sessionChartData}
                  type="bar"
                  height={350}
                  breakdownType="session"
                  onSegmentClick={setFilter}
                />
                <BreakdownChart
                  title={`${compareYear} Session`}
                  data={transformSessionData(
                    compData.by_session,
                    sessionDateLookup,
                    sessionTypeLookup
                  )}
                  type="bar"
                  height={350}
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
                matchKey="id"
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SessionLengthBySessionChart
                  data={data.by_session_length_by_session ?? []}
                  title={`${currentYear} Session Length`}
                  height={350}
                  sessionDateLookup={sessionDateLookup}
                  sessionTypeLookup={sessionTypeLookup}
                  onCategoryClick={(lengthCategory) =>
                    setFilter({
                      type: 'session_length',
                      value: lengthCategory,
                      label: `${lengthCategory} Sessions`,
                    })
                  }
                />
                <SessionLengthBySessionChart
                  data={compData.by_session_length_by_session ?? []}
                  title={`${compareYear} Session Length`}
                  height={350}
                  sessionDateLookup={sessionDateLookup}
                  sessionTypeLookup={sessionTypeLookup}
                />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <BreakdownChart
                title="Enrollment by Session"
                data={sessionChartData}
                type="bar"
                height={350}
                breakdownType="session"
                onSegmentClick={setFilter}
              />
              <SessionLengthBySessionChart
                data={data.by_session_length_by_session ?? []}
                title="Enrollment by Session Length"
                height={350}
                sessionDateLookup={sessionDateLookup}
                sessionTypeLookup={sessionTypeLookup}
                onCategoryClick={(lengthCategory) =>
                  setFilter({
                    type: 'session_length',
                    value: lengthCategory,
                    label: `${lengthCategory} Sessions`,
                  })
                }
              />
            </div>
          )}
        </>
      )}

      {/* Charts Row 4: Years at Camp + First Summer Year */}
      {isComparing && compData ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BreakdownChart
              title={`${currentYear} ${summerYearsData.length > 0 ? 'Summers at Camp' : 'Years at Camp'}`}
              data={yearsChartData}
              type="bar"
              height={300}
              breakdownType="years_at_camp"
              onSegmentClick={setFilter}
            />
            <BreakdownChart
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
              type="bar"
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
                <BreakdownChart
                  title={`${currentYear} First Summer Year`}
                  data={firstSummerYearData}
                  type="bar"
                  height={300}
                  breakdownType="first_summer_year"
                  onSegmentClick={(filter) => {
                    setFilter({
                      type: 'first_summer_year',
                      value: filter.value,
                      label: `First Summer ${filter.value}`,
                    })
                  }}
                />
                <BreakdownChart
                  title={`${compareYear} First Summer Year`}
                  data={transformFirstSummerYearData(compData.by_first_summer_year)}
                  type="bar"
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
          <BreakdownChart
            title={
              summerYearsData.length > 0
                ? 'Enrollment by Summers at Camp'
                : 'Enrollment by Years at Camp'
            }
            data={yearsChartData}
            type="bar"
            height={300}
            breakdownType="years_at_camp"
            onSegmentClick={setFilter}
          />
          {firstSummerYearData.length > 0 && (
            <BreakdownChart
              title="Enrollment by First Summer Year"
              data={firstSummerYearData}
              type="bar"
              height={300}
              breakdownType="first_summer_year"
              onSegmentClick={(filter) => {
                setFilter({
                  type: 'first_summer_year',
                  value: filter.value,
                  label: `First Summer ${filter.value}`,
                })
              }}
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
                        (s) => s.session_cm_id === session.session_cm_id
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
