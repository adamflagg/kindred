/**
 * RetentionTab - Display retention metrics comparing two years.
 */

import { useRetentionMetrics } from '../../hooks/useMetrics';
import { MetricCard } from '../../components/metrics/MetricCard';
import { BreakdownChart } from '../../components/metrics/BreakdownChart';
import { getSessionChartLabel } from '../../utils/sessionDisplay';
import { Loader2, AlertCircle } from 'lucide-react';

interface RetentionTabProps {
  baseYear: number;
  compareYear: number;
  /** Comma-separated session types (default: main,embedded,ag) */
  sessionTypes?: string;
}

export function RetentionTab({ baseYear, compareYear, sessionTypes }: RetentionTabProps) {
  const sessionTypesParam = sessionTypes || 'main,embedded,ag';
  const { data, isLoading, error } = useRetentionMetrics(baseYear, compareYear, sessionTypesParam);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading retention data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="w-6 h-6 mr-2" />
        <span>Failed to load retention data: {error.message}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        No data available
      </div>
    );
  }

  // Transform data for charts
  const genderChartData = data.by_gender.map((g) => ({
    name: g.gender || 'Unknown',
    value: g.returned_count,
    percentage: g.retention_rate,
  }));

  const gradeChartData = data.by_grade.map((g) => ({
    name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    value: g.returned_count,
    percentage: g.retention_rate,
  }));

  const sessionChartData = data.by_session.map((s) => ({
    name: getSessionChartLabel(s.session_name),
    value: s.returned_count,
    percentage: s.retention_rate,
  }));

  const yearsChartData = data.by_years_at_camp.map((y) => ({
    name: y.years === 1 ? '1 year' : `${y.years} years`,
    value: y.returned_count,
    percentage: y.retention_rate,
  }));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title={`${baseYear} Total Campers`}
          value={data.base_year_total}
          subtitle="Enrolled campers in base year"
        />
        <MetricCard
          title={`${compareYear} Total Campers`}
          value={data.compare_year_total}
          subtitle="Enrolled campers in compare year"
        />
        <MetricCard
          title="Returned Campers"
          value={data.returned_count}
          subtitle={`From ${baseYear} to ${compareYear}`}
        />
        <MetricCard
          title="Overall Retention Rate"
          value={`${data.overall_retention_rate.toFixed(1)}%`}
          subtitle="Percentage of campers who returned"
          trend={data.overall_retention_rate >= 50 ? 'up' : 'down'}
          trendValue={data.overall_retention_rate >= 50 ? 'Good' : 'Low'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Retention by Gender"
          data={genderChartData}
          type="pie"
          showPercentage
          height={250}
        />
        <BreakdownChart
          title="Retention by Grade"
          data={gradeChartData}
          type="bar"
          height={250}
        />
        <BreakdownChart
          title="Retention by Session"
          data={sessionChartData}
          type="bar"
          height={300}
        />
        <BreakdownChart
          title="Retention by Years at Camp"
          data={yearsChartData}
          type="bar"
          height={250}
        />
      </div>

      {/* Detailed Table */}
      <div className="card-lodge overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Retention Details by Session</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Session</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">{baseYear} Count</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Returned</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Retention Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.by_session.map((session, index) => (
                <tr key={index} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{getSessionChartLabel(session.session_name)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{session.base_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">{session.returned_count}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={session.retention_rate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {session.retention_rate.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
