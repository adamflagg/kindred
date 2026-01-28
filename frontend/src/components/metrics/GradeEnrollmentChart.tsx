/**
 * GradeEnrollmentChart - Grouped bar chart showing enrollment by grade per year.
 *
 * Displays enrollment counts for each grade with one bar per year,
 * enabling comparison of grade distribution trends across years.
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

// Year-specific colors for grouped bars
const YEAR_COLORS = [
  'hsl(200, 70%, 50%)', // Blue (oldest)
  'hsl(160, 100%, 35%)', // Green (middle)
  'hsl(42, 92%, 50%)', // Gold (most recent)
  'hsl(280, 60%, 50%)', // Purple
  'hsl(350, 70%, 50%)', // Red
];

interface GradeEnrollmentChartProps {
  data: YearEnrollment[];
  title?: string;
  height?: number;
  className?: string;
}

interface ChartDataItem {
  name: string;
  grade: number | null;
  [key: string]: string | number | null;
}

/**
 * Transform YearEnrollment data to chart format.
 * Each grade becomes a group with one bar per year.
 */
function transformData(data: YearEnrollment[]): { chartData: ChartDataItem[]; years: number[] } {
  // Collect all unique grades across all years
  const gradeSet = new Set<number | null>();
  for (const year of data) {
    for (const g of year.by_grade) {
      gradeSet.add(g.grade);
    }
  }

  // Sort grades numerically (null at end)
  const sortedGrades = Array.from(gradeSet).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  // Get years in order
  const years = data.map((y) => y.year).sort((a, b) => a - b);

  // Create data points for each grade
  const chartData = sortedGrades.map((grade) => {
    const name = grade !== null ? `Grade ${grade}` : 'Unknown';
    const item: ChartDataItem = { name, grade };

    for (const yearData of data) {
      const gradeData = yearData.by_grade.find((g) => g.grade === grade);
      item[yearData.year.toString()] = gradeData?.count ?? 0;
    }

    return item;
  });

  return { chartData, years };
}

export function GradeEnrollmentChart({
  data,
  title = 'Enrollment by Grade',
  height = 300,
  className = '',
}: GradeEnrollmentChartProps) {
  // Show empty state if no data or no grade data
  const hasGradeData = data.some((y) => y.by_grade.length > 0);

  if (data.length === 0 || !hasGradeData) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          No data available
        </div>
      </div>
    );
  }

  const { chartData, years } = transformData(data);

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
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground mb-2">{label}</p>
          {payload.map((p, idx) => (
            <p key={idx} className="text-sm text-muted-foreground">
              <span style={{ color: p.color }}>Year {p.name}:</span>{' '}
              <span className="font-semibold text-foreground">{p.value}</span>
            </p>
          ))}
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
          <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {years.map((year, index) => (
            <Bar
              key={year}
              dataKey={year.toString()}
              name={year.toString()}
              fill={YEAR_COLORS[index % YEAR_COLORS.length] ?? 'hsl(0, 0%, 50%)'}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
