/**
 * GenderStackedChart - 100% stacked bar chart showing gender composition per year.
 *
 * Displays gender breakdown for each year as percentage bars (100% stacked),
 * enabling easy comparison of gender composition trends over time.
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
} from 'recharts';
import type { YearEnrollment } from '../../types/metrics';

// Gender-specific colors (consistent with app theme)
const GENDER_COLORS: Record<string, string> = {
  M: 'hsl(200, 70%, 50%)', // Blue
  F: 'hsl(340, 70%, 50%)', // Pink
  Unknown: 'hsl(0, 0%, 60%)', // Gray
};

// Fallback colors for other genders
const FALLBACK_COLORS = [
  'hsl(280, 60%, 50%)', // Purple
  'hsl(42, 92%, 50%)', // Gold
  'hsl(160, 100%, 35%)', // Green
];

interface GenderStackedChartProps {
  data: YearEnrollment[];
  title?: string;
  height?: number;
  className?: string;
}

interface ChartDataItem {
  name: string;
  [key: string]: string | number;
}

/**
 * Transform YearEnrollment data to chart format.
 * Each year becomes a bar with stacked gender segments.
 */
function transformData(data: YearEnrollment[]): { chartData: ChartDataItem[]; genders: string[] } {
  // Collect all unique genders across all years
  const genderSet = new Set<string>();
  for (const year of data) {
    for (const g of year.by_gender) {
      genderSet.add(g.gender);
    }
  }
  const genders = Array.from(genderSet).sort();

  // Transform to chart data format
  const chartData = data.map((year) => {
    const item: ChartDataItem = { name: year.year.toString() };
    for (const g of year.by_gender) {
      item[g.gender] = g.count;
    }
    return item;
  });

  return { chartData, genders };
}

export function GenderStackedChart({
  data,
  title = 'Gender Composition by Year',
  height = 300,
  className = '',
}: GenderStackedChartProps) {
  // Show empty state if no data or no gender data
  const hasGenderData = data.some((y) => y.by_gender.length > 0);

  if (data.length === 0 || !hasGenderData) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          No data available
        </div>
      </div>
    );
  }

  const { chartData, genders } = transformData(data);

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
          <p className="font-medium text-foreground mb-2">Year {label}</p>
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

  // Get color for gender
  const getGenderColor = (gender: string, index: number): string => {
    if (gender in GENDER_COLORS) {
      return GENDER_COLORS[gender] ?? 'hsl(0, 0%, 50%)';
    }
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length] ?? 'hsl(0, 0%, 50%)';
  };

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          stackOffset="expand"
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`}
            domain={[0, 1]}
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {genders.map((gender, index) => (
            <Bar
              key={gender}
              dataKey={gender}
              name={gender}
              stackId="gender"
              fill={getGenderColor(gender, index)}
              radius={index === genders.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
