/**
 * SessionLengthBySessionChart - Stacked bar chart showing session breakdown per length category.
 *
 * Displays individual session counts for each length category (1-week, 2-week, etc.),
 * enabling comparison of session distribution across length categories.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts';
import type { SessionLengthBySessionBreakdown } from '../../types/metrics';

// Color palette for sessions (cycles if more than 8 sessions)
const COLORS = [
  'hsl(160, 100%, 35%)', // Primary green
  'hsl(42, 92%, 50%)',   // Accent gold
  'hsl(200, 70%, 50%)',  // Blue
  'hsl(280, 60%, 50%)',  // Purple
  'hsl(350, 70%, 50%)',  // Red
  'hsl(100, 60%, 45%)',  // Lime
  'hsl(30, 80%, 50%)',   // Orange
  'hsl(180, 60%, 45%)',  // Teal
];

interface SessionLengthBySessionChartProps {
  data: SessionLengthBySessionBreakdown[];
  title?: string;
  height?: number;
  className?: string;
  /** Callback when a length category bar is clicked */
  onCategoryClick?: (lengthCategory: string) => void;
}

interface ChartDataItem {
  name: string;
  total: number;
  [sessionKey: string]: string | number;
}

export function SessionLengthBySessionChart({
  data,
  title = 'Enrollment by Session Length',
  height = 300,
  className = '',
  onCategoryClick,
}: SessionLengthBySessionChartProps) {
  if (data.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          No data available
        </div>
      </div>
    );
  }

  // Collect all unique sessions across all length categories
  const allSessions = new Map<number, string>();
  for (const item of data) {
    for (const session of item.sessions) {
      allSessions.set(session.session_cm_id, session.session_name);
    }
  }
  const sessionList = Array.from(allSessions.entries()).sort((a, b) => a[0] - b[0]);

  // Transform data for stacked bar chart
  const chartData: ChartDataItem[] = data.map((item) => {
    const point: ChartDataItem = {
      name: item.length_category,
      total: item.total,
    };

    // Add count for each session (default 0 if not present)
    for (const [sessionId] of sessionList) {
      const sessionData = item.sessions.find((s) => s.session_cm_id === sessionId);
      point[`session_${sessionId}`] = sessionData?.count || 0;
    }

    return point;
  });

  // Build session color map
  const sessionColors = new Map<string, string>();
  sessionList.forEach(([sessionId], index) => {
    sessionColors.set(`session_${sessionId}`, COLORS[index % COLORS.length] ?? '#00b36b');
  });

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      // Filter out zero values and sort by count descending
      const nonZeroPayload = payload
        .filter((p) => p.value > 0)
        .sort((a, b) => b.value - a.value);

      if (nonZeroPayload.length === 0) return null;

      const total = nonZeroPayload.reduce((sum, p) => sum + (p.value || 0), 0);
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground mb-2">{label}</p>
          {nonZeroPayload.map((p, idx) => (
            <p key={idx} className="text-sm text-muted-foreground">
              <span style={{ color: p.color }}>{p.name}:</span>{' '}
              <span className="font-semibold text-foreground">
                {p.value} ({total > 0 ? ((p.value / total) * 100).toFixed(0) : 0}%)
              </span>
            </p>
          ))}
          <p className="text-sm text-muted-foreground mt-1 border-t border-border pt-1">
            Total: <span className="font-semibold text-foreground">{total}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  // Get the last session for adding LabelList
  const lastSessionKey = sessionList.length > 0 ? `session_${sessionList[sessionList.length - 1]?.[0]}` : null;

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {sessionList.map(([sessionId, sessionName], index) => {
            const dataKey = `session_${sessionId}`;
            const isLast = index === sessionList.length - 1;
            return (
              <Bar
                key={dataKey}
                dataKey={dataKey}
                name={sessionName}
                stackId="sessions"
                fill={sessionColors.get(dataKey)}
                radius={isLast ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                cursor={onCategoryClick ? 'pointer' : undefined}
                onClick={(data) => {
                  if (onCategoryClick && data?.name) {
                    onCategoryClick(data.name as string);
                  }
                }}
              >
                {isLast && lastSessionKey && (
                  <LabelList
                    dataKey="total"
                    position="top"
                    className="text-xs"
                    fill="hsl(var(--muted-foreground))"
                  />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
