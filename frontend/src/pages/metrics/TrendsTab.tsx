/**
 * TrendsTab - Display historical trends across multiple years (default: last 5 years).
 */

import { useHistoricalTrends } from '../../hooks/useMetrics';
import { TrendLineChart } from '../../components/metrics/TrendLineChart';
import { MetricCard } from '../../components/metrics/MetricCard';
import { Loader2, AlertCircle } from 'lucide-react';

export function TrendsTab() {
  const { data, isLoading, error } = useHistoricalTrends();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading historical trends...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="w-6 h-6 mr-2" />
        <span>Failed to load historical data: {error.message}</span>
      </div>
    );
  }

  if (!data || data.years.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        No historical data available. Run camper-history sync for previous years.
      </div>
    );
  }

  // Calculate summary metrics
  const latestYear = data.years[data.years.length - 1];
  const earliestYear = data.years[0];

  const totalChange = latestYear && earliestYear
    ? latestYear.total_enrolled - earliestYear.total_enrolled
    : 0;

  const percentChange = earliestYear && earliestYear.total_enrolled > 0
    ? ((totalChange / earliestYear.total_enrolled) * 100).toFixed(1)
    : '0';

  const avgGrowth = data.years.length > 1
    ? (totalChange / (data.years.length - 1)).toFixed(0)
    : '0';

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Year-by-Year Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Year</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">New</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Returning</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">New %</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Male</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Female</th>
              </tr>
            </thead>
            <tbody>
              {data.years.map((year) => {
                const maleCount = year.by_gender.find((g) => g.gender === 'M')?.count ?? 0;
                const femaleCount = year.by_gender.find((g) => g.gender === 'F')?.count ?? 0;
                return (
                  <tr
                    key={year.year}
                    className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{year.year}</td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {year.total_enrolled.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {year.new_vs_returning.new_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {year.new_vs_returning.returning_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {year.new_vs_returning.new_percentage.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {maleCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {femaleCount.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
