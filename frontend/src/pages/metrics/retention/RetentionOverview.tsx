/**
 * RetentionOverview - Display retention metrics with 3-year trend view.
 *
 * Wrapper component that uses the current year from context.
 * Shows:
 * - 3-year retention trends
 * - Session-specific filtering
 * - Gender and grade composition over time
 * - Cohort analysis
 * - Demographic breakdowns
 */

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { BreakdownChart } from '../../../components/metrics/BreakdownChart'
import { RetentionRateLine } from '../../../components/metrics/RetentionRateLine'
import { GenderStackedChart } from '../../../components/metrics/GenderStackedChart'
import { GradeEnrollmentChart } from '../../../components/metrics/GradeEnrollmentChart'
import { DemographicTable } from '../../../components/metrics/DemographicTable'
import { getSessionChartLabel } from '../../../utils/sessionDisplay'
import { buildSessionDateLookup, sortSessionDataByDate } from '../../../utils/sessionUtils'
import {
  transformRetentionSessionData,
  transformRetentionSummerYearsData,
  transformRetentionFirstSummerYearData,
  transformPriorSessionData,
  transformDemographicTableData,
  getTrendDirection,
} from '../../../utils/metricsTransforms'
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react'

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag', 'quest']

export default function RetentionOverview() {
  const { currentYear } = useCurrentYear()
  const sessionTypesParam = DEFAULT_SESSION_TYPES.join(',')

  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const { selectedSessionCmId, sessions } = useMetricsSession()

  // Calculate base year (year before current year) for the primary view
  const baseYear = currentYear - 1

  // Drilldown state management (uses baseYear since retention shows who from baseYear returned)
  const { setFilter, DrilldownModal } = useDrilldown({
    year: baseYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: DEFAULT_SESSION_TYPES,
    statusFilter: ['enrolled'],
  })

  // Build session date lookup for date-aware sorting
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])

  // Fetch 3-year retention trends
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
  } = useRetentionTrends(currentYear, {
    numYears: 3,
    sessionTypes: sessionTypesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
  })

  // Also fetch detailed retention data for the current year transition
  const { data: detailedData } = useRetentionMetrics(
    baseYear,
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  if (trendsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading retention data...</span>
      </div>
    )
  }

  if (trendsError) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load retention data: {trendsError.message}</span>
      </div>
    )
  }

  if (!trendsData || trendsData.years.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No retention data available
      </div>
    )
  }

  // Get the most recent year transition for detailed stats
  const latestTransition = trendsData.years[trendsData.years.length - 1]

  // Get trend display info using utility
  const trendInfo = getTrendDirection(trendsData.trend_direction)
  const renderTrendIcon = () => {
    switch (trendsData.trend_direction) {
      case 'improving':
        return <TrendingUp className={`h-5 w-5 ${trendInfo.colorClass}`} />
      case 'declining':
        return <TrendingDown className={`h-5 w-5 ${trendInfo.colorClass}`} />
      default:
        return <Minus className={`h-5 w-5 ${trendInfo.colorClass}`} />
    }
  }

  // Transform data for charts using utility functions
  const sessionChartData = transformRetentionSessionData(
    detailedData?.by_session,
    sessionDateLookup
  )
  const summerYearsChartData = transformRetentionSummerYearsData(detailedData?.by_summer_years)
  const firstSummerYearChartData = transformRetentionFirstSummerYearData(
    detailedData?.by_first_summer_year
  )
  const priorSessionChartData = transformPriorSessionData(
    detailedData?.by_prior_session,
    sessionDateLookup
  )

  // Demographics for tables using utility functions
  const schoolTableData = transformDemographicTableData(detailedData?.by_school, 'school')
  const cityTableData = transformDemographicTableData(detailedData?.by_city, 'city')
  const synagogueTableData = transformDemographicTableData(detailedData?.by_synagogue, 'synagogue')

  // Sorted sessions for table (needed separately from chart)
  const sortedBySession = sortSessionDataByDate(detailedData?.by_session ?? [], sessionDateLookup)

  return (
    <div className="space-y-6">
      {/* Trend indicator (session selector is in MetricsTypeTabs) */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2 text-sm">
          {renderTrendIcon()}
          <span className="text-muted-foreground">
            3-Year Trend: <span className="text-foreground font-medium">{trendInfo.label}</span>
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={`${baseYear} Total Campers`}
          value={latestTransition?.base_count ?? 0}
          subtitle={selectedSessionCmId ? 'In selected session' : 'Enrolled campers in base year'}
        />
        <MetricCard
          title={`${currentYear} Total Campers`}
          value={detailedData?.compare_year_total ?? 0}
          subtitle="Enrolled campers in current year"
        />
        <MetricCard
          title="Returned Campers"
          value={latestTransition?.returned_count ?? 0}
          subtitle={`From ${baseYear} to ${currentYear}`}
        />
        <MetricCard
          title="Avg Retention Rate"
          value={`${Math.round(trendsData.avg_retention_rate * 100)}%`}
          subtitle="Average across 3-year period"
          trend={trendsData.avg_retention_rate >= 0.5 ? 'up' : 'down'}
          trendValue={trendsData.avg_retention_rate >= 0.5 ? 'Good' : 'Low'}
        />
      </div>

      {/* Trend Charts Row 1 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RetentionRateLine
          data={trendsData.years}
          title="Overall Retention Rate Trend"
          height={250}
        />
        {trendsData.enrollment_by_year && trendsData.enrollment_by_year.length > 0 && (
          <GenderStackedChart
            data={trendsData.enrollment_by_year}
            title="Gender Composition (3-Year Comparison)"
            height={250}
          />
        )}
      </div>

      {/* Trend Charts Row 2 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {trendsData.enrollment_by_year && trendsData.enrollment_by_year.length > 0 && (
          <GradeEnrollmentChart
            data={trendsData.enrollment_by_year}
            title="Enrollment by Grade (3-Year Comparison)"
            height={300}
          />
        )}
        <BreakdownChart
          title={`Retention by Session (${baseYear}→${currentYear})`}
          data={sessionChartData}
          type="bar"
          height={300}
          breakdownType="session"
          onSegmentClick={setFilter}
        />
      </div>

      {/* Cohort Analysis Charts */}
      {(summerYearsChartData.length > 0 ||
        firstSummerYearChartData.length > 0 ||
        priorSessionChartData.length > 0) && (
        <div className="mt-8">
          <h2 className="text-foreground mb-4 text-lg font-semibold">Cohort Analysis</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {summerYearsChartData.length > 0 && (
              <BreakdownChart
                title="Retention by Summers Enrolled"
                data={summerYearsChartData}
                type="bar"
                height={250}
                breakdownType="years_at_camp"
                onSegmentClick={setFilter}
              />
            )}
            {firstSummerYearChartData.length > 0 && (
              <BreakdownChart
                title="Retention by First Summer Year"
                data={firstSummerYearChartData}
                type="bar"
                height={250}
                breakdownType="years_at_camp"
                onSegmentClick={setFilter}
              />
            )}
            {priorSessionChartData.length > 0 && (
              <BreakdownChart
                title={`Retention by ${baseYear - 1} Session`}
                data={priorSessionChartData}
                type="bar"
                height={250}
                breakdownType="session"
                onSegmentClick={setFilter}
              />
            )}
          </div>
        </div>
      )}

      {/* Detailed Session Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-sm font-semibold">
            Retention Details by Session ({baseYear}→{currentYear})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Session</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  {baseYear} Count
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Returned</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Retention Rate
                </th>
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
                  <td className="text-foreground px-4 py-3 text-right">{session.base_count}</td>
                  <td className="text-foreground px-4 py-3 text-right">{session.returned_count}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        session.retention_rate >= 0.5
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {(session.retention_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demographic Tables */}
      {(schoolTableData.length > 0 ||
        cityTableData.length > 0 ||
        synagogueTableData.length > 0) && (
        <div className="mt-8">
          <h2 className="text-foreground mb-4 text-lg font-semibold">Demographics</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Full demographic data for data quality review. Search and sort to find patterns.
          </p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <DemographicTable title="School" data={schoolTableData} />
            <DemographicTable title="City" data={cityTableData} />
            <DemographicTable title="Synagogue" data={synagogueTableData} />
          </div>
        </div>
      )}

      {/* Drill-down Modal */}
      <DrilldownModal />
    </div>
  )
}
