/**
 * RetentionTab - Display retention metrics with 3-year trend view.
 *
 * Redesigned to:
 * - Use currentYear from app context (no separate year dropdown)
 * - Show 3-year trends (current year vs prior 2 years)
 * - Use line chart for overall retention rate
 * - Use grouped bar charts for category breakdowns
 * - Keep session-specific filter dropdown
 */

import { useState } from 'react';
import { useRetentionTrends } from '../../hooks/useRetentionTrends';
import { useRetentionMetrics } from '../../hooks/useMetrics';
import { useMetricsSessions } from '../../hooks/useMetricsSessions';
import { MetricCard } from '../../components/metrics/MetricCard';
import { BreakdownChart } from '../../components/metrics/BreakdownChart';
import { RetentionSessionSelector } from '../../components/metrics/RetentionSessionSelector';
import { RetentionRateLine } from '../../components/metrics/RetentionRateLine';
import { GenderStackedChart } from '../../components/metrics/GenderStackedChart';
import { GradeEnrollmentChart } from '../../components/metrics/GradeEnrollmentChart';
import { DemographicTable } from '../../components/metrics/DemographicTable';
import { getSessionChartLabel } from '../../utils/sessionDisplay';
import { sortSessionDataByName, sortPriorSessionData } from '../../utils/sessionUtils';
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface RetentionTabProps {
  /** Current year from app context */
  currentYear: number;
  /** Comma-separated session types (default: main,embedded,ag) */
  sessionTypes?: string;
}

export function RetentionTab({ currentYear, sessionTypes }: RetentionTabProps) {
  const [selectedSessionCmId, setSelectedSessionCmId] = useState<number | null>(null);
  const sessionTypesParam = sessionTypes || 'main,embedded,ag';

  // Calculate base year (year before current year) for the primary view
  const baseYear = currentYear - 1;

  // Fetch sessions for dropdown (from base year for filtering)
  const { data: sessions = [], isLoading: sessionsLoading } = useMetricsSessions(baseYear);

  // Fetch 3-year retention trends
  const {
    data: trendsData,
    isLoading: trendsLoading,
    error: trendsError,
  } = useRetentionTrends(currentYear, {
    numYears: 3,
    sessionTypes: sessionTypesParam,
    sessionCmId: selectedSessionCmId ?? undefined,
  });

  // Also fetch detailed retention data for the current year transition
  // This provides additional breakdowns (summer_years, first_summer_year, prior_session, demographics)
  const { data: detailedData } = useRetentionMetrics(
    baseYear,
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  );

  if (trendsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading retention data...</span>
      </div>
    );
  }

  if (trendsError) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="w-6 h-6 mr-2" />
        <span>Failed to load retention data: {trendsError.message}</span>
      </div>
    );
  }

  if (!trendsData || trendsData.years.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        No retention data available
      </div>
    );
  }

  // Get the most recent year transition for detailed stats
  const latestTransition = trendsData.years[trendsData.years.length - 1];

  // Get trend icon and color
  const getTrendIcon = () => {
    switch (trendsData.trend_direction) {
      case 'improving':
        return <TrendingUp className="w-5 h-5 text-emerald-500" />;
      case 'declining':
        return <TrendingDown className="w-5 h-5 text-red-500" />;
      default:
        return <Minus className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getTrendLabel = () => {
    switch (trendsData.trend_direction) {
      case 'improving':
        return 'Improving';
      case 'declining':
        return 'Declining';
      default:
        return 'Stable';
    }
  };

  // Sort and transform detailed session data for charts (from the detailed retention response)
  const sortedBySession = sortSessionDataByName(detailedData?.by_session ?? []);
  const sessionChartData = sortedBySession.map((s) => ({
    name: getSessionChartLabel(s.session_name),
    value: s.returned_count,
    percentage: s.retention_rate * 100,
  }));

  // Summer years breakdown (from detailed data)
  const summerYearsChartData = (detailedData?.by_summer_years ?? []).map((y) => ({
    name: y.summer_years === 1 ? '1 summer' : `${y.summer_years} summers`,
    value: y.returned_count,
    percentage: y.retention_rate * 100,
  }));

  // First summer year cohort data
  const firstSummerYearChartData = (detailedData?.by_first_summer_year ?? []).map((y) => ({
    name: y.first_summer_year.toString(),
    value: y.returned_count,
    percentage: y.retention_rate * 100,
  }));

  // Prior year session breakdown (sorted)
  const sortedByPriorSession = sortPriorSessionData(detailedData?.by_prior_session ?? []);
  const priorSessionChartData = sortedByPriorSession.map((s) => ({
    name: getSessionChartLabel(s.prior_session),
    value: s.returned_count,
    percentage: s.retention_rate * 100,
  }));

  // Demographics for tables
  const schoolTableData = (detailedData?.by_school ?? []).map((s) => ({
    name: s.school,
    base_count: s.base_count,
    returned_count: s.returned_count,
    retention_rate: s.retention_rate,
  }));

  const cityTableData = (detailedData?.by_city ?? []).map((c) => ({
    name: c.city,
    base_count: c.base_count,
    returned_count: c.returned_count,
    retention_rate: c.retention_rate,
  }));

  const synagogueTableData = (detailedData?.by_synagogue ?? []).map((s) => ({
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
        <div className="flex items-center gap-2 text-sm">
          {getTrendIcon()}
          <span className="text-muted-foreground">
            3-Year Trend: <span className="font-medium text-foreground">{getTrendLabel()}</span>
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title={`${baseYear} Total Campers`}
          value={latestTransition?.base_count ?? 0}
          subtitle={selectedSessionCmId ? 'In selected session' : 'Enrolled campers in base year'}
        />
        <MetricCard
          title={`${currentYear} Total Campers`}
          value={detailedData?.compare_year_total ?? 0}
          subtitle="Enrolled campers in current year"
        />
        <MetricCard
          title="Returned Campers"
          value={latestTransition?.returned_count ?? 0}
          subtitle={`From ${baseYear} to ${currentYear}`}
        />
        <MetricCard
          title="Avg Retention Rate"
          value={`${Math.round(trendsData.avg_retention_rate * 100)}%`}
          subtitle="Average across 3-year period"
          trend={trendsData.avg_retention_rate >= 0.5 ? 'up' : 'down'}
          trendValue={trendsData.avg_retention_rate >= 0.5 ? 'Good' : 'Low'}
        />
      </div>

      {/* Trend Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line chart for overall retention rate trend */}
        <RetentionRateLine
          data={trendsData.years}
          title="Overall Retention Rate Trend"
          height={250}
        />
        {/* 100% stacked bar chart for gender composition by year */}
        {trendsData.enrollment_by_year && trendsData.enrollment_by_year.length > 0 && (
          <GenderStackedChart
            data={trendsData.enrollment_by_year}
            title="Gender Composition (3-Year Comparison)"
            height={250}
          />
        )}
      </div>

      {/* Trend Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grouped bar chart for enrollment by grade across years */}
        {trendsData.enrollment_by_year && trendsData.enrollment_by_year.length > 0 && (
          <GradeEnrollmentChart
            data={trendsData.enrollment_by_year}
            title="Enrollment by Grade (3-Year Comparison)"
            height={300}
          />
        )}
        {/* Session breakdown for current year */}
        <BreakdownChart
          title={`Retention by Session (${baseYear}→${currentYear})`}
          data={sessionChartData}
          type="bar"
          height={300}
        />
      </div>

      {/* Cohort Analysis Charts */}
      {(summerYearsChartData.length > 0 || firstSummerYearChartData.length > 0 || priorSessionChartData.length > 0) && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Cohort Analysis</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {summerYearsChartData.length > 0 && (
              <BreakdownChart
                title="Retention by Summers Enrolled"
                data={summerYearsChartData}
                type="bar"
                height={250}
              />
            )}
            {firstSummerYearChartData.length > 0 && (
              <BreakdownChart
                title="Retention by First Summer Year"
                data={firstSummerYearChartData}
                type="bar"
                height={250}
              />
            )}
            {priorSessionChartData.length > 0 && (
              <BreakdownChart
                title={`Retention by ${baseYear - 1} Session`}
                data={priorSessionChartData}
                type="bar"
                height={250}
              />
            )}
          </div>
        </div>
      )}

      {/* Detailed Session Table */}
      <div className="card-lodge overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            Retention Details by Session ({baseYear}→{currentYear})
          </h3>
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
              {sortedBySession.map((session, index) => (
                <tr key={index} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{getSessionChartLabel(session.session_name)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{session.base_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">{session.returned_count}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={session.retention_rate >= 0.5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {(session.retention_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demographic Tables */}
      {(schoolTableData.length > 0 || cityTableData.length > 0 || synagogueTableData.length > 0) && (
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
      )}
    </div>
  );
}
