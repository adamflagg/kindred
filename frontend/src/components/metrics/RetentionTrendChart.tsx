/**
 * RetentionTrendChart - Grouped bar chart showing retention across multiple years.
 *
 * Displays category breakdowns (gender, grade) with bars for each year transition,
 * enabling side-by-side comparison of retention rates over time.
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
import type { RetentionTrendYear, RetentionByGender, RetentionByGrade } from '../../types/metrics';

// Year-specific colors for grouped bars
const YEAR_COLORS = [
  'hsl(200, 70%, 50%)',   // Blue (oldest)
  'hsl(160, 100%, 35%)',  // Green (middle)
  'hsl(42, 92%, 50%)',    // Gold (most recent)
  'hsl(280, 60%, 50%)',   // Purple
  'hsl(350, 70%, 50%)',   // Red
];

type BreakdownType = 'gender' | 'grade';

interface RetentionTrendChartProps {
  data: RetentionTrendYear[];
  breakdownType: BreakdownType;
  title?: string;
  height?: number;
  className?: string;
}

interface ChartDataItem {
  name: string;
  [key: string]: string | number;
}

function transformGenderData(years: RetentionTrendYear[]): ChartDataItem[] {
  // Get all unique genders across all years
  const allGenders = new Set<string>();
  for (const year of years) {
    for (const g of year.by_gender) {
      allGenders.add(g.gender);
    }
  }

  // Create data points for each gender
  return Array.from(allGenders).map((gender) => {
    const item: ChartDataItem = { name: gender };
    for (const year of years) {
      const key = `${year.from_year}→${year.to_year}`;
      const genderData = year.by_gender.find((g: RetentionByGender) => g.gender === gender);
      item[key] = genderData ? Math.round(genderData.retention_rate * 100) : 0;
    }
    return item;
  });
}

function transformGradeData(years: RetentionTrendYear[]): ChartDataItem[] {
  // Get all unique grades across all years
  const allGrades = new Set<number | null>();
  for (const year of years) {
    for (const g of year.by_grade) {
      allGrades.add(g.grade);
    }
  }

  // Sort grades numerically (null at end)
  const sortedGrades = Array.from(allGrades).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  // Create data points for each grade
  return sortedGrades.map((grade) => {
    const name = grade !== null ? `Grade ${grade}` : 'Unknown';
    const item: ChartDataItem = { name };
    for (const year of years) {
      const key = `${year.from_year}→${year.to_year}`;
      const gradeData = year.by_grade.find((g: RetentionByGrade) => g.grade === grade);
      item[key] = gradeData ? Math.round(gradeData.retention_rate * 100) : 0;
    }
    return item;
  });
}

export function RetentionTrendChart({
  data,
  breakdownType,
  title,
  height = 300,
  className = '',
}: RetentionTrendChartProps) {
  const defaultTitle = breakdownType === 'gender'
    ? 'Retention by Gender (3-Year Trend)'
    : 'Retention by Grade (3-Year Trend)';

  if (data.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-sm font-semibold text-foreground mb-4">{title ?? defaultTitle}</h3>
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
          No data available
        </div>
      </div>
    );
  }

  // Transform data based on breakdown type
  const chartData = breakdownType === 'gender'
    ? transformGenderData(data)
    : transformGradeData(data);

  // Get year transition keys for bars
  const yearKeys = data.map((year) => `${year.from_year}→${year.to_year}`);

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
              <span style={{ color: p.color }}>{p.name}:</span>{' '}
              <span className="font-semibold text-foreground">{p.value}%</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground mb-4">{title ?? defaultTitle}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {yearKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              fill={YEAR_COLORS[index % YEAR_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
