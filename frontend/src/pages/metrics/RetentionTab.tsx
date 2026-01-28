/**
 * RetentionTab - Display retention metrics comparing two years.
 *
 * Redesigned to:
 * - Add session-specific filter dropdown
 * - Show summer years calculated from attendees (not years_at_camp)
 * - Show first summer year cohort analysis
 * - Show prior year session breakdown
 * - Replace top-20 demographics with searchable tables
 */

import { useState } from 'react';
import { useRetentionMetrics } from '../../hooks/useMetrics';
import { useMetricsSessions } from '../../hooks/useMetricsSessions';
import { MetricCard } from '../../components/metrics/MetricCard';
import { BreakdownChart } from '../../components/metrics/BreakdownChart';
import { RetentionSessionSelector } from '../../components/metrics/RetentionSessionSelector';
import { DemographicTable } from '../../components/metrics/DemographicTable';
import { getSessionChartLabel } from '../../utils/sessionDisplay';
import { Loader2, AlertCircle } from 'lucide-react';

interface RetentionTabProps {
  baseYear: number;
  compareYear: number;
  /** Comma-separated session types (default: main,embedded,ag) */
  sessionTypes?: string;
}

export function RetentionTab({ baseYear, compareYear, sessionTypes }: RetentionTabProps) {
  const [selectedSessionCmId, setSelectedSessionCmId] = useState<number | null>(null);
  const sessionTypesParam = sessionTypes || 'main,embedded,ag';

  // Fetch sessions for dropdown
  const { data: sessions = [], isLoading: sessionsLoading } = useMetricsSessions(baseYear);

  // Fetch retention data with optional session filter
  const { data, isLoading, error } = useRetentionMetrics(
    baseYear,
    compareYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  );

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

  // New: Summer years breakdown (calculated from attendees, not years_at_camp)
  const summerYearsChartData = (data.by_summer_years ?? []).map((y) => ({
    name: y.summer_years === 1 ? '1 summer' : `${y.summer_years} summers`,
    value: y.returned_count,
    percentage: y.retention_rate,
  }));

  // First summer year cohort analysis
  const firstSummerYearChartData = (data.by_first_summer_year ?? []).map((y) => ({
    name: y.first_summer_year.toString(),
    value: y.returned_count,
    percentage: y.retention_rate,
  }));

  // Prior year session breakdown
  const priorSessionChartData = (data.by_prior_session ?? []).map((s) => ({
    name: getSessionChartLabel(s.prior_session),
    value: s.returned_count,
    percentage: s.retention_rate,
  }));

  // Transform demographics for tables
  const schoolTableData = (data.by_school ?? []).map((s) => ({
    name: s.school,
    base_count: s.base_count,
    returned_count: s.returned_count,
    retention_rate: s.retention_rate,
  }));

  const cityTableData = (data.by_city ?? []).map((c) => ({
    name: c.city,
    base_count: c.base_count,
    returned_count: c.returned_count,
    retention_rate: c.retention_rate,
  }));

  const synagogueTableData = (data.by_synagogue ?? []).map((s) => ({
    name: s.synagogue,
    base_count: s.base_count,
    returned_count: s.returned_count,
    retention_rate: s.retention_rate,
  }));

  return (
    <div className="space-y-6">
      {/* Session Selector */}
      <div className="flex items-center justify-between">
        <RetentionSessionSelector
          sessions={sessions}
          selectedSessionCmId={selectedSessionCmId}
          onSessionChange={setSelectedSessionCmId}
          isLoading={sessionsLoading}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title={`${baseYear} Total Campers`}
          value={data.base_year_total}
          subtitle={selectedSessionCmId ? 'In selected session' : 'Enrolled campers in base year'}
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

      {/* Core Breakdown Charts */}
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
        {/* Summer years calculated from actual enrollment history */}
        <BreakdownChart
          title="Retention by Summers Enrolled"
          data={summerYearsChartData}
          type="bar"
          height={250}
        />
      </div>

      {/* New: Cohort Analysis Charts */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Cohort Analysis</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BreakdownChart
            title="Retention by First Summer Year"
            data={firstSummerYearChartData}
            type="bar"
            height={250}
          />
          <BreakdownChart
            title={`Retention by ${baseYear - 1} Session`}
            data={priorSessionChartData}
            type="bar"
            height={250}
          />
        </div>
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

      {/* Demographic Tables - Full lists, searchable */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Demographics</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Full demographic data for data quality review. Search and sort to find patterns.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <DemographicTable title="School" data={schoolTableData} />
          <DemographicTable title="City" data={cityTableData} />
          <DemographicTable title="Synagogue" data={synagogueTableData} />
        </div>
      </div>
    </div>
  );
}
