/**
 * TrendLineChart - Multi-year line chart for historical trends visualization.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts';
import type { YearMetrics } from '../../types/metrics';

const COLORS = {
  total: 'hsl(160, 100%, 35%)', // Primary green
  new: 'hsl(200, 70%, 50%)', // Blue
  returning: 'hsl(42, 92%, 50%)', // Gold
  male: 'hsl(200, 70%, 50%)', // Blue
  female: 'hsl(350, 70%, 50%)', // Red/Pink
};

interface TrendLineChartProps {
  data: YearMetrics[];
  title: string;
  metric: 'total' | 'new_vs_returning' | 'gender';
  height?: number;
  className?: string;
}

export function TrendLineChart({
  data,
  title,
  metric,
  height = 300,
  className = '',
}: TrendLineChartProps) {
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

  // Transform data based on metric type
  const chartData = data.map((yearData) => {
    const base = { year: yearData.year };

    if (metric === 'total') {
      return { ...base, total: yearData.total_enrolled };
    }

    if (metric === 'new_vs_returning') {
      return {
        ...base,
        new: yearData.new_vs_returning.new_count,
        returning: yearData.new_vs_returning.returning_count,
      };
    }

    if (metric === 'gender') {
      const maleData = yearData.by_gender.find((g) => g.gender === 'M');
      const femaleData = yearData.by_gender.find((g) => g.gender === 'F');
      return {
        ...base,
        male: maleData?.count ?? 0,
        female: femaleData?.count ?? 0,
      };
    }

    return base;
  });

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
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: <span className="font-semibold">{entry.value.toLocaleString()}</span>
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
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="year"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value) => value.toLocaleString()}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />

          {metric === 'total' && (
            <Line
              type="monotone"
              dataKey="total"
              name="Total Enrolled"
              stroke={COLORS.total}
              strokeWidth={2}
              dot={{ fill: COLORS.total, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            >
              <LabelList
                dataKey="total"
                position="top"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
                formatter={(value) => typeof value === 'number' ? value.toLocaleString() : String(value ?? '')}
              />
            </Line>
          )}

          {metric === 'new_vs_returning' && (
            <>
              <Line
                type="monotone"
                dataKey="new"
                name="New Campers"
                stroke={COLORS.new}
                strokeWidth={2}
                dot={{ fill: COLORS.new, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="new"
                  position="top"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={(value) => typeof value === 'number' ? value.toLocaleString() : String(value ?? '')}
                />
              </Line>
              <Line
                type="monotone"
                dataKey="returning"
                name="Returning Campers"
                stroke={COLORS.returning}
                strokeWidth={2}
                dot={{ fill: COLORS.returning, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="returning"
                  position="bottom"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={(value) => typeof value === 'number' ? value.toLocaleString() : String(value ?? '')}
                />
              </Line>
            </>
          )}

          {metric === 'gender' && (
            <>
              <Line
                type="monotone"
                dataKey="male"
                name="Male"
                stroke={COLORS.male}
                strokeWidth={2}
                dot={{ fill: COLORS.male, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="male"
                  position="top"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={(value) => typeof value === 'number' ? value.toLocaleString() : String(value ?? '')}
                />
              </Line>
              <Line
                type="monotone"
                dataKey="female"
                name="Female"
                stroke={COLORS.female}
                strokeWidth={2}
                dot={{ fill: COLORS.female, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="female"
                  position="bottom"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={(value) => typeof value === 'number' ? value.toLocaleString() : String(value ?? '')}
                />
              </Line>
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
