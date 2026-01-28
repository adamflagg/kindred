/**
 * RegistrationTab - Display registration breakdown for a single year.
 *
 * Enhanced with:
 * - Session selector dropdown for filtering to specific sessions
 * - Gender by grade stacked bar chart
 * - Summer years breakdown (calculated from enrollment history)
 * - First summer year cohort analysis
 */

import { useState } from 'react';
import { useRegistrationMetrics } from '../../hooks/useMetrics';
import { useMetricsSessions } from '../../hooks/useMetricsSessions';
import { MetricCard } from '../../components/metrics/MetricCard';
import { BreakdownChart } from '../../components/metrics/BreakdownChart';
import { ComparisonBreakdownChart } from '../../components/metrics/ComparisonBreakdownChart';
import { DemographicBreakdowns } from '../../components/metrics/DemographicBreakdowns';
import { RegistrationSessionSelector } from '../../components/metrics/RegistrationSessionSelector';
import { GenderByGradeChart } from '../../components/metrics/GenderByGradeChart';
import { getSessionChartLabel } from '../../utils/sessionDisplay';
import { Loader2, AlertCircle } from 'lucide-react';

interface RegistrationTabProps {
  year: number;
  compareYear?: number;
  /** Comma-separated session types (default: main,embedded,ag) */
  sessionTypes?: string;
}

export function RegistrationTab({ year, compareYear, sessionTypes }: RegistrationTabProps) {
  // Local state for session filter
  const [selectedSessionCmId, setSelectedSessionCmId] = useState<number | null>(null);

  // Build session types param string
  const sessionTypesParam = sessionTypes || 'main,embedded,ag';
  // Always use enrolled status only
  const statusesParam = 'enrolled';

  // Fetch sessions for dropdown
  const { data: sessions = [], isLoading: sessionsLoading } = useMetricsSessions(year);

  // Fetch registration data with optional session filter
  const { data, isLoading, error } = useRegistrationMetrics(
    year,
    sessionTypesParam,
    statusesParam,
    selectedSessionCmId ?? undefined
  );

  // Fetch comparison data for delta badges (without session filter for fair comparison)
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

  // Use summer years (from enrollment history) instead of years_at_camp
  const summerYearsData = (data.by_summer_years ?? []).map((y) => ({
    name: y.summer_years === 1 ? '1 summer' : `${y.summer_years} summers`,
    value: y.count,
    percentage: y.percentage,
  }));

  // Fallback to years_at_camp if summer years not available
  const yearsChartData = summerYearsData.length > 0
    ? summerYearsData
    : data.by_years_at_camp.map((y) => ({
        name: y.years === 1 ? '1 year' : `${y.years} years`,
        value: y.count,
        percentage: y.percentage,
      }));

  // First summer year cohort data
  const firstSummerYearData = (data.by_first_summer_year ?? []).map((y) => ({
    name: y.first_summer_year.toString(),
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
      {/* Session Selector */}
      <div className="flex items-center justify-between">
        <RegistrationSessionSelector
          sessions={sessions}
          selectedSessionCmId={selectedSessionCmId}
          onSessionChange={setSelectedSessionCmId}
          isLoading={sessionsLoading}
        />
        {selectedSessionCmId && (
          <span className="text-sm text-muted-foreground">
            Showing data for selected session only
          </span>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Enrolled"
          value={data.total_enrolled}
          subtitle={selectedSessionCmId ? 'In selected session' : `Active enrollments for ${year}`}
          compareValue={!selectedSessionCmId ? compareData?.total_enrolled : undefined}
          compareYear={!selectedSessionCmId ? compareYear : undefined}
        />
        <MetricCard
          title="Total Waitlisted"
          value={data.total_waitlisted}
          subtitle="On waitlist"
          compareValue={!selectedSessionCmId ? compareData?.total_waitlisted : undefined}
          compareYear={!selectedSessionCmId ? compareYear : undefined}
        />
        <MetricCard
          title="Total Cancelled"
          value={data.total_cancelled}
          subtitle="Cancellations"
          compareValue={!selectedSessionCmId ? compareData?.total_cancelled : undefined}
          compareYear={!selectedSessionCmId ? compareYear : undefined}
        />
        <MetricCard
          title="New Campers"
          value={data.new_vs_returning.new_count}
          subtitle={`${data.new_vs_returning.new_percentage.toFixed(1)}% of enrolled`}
          compareValue={!selectedSessionCmId ? compareData?.new_vs_returning.new_count : undefined}
          compareYear={!selectedSessionCmId ? compareYear : undefined}
        />
        <MetricCard
          title="Returning Campers"
          value={data.new_vs_returning.returning_count}
          subtitle={`${data.new_vs_returning.returning_percentage.toFixed(1)}% of enrolled`}
          compareValue={!selectedSessionCmId ? compareData?.new_vs_returning.returning_count : undefined}
          compareYear={!selectedSessionCmId ? compareYear : undefined}
        />
      </div>

      {/* Charts Row 1: Gender */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Enrollment by Gender"
          data={genderChartData}
          type="pie"
          showPercentage
          height={250}
        />
        {/* Gender by Grade stacked bar chart */}
        <GenderByGradeChart
          data={data.by_gender_grade ?? []}
          title="Gender by Grade"
          height={250}
        />
      </div>

      {/* Charts Row 2: New vs Returning, Grade */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="New vs Returning Campers"
          data={newVsReturningData}
          type="pie"
          showPercentage
          height={250}
        />
        <ComparisonBreakdownChart
          title="Enrollment by Grade"
          data={gradeChartData}
          comparisonData={compareYear && !selectedSessionCmId ? { [compareYear]: comparisonData[compareYear]?.grade ?? [] } : undefined}
          currentYear={year}
          availableComparisonYears={!selectedSessionCmId ? availableComparisonYears : []}
          type="bar"
          height={300}
        />
      </div>

      {/* Charts Row 3: Session, Session Length */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Enrollment by Session"
          data={sessionChartData}
          type="bar"
          height={350}
        />
        <BreakdownChart
          title="Enrollment by Session Length"
          data={sessionLengthData}
          type="bar"
          height={250}
        />
      </div>

      {/* Charts Row 4: Years at Camp, First Summer Year */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ComparisonBreakdownChart
          title={summerYearsData.length > 0 ? 'Enrollment by Summers at Camp' : 'Enrollment by Years at Camp'}
          data={yearsChartData}
          comparisonData={compareYear && !selectedSessionCmId ? { [compareYear]: comparisonData[compareYear]?.years ?? [] } : undefined}
          currentYear={year}
          availableComparisonYears={!selectedSessionCmId ? availableComparisonYears : []}
          type="bar"
          height={300}
        />
        {firstSummerYearData.length > 0 && (
          <BreakdownChart
            title="Enrollment by First Summer Year"
            data={firstSummerYearData}
            type="bar"
            height={300}
          />
        )}
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
