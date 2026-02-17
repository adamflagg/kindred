/**
 * TrendsOverview - Display historical trends across multiple years.
 *
 * Shows:
 * - Multi-year enrollment analysis (default: last 5 years)
 * - Total enrollment over time
 * - New vs returning camper trends
 * - Gender distribution over time
 * - Year-by-year summary table
 */

import { useMemo } from 'react'
import { useHistoricalTrends } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { TrendLineChart } from '../../../components/metrics/TrendLineChart'
import { MetricCard } from '../../../components/metrics/MetricCard'
import { Loader2, AlertCircle } from 'lucide-react'

export default function TrendsOverview() {
  // Get session filter from context (unified selector is in MetricsTypeTabs)
  const { selectedSessionCmId, sessionTypesParam } = useMetricsSession()
  const { currentYear } = useCurrentYear()

  // Build explicit years param from currentYear context (defense in depth)
  const yearsParam = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => currentYear - 4 + i).join(',')
  }, [currentYear])

  const { data, isLoading, error } = useHistoricalTrends(
    yearsParam,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading historical trends...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load historical data: {error.message}</span>
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
          <h3 className="text-foreground text-sm font-semibold">Year-by-Year Summary</h3>
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
    </div>
  )
}
