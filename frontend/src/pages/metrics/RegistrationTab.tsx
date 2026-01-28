/**
 * RegistrationTab - Display registration breakdown for a single year.
 */

import { useRegistrationMetrics } from '../../hooks/useMetrics';
import { MetricCard } from '../../components/metrics/MetricCard';
import { BreakdownChart } from '../../components/metrics/BreakdownChart';
import { ComparisonBreakdownChart } from '../../components/metrics/ComparisonBreakdownChart';
import { DemographicBreakdowns } from '../../components/metrics/DemographicBreakdowns';
import { getSessionChartLabel } from '../../utils/sessionDisplay';
import { Loader2, AlertCircle } from 'lucide-react';

interface RegistrationTabProps {
  year: number;
  compareYear?: number;
  /** Comma-separated status values (default: enrolled) */
  statuses?: string;
  /** Comma-separated session types (default: main,embedded,ag) */
  sessionTypes?: string;
}

export function RegistrationTab({ year, compareYear, statuses, sessionTypes }: RegistrationTabProps) {
  // Build session types param string
  const sessionTypesParam = sessionTypes || 'main,embedded,ag';
  const statusesParam = statuses || 'enrolled';

  const { data, isLoading, error } = useRegistrationMetrics(year, sessionTypesParam, statusesParam);

  // Fetch comparison data for delta badges
  const { data: compareData } = useRegistrationMetrics(
    compareYear ?? 0,
    sessionTypesParam,
    statusesParam
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading registration data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="w-6 h-6 mr-2" />
        <span>Failed to load registration data: {error.message}</span>
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
    value: g.count,
    percentage: g.percentage,
  }));

  const gradeChartData = data.by_grade.map((g) => ({
    name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    value: g.count,
    percentage: g.percentage,
  }));

  const sessionChartData = data.by_session.map((s) => ({
    name: getSessionChartLabel(s.session_name),
    value: s.count,
    percentage: s.utilization ?? 0,
  }));

  const sessionLengthData = data.by_session_length.map((s) => ({
    name: s.length_category,
    value: s.count,
    percentage: s.percentage,
  }));

  const yearsChartData = data.by_years_at_camp.map((y) => ({
    name: y.years === 1 ? '1 year' : `${y.years} years`,
    value: y.count,
    percentage: y.percentage,
  }));

  const newVsReturningData = [
    { name: 'New Campers', value: data.new_vs_returning.new_count, percentage: data.new_vs_returning.new_percentage },
    { name: 'Returning', value: data.new_vs_returning.returning_count, percentage: data.new_vs_returning.returning_percentage },
  ];

  // Build comparison data for charts
  const comparisonData: Record<number, { grade: typeof gradeChartData; years: typeof yearsChartData }> = {};
  if (compareYear && compareData) {
    comparisonData[compareYear] = {
      grade: compareData.by_grade.map((g) => ({
        name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
        value: g.count,
        percentage: g.percentage,
      })),
      years: compareData.by_years_at_camp.map((y) => ({
        name: y.years === 1 ? '1 year' : `${y.years} years`,
        value: y.count,
        percentage: y.percentage,
      })),
    };
  }

  // Get available comparison years
  const availableComparisonYears = compareYear ? [compareYear] : [];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Enrolled"
          value={data.total_enrolled}
          subtitle={`Active enrollments for ${year}`}
          compareValue={compareData?.total_enrolled}
          compareYear={compareYear}
        />
        <MetricCard
          title="Total Waitlisted"
          value={data.total_waitlisted}
          subtitle="On waitlist"
          compareValue={compareData?.total_waitlisted}
          compareYear={compareYear}
        />
        <MetricCard
          title="Total Cancelled"
          value={data.total_cancelled}
          subtitle="Cancellations"
          compareValue={compareData?.total_cancelled}
          compareYear={compareYear}
        />
        <MetricCard
          title="New Campers"
          value={data.new_vs_returning.new_count}
          subtitle={`${data.new_vs_returning.new_percentage.toFixed(1)}% of enrolled`}
          compareValue={compareData?.new_vs_returning.new_count}
          compareYear={compareYear}
        />
        <MetricCard
          title="Returning Campers"
          value={data.new_vs_returning.returning_count}
          subtitle={`${data.new_vs_returning.returning_percentage.toFixed(1)}% of enrolled`}
          compareValue={compareData?.new_vs_returning.returning_count}
          compareYear={compareYear}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Enrollment by Gender"
          data={genderChartData}
          type="pie"
          showPercentage
          height={250}
        />
        <BreakdownChart
          title="New vs Returning Campers"
          data={newVsReturningData}
          type="pie"
          showPercentage
          height={250}
        />
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ComparisonBreakdownChart
          title="Enrollment by Grade"
          data={gradeChartData}
          comparisonData={compareYear ? { [compareYear]: comparisonData[compareYear]?.grade ?? [] } : undefined}
          currentYear={year}
          availableComparisonYears={availableComparisonYears}
          type="bar"
          height={300}
        />
        <BreakdownChart
          title="Enrollment by Session Length"
          data={sessionLengthData}
          type="bar"
          height={250}
        />
      </div>

      {/* Charts Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Enrollment by Session"
          data={sessionChartData}
          type="bar"
          height={350}
        />
        <ComparisonBreakdownChart
          title="Enrollment by Years at Camp"
          data={yearsChartData}
          comparisonData={compareYear ? { [compareYear]: comparisonData[compareYear]?.years ?? [] } : undefined}
          currentYear={year}
          availableComparisonYears={availableComparisonYears}
          type="bar"
          height={300}
        />
      </div>

      {/* Session Details Table */}
      <div className="card-lodge overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Session Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Session</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Enrolled</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Capacity</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {data.by_session.map((session, index) => (
                <tr key={index} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{getSessionChartLabel(session.session_name)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{session.count}</td>
                  <td className="px-4 py-3 text-right text-foreground">{session.capacity ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {session.utilization !== null ? (
                      <span className={session.utilization >= 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}>
                        {session.utilization.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demographic Breakdowns (from camper_history) */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Demographic Analysis</h2>
        <DemographicBreakdowns
          bySchool={data.by_school}
          byCity={data.by_city}
          bySynagogue={data.by_synagogue}
          byFirstYear={data.by_first_year}
          bySessionBunk={data.by_session_bunk}
        />
      </div>
    </div>
  );
}
