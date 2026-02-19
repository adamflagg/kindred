/**
 * TrendsOverview - Display historical trends across multiple years.
 *
 * Shows:
 * - Multi-year enrollment analysis (default: last 5 years)
 * - Total enrollment over time
 * - New vs returning camper trends
 * - Gender distribution over time
 * - Year-by-year summary table
 * - Retention rate trend line (from retention-trends endpoint)
 * - Enrollment composition: gender, grade, summers at camp, first summer year
 * - Geographic distribution: city, school, synagogue (top 15 per category)
 */

import { useMemo } from 'react'
import { useHistoricalTrends } from '../../../hooks/useMetrics'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { TrendLineChart } from '../../../components/metrics/TrendLineChart'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { RetentionRateLine } from '../../../components/metrics/RetentionRateLine'
import { GenderStackedChart } from '../../../components/metrics/GenderStackedChart'
import { GradeEnrollmentChart } from '../../../components/metrics/GradeEnrollmentChart'
import { MultiYearBreakdownChart } from '../../../components/metrics/MultiYearBreakdownChart'
import { SectionHeader } from '../../../components/metrics/SectionHeader'
import { Loader2, AlertCircle, PieChart, Globe } from 'lucide-react'

export default function TrendsOverview() {
  const { selectedSessionCmId, sessionTypesParam, expandedRetention } = useMetricsSession()
  const { currentYear } = useCurrentYear()

  const numYearsDisplay = expandedRetention ? 5 : 3

  // Build explicit years param from currentYear context (defense in depth)
  const yearsParam = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => currentYear - 4 + i).join(',')
  }, [currentYear])

  // Historical trends (enrollment, new vs returning, gender lines)
  const { data, isLoading, error } = useHistoricalTrends(
    yearsParam,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  // Always fetch 5 years of retention trends for caching; slice when toggling
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
  } = useRetentionTrends(currentYear, {
    numYears: 5,
    sessionTypes: sessionTypesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
  })

  // Slice enrollment data based on expanded toggle (3 or 5 years)
  const enrollmentData = useMemo(() => {
    return (trendsData?.enrollment_by_year ?? []).slice(-numYearsDisplay)
  }, [trendsData?.enrollment_by_year, numYearsDisplay])

  // Slice retention rate years to match display count
  const retentionYears = useMemo(() => {
    return (trendsData?.years ?? []).slice(-numYearsDisplay)
  }, [trendsData?.years, numYearsDisplay])

  if (isLoading || trendsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading historical trends...</span>
      </div>
    )
  }

  if (error || trendsError) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load historical data: {(error ?? trendsError)?.message}</span>
      </div>
    )
  }

  if (!data || data.years.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No historical data available. Run camper-history sync for previous years.
      </div>
    )
  }

  // Calculate summary metrics
  const latestYear = data.years[data.years.length - 1]
  const earliestYear = data.years[0]

  const totalChange =
    latestYear && earliestYear ? latestYear.total_enrolled - earliestYear.total_enrolled : 0

  const percentChange =
    earliestYear && earliestYear.total_enrolled > 0
      ? ((totalChange / earliestYear.total_enrolled) * 100).toFixed(1)
      : '0'

  const avgGrowth = data.years.length > 1 ? (totalChange / (data.years.length - 1)).toFixed(0) : '0'

  const summerYearsFormatter = (key: string | number) => {
    const val = String(key)
    return val === '1' ? '1 Summer' : `${val} Summers`
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Years Analyzed"
          value={data.years.length}
          subtitle={`${earliestYear?.year ?? '?'} - ${latestYear?.year ?? '?'}`}
        />
        <MetricCard
          title="Latest Enrollment"
          value={latestYear?.total_enrolled.toLocaleString() ?? 0}
          subtitle={`${latestYear?.year ?? ''} total campers`}
        />
        <MetricCard
          title="Total Change"
          value={totalChange > 0 ? `+${totalChange}` : totalChange.toString()}
          subtitle={`${percentChange}% over ${data.years.length} years`}
          trend={totalChange > 0 ? 'up' : totalChange < 0 ? 'down' : 'neutral'}
          trendValue={`${percentChange}%`}
        />
        <MetricCard
          title="Avg. Annual Growth"
          value={Number(avgGrowth) > 0 ? `+${avgGrowth}` : avgGrowth}
          subtitle="Campers per year"
          trend={Number(avgGrowth) > 0 ? 'up' : Number(avgGrowth) < 0 ? 'down' : 'neutral'}
        />
      </div>

      {/* Line Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TrendLineChart
          title="Total Enrollment Over Time"
          data={data.years}
          metric="total"
          height={300}
        />
        <TrendLineChart
          title="New vs Returning Campers"
          data={data.years}
          metric="new_vs_returning"
          height={300}
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <TrendLineChart
          title="Enrollment by Gender"
          data={data.years}
          metric="gender"
          height={300}
        />
      </div>

      {/* Data Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">Year-by-Year Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Year</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Total</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">New</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Returning
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">New %</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Male</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Female</th>
              </tr>
            </thead>
            <tbody>
              {data.years.map((year) => {
                const maleCount = year.by_gender.find((g) => g.gender === 'M')?.count ?? 0
                const femaleCount = year.by_gender.find((g) => g.gender === 'F')?.count ?? 0
                return (
                  <tr
                    key={year.year}
                    className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                  >
                    <td className="text-foreground px-4 py-3 font-medium">{year.year}</td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {year.total_enrolled.toLocaleString()}
                    </td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {year.new_vs_returning.new_count.toLocaleString()}
                    </td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {year.new_vs_returning.returning_count.toLocaleString()}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-right">
                      {year.new_vs_returning.new_percentage.toFixed(1)}%
                    </td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {maleCount.toLocaleString()}
                    </td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {femaleCount.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Enrollment Composition (from retention-trends endpoint) ─── */}
      <SectionHeader
        icon={PieChart}
        title="Enrollment Composition"
        description={`Gender, grade, and tenure trends over ${numYearsDisplay} years`}
      />

      {/* Retention Rate Trend Line */}
      {retentionYears.length > 0 && (
        <RetentionRateLine
          data={retentionYears}
          title="Overall Retention Rate Trend"
          height={250}
        />
      )}

      {/* Gender Composition */}
      {enrollmentData.length > 0 && (
        <GenderStackedChart
          data={enrollmentData}
          title={`Gender Composition (${numYearsDisplay}-Year Comparison)`}
          height={250}
        />
      )}

      {/* Grade Enrollment */}
      {enrollmentData.length > 0 && (
        <GradeEnrollmentChart
          data={enrollmentData}
          title={`Enrollment by Grade (${numYearsDisplay}-Year Comparison)`}
          height={300}
        />
      )}

      {/* Summers at Camp */}
      {enrollmentData.length > 0 && (
        <MultiYearBreakdownChart
          data={enrollmentData}
          breakdownKey="by_summer_years"
          labelKey="summer_years"
          title={`Summers at Camp (${numYearsDisplay}-Year Comparison)`}
          nameFormatter={summerYearsFormatter}
          invertAxes
          height={300}
        />
      )}

      {/* First Summer Year */}
      {enrollmentData.length > 0 && (
        <MultiYearBreakdownChart
          data={enrollmentData}
          breakdownKey="by_first_summer_year"
          labelKey="first_summer_year"
          title={`First Summer Year (${numYearsDisplay}-Year Comparison)`}
          invertAxes
          height={300}
        />
      )}

      {/* ─── Geographic Distribution (from retention-trends endpoint) ─── */}
      <SectionHeader
        icon={Globe}
        title="Geographic Distribution"
        description={`City, school, and synagogue trends over ${numYearsDisplay} years`}
      />

      {/* City Distribution */}
      {enrollmentData.some((y) => (y.by_city?.length ?? 0) > 0) && (
        <MultiYearBreakdownChart
          data={enrollmentData}
          breakdownKey="by_city"
          labelKey="city"
          title={`City Distribution (Top 15, ${numYearsDisplay}-Year Comparison)`}
          topN={15}
          height={350}
        />
      )}

      {/* School Distribution */}
      {enrollmentData.some((y) => (y.by_school?.length ?? 0) > 0) && (
        <MultiYearBreakdownChart
          data={enrollmentData}
          breakdownKey="by_school"
          labelKey="school"
          title={`School Distribution (Top 15, ${numYearsDisplay}-Year Comparison)`}
          topN={15}
          height={350}
        />
      )}

      {/* Synagogue Distribution */}
      {enrollmentData.some((y) => (y.by_synagogue?.length ?? 0) > 0) && (
        <MultiYearBreakdownChart
          data={enrollmentData}
          breakdownKey="by_synagogue"
          labelKey="synagogue"
          title={`Synagogue Distribution (Top 15, ${numYearsDisplay}-Year Comparison)`}
          topN={15}
          height={350}
        />
      )}
    </div>
  )
}
