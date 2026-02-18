/**
 * RetentionOverview - Multi-year enrollment comparison for retention.
 *
 * Shows:
 * - Summary cards (base count, current count, returned, avg rate)
 * - Multi-year trend charts (retention rate, gender, grade, summers, first year)
 * - Legacy session retention table below a divider
 */

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { RetentionRateLine } from '../../../components/metrics/RetentionRateLine'
import { GenderStackedChart } from '../../../components/metrics/GenderStackedChart'
import { GradeEnrollmentChart } from '../../../components/metrics/GradeEnrollmentChart'
import { MultiYearBreakdownChart } from '../../../components/metrics/MultiYearBreakdownChart'
import { getSessionChartLabel } from '../../../utils/sessionDisplay'
import { buildSessionDateLookup, sortSessionDataByDate } from '../../../utils/sessionUtils'
import { getTrendDirection } from '../../../utils/metricsTransforms'
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react'

export default function RetentionOverview() {
  const { currentYear } = useCurrentYear()

  // Get session filter and expanded toggle from context
  const {
    selectedSessionCmId,
    sessions,
    sessionTypesParam,
    activeSessionTypes,
    expandedRetention,
  } = useMetricsSession()

  const numYears = expandedRetention ? 5 : 3

  // Calculate prior year for the primary view
  const priorYear = currentYear - 1

  // Drilldown state management (uses priorYear since retention shows who from priorYear returned)
  const { DrilldownModal } = useDrilldown({
    year: priorYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: [...activeSessionTypes],
    statusFilter: ['enrolled'],
  })

  // Build session date lookup for date-aware sorting
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])

  // Fetch multi-year retention trends (3 or 5 years)
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
  } = useRetentionTrends(currentYear, {
    numYears,
    sessionTypes: sessionTypesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
  })

  // Detailed retention data for session table
  const { data: detailedData } = useRetentionMetrics(
    priorYear,
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

  // Sorted sessions for legacy table
  const sortedBySession = sortSessionDataByDate(detailedData?.by_session ?? [], sessionDateLookup)

  const enrollmentData = trendsData.enrollment_by_year ?? []

  // Source year totals from enrollment data (already correctly filtered by session)
  const currentYearEnrollment = enrollmentData.find((e) => e.year === currentYear)
  const priorYearEnrollment = enrollmentData.find((e) => e.year === priorYear)

  const summerYearsFormatter = (key: string | number) => {
    const val = String(key)
    return val === '1' ? '1 Summer' : `${val} Summers`
  }

  return (
    <div className="space-y-6">
      {/* Trend indicator */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2 text-sm">
          {renderTrendIcon()}
          <span className="text-muted-foreground">
            {numYears}-Year Trend:{' '}
            <span className="text-foreground font-medium">{trendInfo.label}</span>
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={`${currentYear} Total Campers`}
          value={currentYearEnrollment?.total ?? 0}
          subtitle={
            selectedSessionCmId ? 'In selected session' : 'Enrolled campers in current year'
          }
        />
        <MetricCard
          title={`${priorYear} Total Campers`}
          value={priorYearEnrollment?.total ?? 0}
          subtitle="Enrolled campers in prior year"
        />
        <MetricCard
          title="Returned Campers"
          value={latestTransition?.returned_count ?? 0}
          subtitle={`From ${priorYear} to ${currentYear}`}
        />
        <MetricCard
          title="Avg Retention Rate"
          value={`${Math.round(trendsData.avg_retention_rate * 100)}%`}
          subtitle={`Average across ${numYears}-year period`}
          trend={trendsData.avg_retention_rate >= 0.5 ? 'up' : 'down'}
          trendValue={trendsData.avg_retention_rate >= 0.5 ? 'Good' : 'Low'}
        />
      </div>

      {/* Row 1: Retention Rate + Gender Composition */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RetentionRateLine
          data={trendsData.years}
          title="Overall Retention Rate Trend"
          height={250}
        />
        {enrollmentData.length > 0 && (
          <GenderStackedChart
            data={enrollmentData}
            title={`Gender Composition (${numYears}-Year Comparison)`}
            height={250}
          />
        )}
      </div>

      {/* Row 2: Grade Enrollment + Summers at Camp */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {enrollmentData.length > 0 && (
          <GradeEnrollmentChart
            data={enrollmentData}
            title={`Enrollment by Grade (${numYears}-Year Comparison)`}
            height={300}
          />
        )}
        {enrollmentData.length > 0 && (
          <MultiYearBreakdownChart
            data={enrollmentData}
            breakdownKey="by_summer_years"
            labelKey="summer_years"
            title={`Summers at Camp (${numYears}-Year Comparison)`}
            nameFormatter={summerYearsFormatter}
            height={300}
          />
        )}
      </div>

      {/* Row 3: First Summer Year */}
      {enrollmentData.length > 0 && (
        <MultiYearBreakdownChart
          data={enrollmentData}
          breakdownKey="by_first_summer_year"
          labelKey="first_summer_year"
          title={`First Summer Year (${numYears}-Year Comparison)`}
          height={300}
        />
      )}

      {/* ─── Legacy Retention Data (for comparison) ─── */}
      <div className="border-border relative my-8 border-t pt-6">
        <span className="bg-background text-muted-foreground absolute -top-3 left-4 px-2 text-xs font-medium tracking-wide uppercase">
          Legacy Retention Data (for comparison)
        </span>
      </div>

      {/* Session Details Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-sm font-semibold">
            Retention Details by Session ({priorYear}&rarr;{currentYear})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Session</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  {priorYear} Count
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

      {/* Drill-down Modal */}
      <DrilldownModal />
    </div>
  )
}
