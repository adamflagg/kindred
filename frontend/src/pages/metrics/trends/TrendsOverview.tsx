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
import { CssVerticalStackedBarChart } from '../../../components/metrics/CssVerticalStackedBarChart'
import { CssVerticalGroupedBarChart } from '../../../components/metrics/CssVerticalGroupedBarChart'
import { Loader2, AlertCircle } from 'lucide-react'
import { aggregateCityEnrollmentByRegion, REGION_DISPLAY_NAMES } from '../../../utils/regionUtils'
import { getYearColor, YEAR_PALETTE } from '../../../utils/yearColors'
import { trendDirection } from '../../../utils/trendDirection'
import type { YearEnrollment } from '../../../types/metrics'

interface GroupedChartItem {
  name: string
  [key: string]: string | number | null
}

/**
 * Build grouped bar chart data from YearEnrollment breakdown fields.
 *
 * Normal mode: categories on X-axis, years as grouped bars.
 * Inverted mode: years on X-axis, categories as grouped bars.
 */
function buildGroupedChartData(
  data: YearEnrollment[],
  breakdownKey: string,
  labelKey: string,
  topN: number,
  nameFormatter?: (key: string | number) => string,
  invertAxes?: boolean,
  sortCategories?: 'asc' | 'desc'
): {
  chartData: GroupedChartItem[]
  series: Array<{ key: string; label: string; color: string }>
} {
  const years = data.map((y) => y.year).sort((a, b) => a - b)
  const maxYear = Math.max(...years)

  // Access breakdown arrays via unknown cast to avoid strict type narrowing
  const getBreakdown = (yearData: YearEnrollment): Array<Record<string, unknown>> | undefined =>
    (yearData as unknown as Record<string, unknown>)[breakdownKey] as
      | Array<Record<string, unknown>>
      | undefined

  // Collect all categories and their totals
  const categoryTotals = new Map<string, number>()
  for (const yearData of data) {
    const breakdown = getBreakdown(yearData)
    if (!breakdown) continue
    for (const item of breakdown) {
      const rawKey = item[labelKey]
      const key = rawKey != null ? String(rawKey) : ''
      if (!key) continue
      const rawCount = item['count']
      const count = typeof rawCount === 'number' ? rawCount : 0
      categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + count)
    }
  }

  let topCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key]) => key)

  if (sortCategories) {
    const dir = sortCategories === 'asc' ? 1 : -1
    topCategories = topCategories.sort(
      (a, b) => dir * a.localeCompare(b, undefined, { numeric: true })
    )
  }

  if (invertAxes) {
    // Years on X-axis, categories as series
    const categoryDisplayNames = topCategories.map((key) =>
      nameFormatter ? nameFormatter(key) : key
    )
    const chartData: GroupedChartItem[] = years.map((year) => {
      const yearData = data.find((y) => y.year === year)
      const breakdown = yearData ? getBreakdown(yearData) : undefined
      const item: GroupedChartItem = { name: String(year) }
      topCategories.forEach((key, idx) => {
        const match = breakdown?.find((b) => String(b[labelKey]) === key)
        const rawCount = match?.['count']
        item[categoryDisplayNames[idx] ?? ''] = typeof rawCount === 'number' ? rawCount : 0
      })
      return item
    })
    const categorySeries = categoryDisplayNames.map((name, i) => ({
      key: name,
      label: name,
      color: YEAR_PALETTE[i % YEAR_PALETTE.length] ?? 'hsl(0, 0%, 50%)',
    }))
    return { chartData, series: categorySeries }
  }

  // Normal: categories on X-axis, years as series
  const chartData: GroupedChartItem[] = topCategories.map((key) => {
    const displayName = nameFormatter ? nameFormatter(key) : key
    const item: GroupedChartItem = { name: displayName }
    for (const yearData of data) {
      const breakdown = getBreakdown(yearData)
      const match = breakdown?.find((b) => String(b[labelKey]) === key)
      const rawCount = match?.['count']
      item[String(yearData.year)] = typeof rawCount === 'number' ? rawCount : 0
    }
    return item
  })
  const yearSeries = years.map((y) => ({
    key: String(y),
    label: String(y),
    color: getYearColor(y, maxYear),
  }))
  return { chartData, series: yearSeries }
}

export default function TrendsOverview() {
  const {
    expandedRetention,
    filterOptions,
    includeTeenPipeline,
    setIncludeTeenPipeline,
    scopeHasTeens,
  } = useMetricsSession()
  const { currentYear } = useCurrentYear()

  const numYearsDisplay = expandedRetention ? 5 : 3

  // Build explicit years param from currentYear context (defense in depth)
  const yearsParam = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => currentYear - 4 + i).join(',')
  }, [currentYear])

  // Historical trends (enrollment, new vs returning, gender lines)
  const { data, isLoading, error } = useHistoricalTrends({
    ...filterOptions,
    years: yearsParam,
  })

  // Always fetch 5 years of retention trends for caching; slice when toggling
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
  } = useRetentionTrends(currentYear, {
    numYears: 5,
    ...filterOptions,
    includeTeenPipeline,
  })

  // Slice enrollment data based on expanded toggle (3 or 5 years)
  const enrollmentData = useMemo(() => {
    return (trendsData?.enrollment_by_year ?? []).slice(-numYearsDisplay)
  }, [trendsData?.enrollment_by_year, numYearsDisplay])

  // Augment enrollment data with by_region computed from by_city
  const enrollmentDataWithRegions = useMemo(() => {
    return enrollmentData.map((yearData) => ({
      ...yearData,
      by_region: aggregateCityEnrollmentByRegion(yearData.by_city ?? []),
    }))
  }, [enrollmentData])

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
  const latestYear = data.years.at(-1)
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
      <div
        data-tour="trends-summary"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
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
          trend={trendDirection(totalChange)}
          trendValue={`${percentChange}%`}
        />
        <MetricCard
          title="Avg. Annual Growth"
          value={Number(avgGrowth) > 0 ? `+${avgGrowth}` : avgGrowth}
          subtitle="Campers per year"
          trend={trendDirection(avgGrowth)}
        />
      </div>

      {/* Line Charts */}
      <div data-tour="trends-charts" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TrendLineChart
          title="Enrollment by Gender"
          data={data.years}
          metric="gender"
          height={300}
        />
        {enrollmentData.length > 0 && (
          <CssVerticalStackedBarChart
            data={enrollmentData.map((y) => {
              const male = y.by_gender.find((g) => g.gender === 'M')?.count ?? 0
              const female = y.by_gender.find((g) => g.gender === 'F')?.count ?? 0
              return { name: String(y.year), total: male + female, male, female }
            })}
            segments={[
              { key: 'female', label: 'Female', color: 'hsl(340, 70%, 50%)' },
              { key: 'male', label: 'Male', color: 'hsl(200, 70%, 50%)' },
            ]}
            title={`Gender Composition (${numYearsDisplay}-Year Comparison)`}
            percentMode
            height={300}
            maxColumnWidth={60}
          />
        )}
      </div>

      {/* Data Table */}
      <div data-tour="trends-table" className="card-lodge overflow-hidden">
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
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Cancelled
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Cancel %</th>
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
                    <td className="text-foreground px-4 py-3 text-right">
                      {(year.total_cancelled ?? 0).toLocaleString()}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-right">
                      {(year.cancellation_rate ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Retention Rate + Cancellation Rate side-by-side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {retentionYears.length > 0 && (
          <RetentionRateLine
            data={retentionYears}
            title="Overall Retention Rate Trend"
            height={250}
            headerRight={
              scopeHasTeens ? (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={includeTeenPipeline}
                    onChange={(e) => setIncludeTeenPipeline(e.target.checked)}
                    className="accent-primary h-3.5 w-3.5 rounded"
                  />
                  <span className="text-muted-foreground">Camp → Teen</span>
                </label>
              ) : undefined
            }
          />
        )}
        {data.years.some((y) => (y.total_cancelled ?? 0) > 0) && (
          <TrendLineChart
            title="Cancellation Rate Over Time"
            data={data.years}
            metric="cancellation_rate"
            height={250}
          />
        )}
      </div>

      {/* Grade Enrollment */}
      {enrollmentData.length > 0 &&
        (() => {
          const gradeSet = new Set<number | null>()
          for (const y of enrollmentData) {
            for (const g of y.by_grade) gradeSet.add(g.grade)
          }
          const sortedGrades = Array.from(gradeSet).sort((a, b) => {
            if (a === null) return 1
            if (b === null) return -1
            return a - b
          })

          const years = enrollmentData.map((y) => y.year).sort((a, b) => a - b)
          const maxYear = Math.max(...years)

          const gradeData: GroupedChartItem[] = sortedGrades.map((grade) => {
            const item: GroupedChartItem = {
              name: grade !== null ? `Grade ${grade}` : 'Unknown',
            }
            for (const yearData of enrollmentData) {
              const gd = yearData.by_grade.find((g) => g.grade === grade)
              item[String(yearData.year)] = gd?.count ?? 0
            }
            return item
          })

          const yearSeries = years.map((y) => ({
            key: String(y),
            label: String(y),
            color: getYearColor(y, maxYear),
          }))

          return (
            <CssVerticalGroupedBarChart
              data={gradeData}
              series={yearSeries}
              title={`Enrollment by Grade (${numYearsDisplay}-Year Comparison)`}
              height={300}
              rotateLabels={false}
              groupGap={numYearsDisplay === 3 ? 24 : 20}
              barWidthPercent={numYearsDisplay === 3 ? 30 : 55}
            />
          )
        })()}

      {/* Summers at Camp */}
      {enrollmentData.length > 0 &&
        (() => {
          const { chartData, series } = buildGroupedChartData(
            enrollmentData,
            'by_summer_years',
            'summer_years',
            15,
            summerYearsFormatter,
            true
          )
          if (chartData.length === 0) return null
          return (
            <CssVerticalGroupedBarChart
              data={chartData}
              series={series}
              title={`Summers at Camp (${numYearsDisplay}-Year Comparison)`}
              height={300}
              maxColumnWidth={numYearsDisplay === 3 ? 300 : 160}
              groupGap={numYearsDisplay === 3 ? 48 : 32}
            />
          )
        })()}

      {/* First Summer Year */}
      {enrollmentData.length > 0 &&
        (() => {
          const { chartData, series } = buildGroupedChartData(
            enrollmentData,
            'by_first_summer_year',
            'first_summer_year',
            15,
            undefined,
            true,
            'asc'
          )
          if (chartData.length === 0) return null
          return (
            <CssVerticalGroupedBarChart
              data={chartData}
              series={series}
              title={`First Summer Year (${numYearsDisplay}-Year Comparison)`}
              height={300}
              maxColumnWidth={numYearsDisplay === 3 ? 300 : 160}
              groupGap={numYearsDisplay === 3 ? 48 : 32}
            />
          )
        })()}

      {/* City Distribution */}
      {enrollmentData.some((y) => (y.by_city?.length ?? 0) > 0) &&
        (() => {
          const { chartData, series } = buildGroupedChartData(enrollmentData, 'by_city', 'city', 15)
          if (chartData.length === 0) return null
          return (
            <CssVerticalGroupedBarChart
              data={chartData}
              series={series}
              title={`City Distribution (Top 15, ${numYearsDisplay}-Year Comparison)`}
              height={350}
              groupGap={numYearsDisplay === 3 ? 24 : 20}
              barWidthPercent={numYearsDisplay === 3 ? 30 : 55}
            />
          )
        })()}

      {/* School Distribution */}
      {enrollmentData.some((y) => (y.by_school?.length ?? 0) > 0) &&
        (() => {
          const { chartData, series } = buildGroupedChartData(
            enrollmentData,
            'by_school',
            'school',
            15
          )
          if (chartData.length === 0) return null
          return (
            <CssVerticalGroupedBarChart
              data={chartData}
              series={series}
              title={`School Distribution (Top 15, ${numYearsDisplay}-Year Comparison)`}
              height={350}
              groupGap={numYearsDisplay === 3 ? 24 : 20}
              barWidthPercent={numYearsDisplay === 3 ? 30 : 55}
            />
          )
        })()}

      {/* Synagogue Distribution */}
      {enrollmentData.some((y) => (y.by_synagogue?.length ?? 0) > 0) &&
        (() => {
          const { chartData, series } = buildGroupedChartData(
            enrollmentData,
            'by_synagogue',
            'synagogue',
            15
          )
          if (chartData.length === 0) return null
          return (
            <CssVerticalGroupedBarChart
              data={chartData}
              series={series}
              title={`Synagogue Distribution (Top 15, ${numYearsDisplay}-Year Comparison)`}
              height={350}
              groupGap={numYearsDisplay === 3 ? 24 : 20}
              barWidthPercent={numYearsDisplay === 3 ? 30 : 55}
            />
          )
        })()}

      {/* Region Distribution */}
      {enrollmentDataWithRegions.some((y) => y.by_region.length > 0) &&
        (() => {
          const { chartData, series } = buildGroupedChartData(
            enrollmentDataWithRegions,
            'by_region',
            'region',
            15,
            (key) => REGION_DISPLAY_NAMES[String(key)] ?? String(key)
          )
          if (chartData.length === 0) return null
          return (
            <CssVerticalGroupedBarChart
              data={chartData}
              series={series}
              title={`Region Distribution (${numYearsDisplay}-Year Comparison)`}
              height={350}
              groupGap={numYearsDisplay === 3 ? 24 : 20}
              barWidthPercent={numYearsDisplay === 3 ? 30 : 55}
            />
          )
        })()}
    </div>
  )
}
