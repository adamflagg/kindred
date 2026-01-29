/**
 * RegistrationOverview - Display registration breakdown for the current year.
 *
 * This is the main registration metrics view showing:
 * - Summary cards (enrolled, waitlisted, cancelled, new/returning)
 * - Gender breakdown and gender by grade charts
 * - Session and session length breakdowns
 * - Years at camp analysis
 * - Session details table
 * - Demographic breakdowns (school, city, synagogue)
 */

import { useState, useMemo } from 'react';
import { useCurrentYear } from '../../../hooks/useCurrentYear';
import { useRegistrationMetrics } from '../../../hooks/useMetrics';
import { useMetricsSessions } from '../../../hooks/useMetricsSessions';
import { useDrilldown } from '../../../hooks/useDrilldown';
import { MetricCard } from '../../../components/metrics/MetricCard';
import { BreakdownChart } from '../../../components/metrics/BreakdownChart';
import { DemographicBreakdowns } from '../../../components/metrics/DemographicBreakdowns';
import { RegistrationSessionSelector } from '../../../components/metrics/RegistrationSessionSelector';
import { GenderByGradeChart } from '../../../components/metrics/GenderByGradeChart';
import { getSessionChartLabel } from '../../../utils/sessionDisplay';
import { buildSessionDateLookup, sortSessionDataByDate } from '../../../utils/sessionUtils';
import {
  transformGenderData,
  transformGradeData,
  transformSessionData,
  transformSessionLengthData,
  transformSummerYearsData,
  transformFirstSummerYearData,
  transformNewVsReturningData,
} from '../../../utils/metricsTransforms';
import { Loader2, AlertCircle } from 'lucide-react';

/** Default session types for summer camp metrics */
const DEFAULT_SESSION_TYPES = ['main', 'embedded', 'ag'];

export default function RegistrationOverview() {
  const { currentYear } = useCurrentYear();

  // Local state for session filter
  const [selectedSessionCmId, setSelectedSessionCmId] = useState<number | null>(null);

  // Build session types param string
  const sessionTypesParam = DEFAULT_SESSION_TYPES.join(',');
  // Always use enrolled status only
  const statusesParam = 'enrolled';

  // Drilldown state management
  const { setFilter, DrilldownModal } = useDrilldown({
    year: currentYear,
    sessionCmId: selectedSessionCmId ?? undefined,
    sessionTypes: DEFAULT_SESSION_TYPES,
    statusFilter: [statusesParam],
  });

  // Fetch sessions for dropdown
  const { data: sessions = [], isLoading: sessionsLoading } = useMetricsSessions(currentYear);

  // Build session date lookup for date-aware sorting
  const sessionDateLookup = useMemo(
    () => buildSessionDateLookup(sessions),
    [sessions]
  );

  // Fetch registration data with optional session filter
  const { data, isLoading, error } = useRegistrationMetrics(
    currentYear,
    sessionTypesParam,
    statusesParam,
    selectedSessionCmId ?? undefined
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

  // Transform data for charts using utility functions
  const genderChartData = transformGenderData(data.by_gender);
  const gradeChartData = transformGradeData(data.by_grade);
  const sessionChartData = transformSessionData(data.by_session, sessionDateLookup);
  const sessionLengthData = transformSessionLengthData(data.by_session_length);
  const summerYearsData = transformSummerYearsData(data.by_summer_years);
  const firstSummerYearData = transformFirstSummerYearData(data.by_first_summer_year);
  const newVsReturningData = transformNewVsReturningData(data.new_vs_returning);

  // Fallback to years_at_camp if summer years not available
  const yearsChartData =
    summerYearsData.length > 0
      ? summerYearsData
      : data.by_years_at_camp.map((y) => ({
          name: y.years === 1 ? '1 year' : `${y.years} years`,
          value: y.count,
          percentage: y.percentage,
        }));

  // Sort sessions for table (chart uses sorted version from transformSessionData)
  const sortedBySession = sortSessionDataByDate(data.by_session, sessionDateLookup);

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
          subtitle={selectedSessionCmId ? 'In selected session' : `Active enrollments for ${currentYear}`}
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

      {/* Charts Row 1: Gender */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Enrollment by Gender"
          data={genderChartData}
          type="pie"
          showPercentage
          height={250}
          breakdownType="gender"
          onSegmentClick={setFilter}
        />
        {/* Gender by Grade stacked bar chart */}
        <GenderByGradeChart
          data={data.by_gender_grade ?? []}
          title="Gender by Grade"
          height={250}
          onBarClick={setFilter}
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
        <BreakdownChart
          title="Enrollment by Grade"
          data={gradeChartData}
          type="bar"
          height={300}
          breakdownType="grade"
          onSegmentClick={setFilter}
        />
      </div>

      {/* Charts Row 3: Session, Session Length */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BreakdownChart
          title="Enrollment by Session"
          data={sessionChartData}
          type="bar"
          height={350}
          breakdownType="session"
          onSegmentClick={setFilter}
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
        <BreakdownChart
          title={summerYearsData.length > 0 ? 'Enrollment by Summers at Camp' : 'Enrollment by Years at Camp'}
          data={yearsChartData}
          type="bar"
          height={300}
          breakdownType="years_at_camp"
          onSegmentClick={setFilter}
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
              {sortedBySession.map((session, index) => (
                <tr key={index} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{getSessionChartLabel(session.session_name, undefined, sessionDateLookup)}</td>
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

      {/* Drill-down Modal */}
      <DrilldownModal />
    </div>
  );
}
