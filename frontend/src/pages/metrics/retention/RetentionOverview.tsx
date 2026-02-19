/**
 * RetentionOverview - Pure returning analysis for prior year → current year.
 *
 * Shows:
 * - Summary cards (prior year total, returned, did not return, overall rate)
 * - Retention rate bar charts for all CEO-requested breakdowns
 * - Geographic retention (city, school, synagogue)
 */

import { useMemo, useCallback } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useDrilldown } from '../../../hooks/useDrilldown'
import { MetricCard } from '../../../components/metrics/MetricCard'
import {
  RetentionRateBarChart,
  type RetentionRateBarItem,
} from '../../../components/metrics/RetentionRateBarChart'
import { RetentionRateLineChart } from '../../../components/metrics/RetentionRateLineChart'
import {
  genderToBarData,
  gradeToBarData,
  sessionToBarData,
  cityToBarData,
  schoolToBarData,
  synagogueToBarData,
  summerYearsToBarData,
  firstSummerYearToBarData,
  computeRetentionOutliers,
} from '../../../utils/retentionTransforms'
import { buildSessionDateLookup, sortSessionDataByDate } from '../../../utils/sessionUtils'
import { RetentionNotableOutliers } from '../../../components/metrics/RetentionNotableOutliers'
import { SectionDivider } from '../../../components/metrics/SectionDivider'
import type { DrilldownFilter } from '../../../types/metrics'
import { Loader2, AlertCircle } from 'lucide-react'

export default function RetentionOverview() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessions, sessionTypesParam } = useMetricsSession()

  const priorYear = currentYear - 1

  // Build date lookup for chronological session sorting (must be before early returns)
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(sessions), [sessions])

  const sessionTypes = useMemo(() => sessionTypesParam?.split(',') ?? [], [sessionTypesParam])
  const { setFilter, DrilldownModal } = useDrilldown({
    year: priorYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes,
    statusFilter: ['enrolled'],
  })

  const makeRetentionFilter = useCallback(
    (
      type: DrilldownFilter['type'],
      item: RetentionRateBarItem,
      labelPrefix?: string
    ): DrilldownFilter => ({
      type,
      value: item.id !== undefined ? String(item.id) : item.name,
      label: labelPrefix ? `${labelPrefix}${item.name}` : item.name,
      retentionContext: { baseYear: priorYear, compareYear: currentYear },
    }),
    [priorYear, currentYear]
  )

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

  // Pre-sort session data chronologically before converting to bar data
  const genderBars = genderToBarData(data.by_gender)
  const gradeBars = gradeToBarData(data.by_grade)
  const sessionBars = sessionToBarData(
    sortSessionDataByDate(data.by_session ?? [], sessionDateLookup)
  )
  const summerYearsBars = summerYearsToBarData(data.by_summer_years)
  const firstSummerYearBars = firstSummerYearToBarData(data.by_first_summer_year)
  const cityBars = cityToBarData(data.by_city)
  const schoolBars = schoolToBarData(data.by_school)
  const synagogueBars = synagogueToBarData(data.by_synagogue)

  const cityOutliers = computeRetentionOutliers(cityBars, data.overall_retention_rate)
  const schoolOutliers = computeRetentionOutliers(schoolBars, data.overall_retention_rate)
  const synagogueOutliers = computeRetentionOutliers(synagogueBars, data.overall_retention_rate)

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

      <SectionDivider label="Camper Demographics" />

      {/* Row 1: Gender + Grade side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {genderBars.length > 0 && (
          <RetentionRateBarChart
            data={genderBars}
            title="Retention by Gender"
            onBarClick={(item) => setFilter(makeRetentionFilter('gender', item))}
          />
        )}
        {gradeBars.length > 0 && (
          <RetentionRateLineChart
            data={gradeBars}
            title="Retention by Grade"
            tooltipLabelPrefix="Grade "
            onDotClick={(item) => setFilter(makeRetentionFilter('grade', item, 'Grade '))}
          />
        )}
      </div>

      <SectionDivider label="Session Analysis" />

      {/* Row 2: Current Year Session */}
      {sessionBars.length > 0 && (
        <RetentionRateBarChart
          data={sessionBars}
          title={`Retention by ${currentYear} Session`}
          sortBy="none"
          layout="vertical"
          onBarClick={(item) => setFilter(makeRetentionFilter('retention_session', item))}
        />
      )}

      <SectionDivider label="Camper Tenure" />

      {/* Row 3: Summers at Camp + First Summer Year side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {summerYearsBars.length > 0 && (
          <RetentionRateLineChart
            data={summerYearsBars}
            title="Retention by Summers at Camp"
            onDotClick={(item) => setFilter(makeRetentionFilter('summer_years', item))}
          />
        )}
        {firstSummerYearBars.length > 0 && (
          <RetentionRateLineChart
            data={firstSummerYearBars}
            title="Retention by First Summer Year"
            onDotClick={(item) => setFilter(makeRetentionFilter('first_summer_year', item))}
          />
        )}
      </div>

      <SectionDivider label="Geographic Retention" />

      {/* Row 5: City + School */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {cityBars.length > 0 && (
          <RetentionRateBarChart
            data={cityBars}
            title="Retention by City (Top 15)"
            topN={15}
            sortBy="count"
            showCounts
            onBarClick={(item) => setFilter(makeRetentionFilter('city', item))}
          />
        )}
        {schoolBars.length > 0 && (
          <RetentionRateBarChart
            data={schoolBars}
            title="Retention by School (Top 15)"
            topN={15}
            sortBy="count"
            showCounts
            onBarClick={(item) => setFilter(makeRetentionFilter('school', item))}
          />
        )}
      </div>

      {/* Row 6: Synagogue */}
      {synagogueBars.length > 0 && (
        <RetentionRateBarChart
          data={synagogueBars}
          title="Retention by Synagogue (Top 15)"
          topN={15}
          sortBy="count"
          showCounts
          onBarClick={(item) => setFilter(makeRetentionFilter('synagogue', item))}
        />
      )}

      {/* Notable Outliers */}
      <RetentionNotableOutliers
        cityOutliers={cityOutliers}
        schoolOutliers={schoolOutliers}
        synagogueOutliers={synagogueOutliers}
      />

      {/* Drilldown Modal */}
      <DrilldownModal />
    </div>
  )
}
