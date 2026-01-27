/**
 * RegistrationTab - Display registration breakdown for a single year.
 */

import { useRegistrationMetrics } from '../../hooks/useMetrics';
import { MetricCard } from '../../components/metrics/MetricCard';
import { BreakdownChart } from '../../components/metrics/BreakdownChart';
import { Loader2, AlertCircle } from 'lucide-react';

interface RegistrationTabProps {
  year: number;
  compareYear?: number;
}

export function RegistrationTab({ year, compareYear }: RegistrationTabProps) {
  // compareYear will be used for YoY comparison visualization in Phase 4
  void compareYear;
  const { data, isLoading, error } = useRegistrationMetrics(year);

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
    name: s.session_name,
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

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Enrolled"
          value={data.total_enrolled}
          subtitle={`Active enrollments for ${year}`}
        />
        <MetricCard
          title="Total Waitlisted"
          value={data.total_waitlisted}
          subtitle="On waitlist"
        />
        <MetricCard
          title="Total Cancelled"
          value={data.total_cancelled}
          subtitle="Cancellations"
        />
        <MetricCard
          title="New Campers"
          value={data.new_vs_returning.new_count}
          subtitle={`${data.new_vs_returning.new_percentage.toFixed(1)}% of enrolled`}
        />
        <MetricCard
          title="Returning Campers"
          value={data.new_vs_returning.returning_count}
          subtitle={`${data.new_vs_returning.returning_percentage.toFixed(1)}% of enrolled`}
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
        <BreakdownChart
          title="Enrollment by Grade"
          data={gradeChartData}
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
        <BreakdownChart
          title="Enrollment by Years at Camp"
          data={yearsChartData}
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
                  <td className="px-4 py-3 font-medium text-foreground">{session.session_name}</td>
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
    </div>
  );
}
