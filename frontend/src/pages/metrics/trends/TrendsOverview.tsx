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
import { useHistoricalTrends, useRegistrationMetrics } from '../../../hooks/useMetrics'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { TrendLineChart } from '../../../components/metrics/TrendLineChart'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { RetentionRateLine } from '../../../components/metrics/RetentionRateLine'
import { CssVerticalStackedBarChart } from '../../../components/metrics/CssVerticalStackedBarChart'
import { CssVerticalGroupedBarChart } from '../../../components/metrics/CssVerticalGroupedBarChart'
import { Loader2 } from 'lucide-react'
import { aggregateCityEnrollmentByRegion, REGION_DISPLAY_NAMES } from '../../../utils/regionUtils'
import { getYearColor, YEAR_PALETTE } from '../../../utils/yearColors'
import { trendDirection } from '../../../utils/trendDirection'
import { firstSummerYearLabel } from '../../../utils/metricsTransforms'
import type { YearEnrollment } from '../../../types/metrics'
import { formatSignedCount, formatSignedPercent } from '../../../utils/numberFormat'
import { YearByYearTable } from '../../../components/metrics/YearByYearTable'
import { yearNoteCount, type LiveCompare } from '../../../components/metrics/yearByYearRows'
import { readsThroughNextDay } from '../../../utils/priorityDay'

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
/** "2025-10-16" → "Oct 16": a calendar date, formatted in UTC so it never shifts a day. */
const formatMonthDay = (isoDate: string) => MONTH_DAY.format(new Date(`${isoDate}T00:00:00Z`))
import { useCompareYearFilter } from '../../../hooks/useCompareYearFilter'
import {
  AnotherIdentityLine,
  GenderFallbackSeasonsLine,
} from '../../../components/metrics/genderIdentityNotes'
import { groupCounts } from '../../../components/metrics/genderNotes'
import { genderGroupSegments } from '../../../components/metrics/genderColors'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'

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
      Array<Record<string, unknown>> | undefined

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
  const { data, isLoading, error, refetch, isPlaceholderData } = useHistoricalTrends({
    ...filterOptions,
    years: yearsParam,
  })

  // While this season is live, its row compares with last year at the same registration day (decision 7,
  // ruling #66); the server says which basis it used, so a finished season reads final to final.
  const compareYear = currentYear - 1
  const compareFilter = useCompareYearFilter(currentYear, compareYear, filterOptions)
  const { data: samePointData } = useRegistrationMetrics(compareYear, {
    ...compareFilter,
    samePointOf: currentYear,
  })
  const live: LiveCompare | null =
    samePointData?.prior_basis === 'same_point' && samePointData.as_of_date
      ? {
          year: currentYear,
          priorYear: compareYear,
          priorTotal: samePointData.total_enrolled,
          asOf: samePointData.as_of_date,
          pending: samePointData.day_offset === 0,
        }
      : null

  // Always fetch 5 years of retention trends for caching; slice when toggling
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
    refetch: refetchTrends,
  } = useRetentionTrends(currentYear, {
    numYears: 5,
    ...filterOptions,
    // Only meaningful in a teen scope; outside one the backend treats it as
    // inert, so don't let hidden state leak into the cache key.
    includeTeenPipeline: scopeHasTeens ? includeTeenPipeline : false,
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
      <MetricsLoadError
        label="historical"
        error={(error ?? trendsError) as Error}
        onRetry={() => {
          void refetch()
          void refetchTrends()
        }}
      />
    )
  }

  if (!data || data.years.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No historical data available for previous years.
      </div>
    )
  }

  // Calculate summary metrics
  // #2898: gender identity in the five groups (#75 a); ruling 58's Gender field count is the note after the
  // Year-by-Year table's (genderNoteN), per season above 0 (#74 a), under each gender card and table and at
  // the page foot.
  const byGender = (rows: ReadonlyArray<{ gender: string; count: number }>) =>
    Object.fromEntries(rows.map((g) => [g.gender, g.count]))
  const fallbackSeasons = data.years.map((y) => ({
    season: y.year,
    count: y.gender_fallback_count ?? 0,
    of: y.total_enrolled,
  }))
  // The Year-by-Year table owns the notes, so the Gender note follows its column notes (and the live row's).
  // #3207 PR 11 (#90): the table gains Retention when the transitions have loaded; its note follows Cancel %'s.
  const retention = trendsData && trendsData.years.length > 0 ? trendsData : undefined
  const tableNotes = yearNoteCount(live, retention !== undefined)
  const genderNoteN = fallbackSeasons.some((s) => s.count > 0) ? tableNotes + 1 : undefined
  // #89: while the newest season is live, the retention line's dashed same-day series takes the next note
  const samePoint =
    retention?.prior_basis === 'same_point' && retention.as_of_date
      ? {
          asOf: retention.as_of_date,
          noteN: (genderNoteN ?? tableNotes) + 1,
          throughNextDay: readsThroughNextDay(retention.day_offset, retention.prior_day_offset),
        }
      : undefined
  // Each card's line lists only the seasons it draws (#72 a: the chart's own count)
  const genderFooter = (
    counts: ReadonlyArray<Record<string, number>>,
    seasons: typeof fallbackSeasons = fallbackSeasons
  ) => (
    <>
      <AnotherIdentityLine counts={counts} />
      {genderNoteN !== undefined && <GenderFallbackSeasonsLine n={genderNoteN} seasons={seasons} />}
    </>
  )
  const compositionRows = enrollmentData.map((y) => {
    const groups = groupCounts(byGender(y.by_gender))
    return {
      name: String(y.year),
      total: Object.values(groups).reduce((a, b) => a + b, 0),
      ...groups,
    }
  })
  const latestYear = data.years.at(-1)
  const earliestYear = data.years[0]

  const totalChange =
    latestYear && earliestYear ? latestYear.total_enrolled - earliestYear.total_enrolled : 0

  const percentChange =
    earliestYear && earliestYear.total_enrolled > 0
      ? (totalChange / earliestYear.total_enrolled) * 100
      : 0

  const avgGrowth = data.years.length > 1 ? Math.round(totalChange / (data.years.length - 1)) : 0

  const summerYearsFormatter = (key: string | number) => {
    const val = String(key)
    return val === '1' ? '1 Summer' : `${val} Summers`
  }

  return (
    <MetricsBusy busy={isPlaceholderData} what={String(currentYear)}>
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
            value={latestYear?.total_enrolled ?? 0}
            subtitle={`${latestYear?.year ?? ''} total campers`}
          />
          <MetricCard
            title="Total Change"
            value={formatSignedCount(totalChange)}
            subtitle={`${formatSignedPercent(percentChange)} over ${data.years.length} years`}
            trend={trendDirection(totalChange)}
            trendValue={formatSignedPercent(percentChange)}
          />
          <MetricCard
            title="Avg. Annual Growth"
            value={formatSignedCount(avgGrowth)}
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
            footer={genderFooter(data.years.map((y) => byGender(y.by_gender)))}
          />
          {enrollmentData.length > 0 && (
            <CssVerticalStackedBarChart
              data={compositionRows}
              segments={genderGroupSegments(compositionRows)}
              footer={genderFooter(
                enrollmentData.map((y) => byGender(y.by_gender)),
                fallbackSeasons.filter((s) => enrollmentData.some((y) => y.year === s.season))
              )}
              title={`Gender Composition (${numYearsDisplay}-Year Comparison)`}
              percentMode
              height={300}
              maxColumnWidth={60}
            />
          )}
        </div>

        {retention?.prior_basis && (
          <p className="text-muted-foreground text-sm">
            {samePoint ? (
              <>
                <b className="text-foreground font-semibold">vs same point last year.</b> The{' '}
                {currentYear} retention point and the {currentYear} row are compared with each
                earlier year at the same registration day ({formatMonthDay(samePoint.asOf)}).
              </>
            ) : (
              <>
                <b className="text-foreground font-semibold">vs last year&apos;s final.</b> Every
                year&apos;s retention is final.
              </>
            )}
          </p>
        )}

        {/* Data Table */}
        <YearByYearTable
          years={data.years}
          live={live}
          retention={retention}
          scoped={filterOptions.sessionCmId != null || filterOptions.duration != null}
        />

        {/* Retention Rate + Cancellation Rate side-by-side */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {retentionYears.length > 0 && (
            <RetentionRateLine
              data={retentionYears}
              title="Overall Retention Rate Trend"
              height={250}
              samePoint={samePoint}
              headerRight={
                scopeHasTeens ? (
                  <label
                    data-app-chrome
                    className="flex cursor-pointer items-center gap-1.5 text-xs"
                  >
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
              firstSummerYearLabel,
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
            const { chartData, series } = buildGroupedChartData(
              enrollmentData,
              'by_city',
              'city',
              15
            )
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
    </MetricsBusy>
  )
}
