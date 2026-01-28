/**
 * GenderByGradeChart - Stacked bar chart showing gender breakdown per grade.
 *
 * Displays male/female/other counts for each grade level,
 * enabling comparison of gender distribution across grades.
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
import type { GenderByGradeBreakdown } from '../../types/metrics';

// Gender-specific colors
const COLORS = {
  male: 'hsl(200, 70%, 50%)',     // Blue
  female: 'hsl(350, 70%, 50%)',   // Red/Pink
  other: 'hsl(280, 60%, 50%)',    // Purple
};

interface GenderByGradeChartProps {
  data: GenderByGradeBreakdown[];
  title?: string;
  height?: number;
  className?: string;
}

interface ChartDataItem {
  name: string;
  grade: number | null;
  male: number;
  female: number;
  other: number;
  total: number;
}

export function GenderByGradeChart({
  data,
  title = 'Gender by Grade',
  height = 300,
  className = '',
}: GenderByGradeChartProps) {
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

  // Transform data for stacked bar chart
  const chartData: ChartDataItem[] = data.map((item) => ({
    name: item.grade !== null ? `Grade ${item.grade}` : 'Unknown',
    grade: item.grade,
    male: item.male_count,
    female: item.female_count,
    other: item.other_count,
    total: item.total,
  }));

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground mb-2">{label}</p>
          {payload.map((p, idx) => (
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
          <Bar
            dataKey="male"
            name="Male"
            stackId="gender"
            fill={COLORS.male}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="female"
            name="Female"
            stackId="gender"
            fill={COLORS.female}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="other"
            name="Other"
            stackId="gender"
            fill={COLORS.other}
            radius={[4, 4, 0, 0]}
          >
            <LabelList
              dataKey="total"
              position="top"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
