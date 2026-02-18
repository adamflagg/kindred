/**
 * RetentionOverview - Pure returning analysis for prior year → current year.
 *
 * Shows:
 * - Summary cards (prior year total, returned, did not return, overall rate)
 * - Retention rate bar charts for all CEO-requested breakdowns
 * - Geographic retention (city, school, synagogue) inline
 */

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { RetentionRateBarChart } from '../../../components/metrics/RetentionRateBarChart'
import {
  genderToBarData,
  gradeToBarData,
  sessionToBarData,
  cityToBarData,
  schoolToBarData,
  synagogueToBarData,
  yearsAtCampToBarData,
  summerYearsToBarData,
  firstSummerYearToBarData,
  sessionBunkToBarData,
  priorSessionToBarData,
} from '../../../utils/retentionTransforms'
import { Loader2, AlertCircle } from 'lucide-react'

export default function RetentionOverview() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam } = useMetricsSession()

  const priorYear = currentYear - 1

  const { data, isLoading, error } = useRetentionMetrics(
    priorYear,
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading retention data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load retention data: {error.message}</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No retention data available
      </div>
    )
  }

  const didNotReturn = data.base_year_total - data.returned_count

  // Transform all breakdowns to bar chart data
  const genderBars = genderToBarData(data.by_gender)
  const gradeBars = gradeToBarData(data.by_grade)
  const sessionBars = sessionToBarData(data.by_session)
  const yearsAtCampBars = yearsAtCampToBarData(data.by_years_at_camp)
  const summerYearsBars = summerYearsToBarData(data.by_summer_years)
  const firstSummerYearBars = firstSummerYearToBarData(data.by_first_summer_year)
  const priorSessionBars = priorSessionToBarData(data.by_prior_session)
  const sessionBunkBars = sessionBunkToBarData(data.by_session_bunk)
  const cityBars = cityToBarData(data.by_city)
  const schoolBars = schoolToBarData(data.by_school)
  const synagogueBars = synagogueToBarData(data.by_synagogue)

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={`${priorYear} Total Campers`}
          value={data.base_year_total}
          subtitle="Enrolled in prior year"
        />
        <MetricCard
          title={`Returned to ${currentYear}`}
          value={data.returned_count}
          subtitle={`${Math.round(data.overall_retention_rate * 100)}% retention rate`}
        />
        <MetricCard
          title="Did Not Return"
          value={didNotReturn}
          subtitle={`${data.base_year_total > 0 ? Math.round((didNotReturn / data.base_year_total) * 100) : 0}% attrition`}
        />
        <MetricCard
          title="Overall Retention Rate"
          value={`${Math.round(data.overall_retention_rate * 100)}%`}
          subtitle={`${priorYear} → ${currentYear}`}
          trend={data.overall_retention_rate >= 0.5 ? 'up' : 'down'}
          trendValue={data.overall_retention_rate >= 0.5 ? 'Good' : 'Low'}
        />
      </div>

      {/* Row 1: Gender + Grade */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {genderBars.length > 0 && (
          <RetentionRateBarChart data={genderBars} title="Retention by Gender" />
        )}
        {gradeBars.length > 0 && (
          <RetentionRateBarChart data={gradeBars} title="Retention by Grade" sortBy="name" />
        )}
      </div>

      {/* Row 2: Session + Prior Session */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {sessionBars.length > 0 && (
          <RetentionRateBarChart
            data={sessionBars}
            title={`Retention by ${currentYear} Session`}
          />
        )}
        {priorSessionBars.length > 0 && (
          <RetentionRateBarChart
            data={priorSessionBars}
            title={`Retention by ${priorYear} Session`}
          />
        )}
      </div>

      {/* Row 3: Session+Bunk (top 15) */}
      {sessionBunkBars.length > 0 && (
        <RetentionRateBarChart
          data={sessionBunkBars}
          title={`Retention by ${priorYear} Session + Bunk (Top 15)`}
          topN={15}
          sortBy="count"
        />
      )}

      {/* Row 4: Years at Camp + Summers at Camp */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {yearsAtCampBars.length > 0 && (
          <RetentionRateBarChart
            data={yearsAtCampBars}
            title="Retention by Years at Camp"
            sortBy="name"
          />
        )}
        {summerYearsBars.length > 0 && (
          <RetentionRateBarChart
            data={summerYearsBars}
            title="Retention by Summers at Camp"
            sortBy="name"
          />
        )}
      </div>

      {/* Row 5: First Summer Year */}
      {firstSummerYearBars.length > 0 && (
        <RetentionRateBarChart
          data={firstSummerYearBars}
          title="Retention by First Summer Year"
          sortBy="name"
        />
      )}

      {/* ─── Geographic Retention ─── */}
      <div className="border-border relative my-8 border-t pt-6">
        <span className="bg-background text-muted-foreground absolute -top-3 left-4 px-2 text-xs font-medium tracking-wide uppercase">
          Geographic Retention
        </span>
      </div>

      {/* Row 6: City + School */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {cityBars.length > 0 && (
          <RetentionRateBarChart
            data={cityBars}
            title="Retention by City (Top 15)"
            topN={15}
            sortBy="count"
          />
        )}
        {schoolBars.length > 0 && (
          <RetentionRateBarChart
            data={schoolBars}
            title="Retention by School (Top 15)"
            topN={15}
            sortBy="count"
          />
        )}
      </div>

      {/* Row 7: Synagogue */}
      {synagogueBars.length > 0 && (
        <RetentionRateBarChart
          data={synagogueBars}
          title="Retention by Synagogue (Top 15)"
          topN={15}
          sortBy="count"
        />
      )}
    </div>
  )
}
