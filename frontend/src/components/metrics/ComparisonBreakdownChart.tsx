/**
 * ComparisonBreakdownChart - Recharts wrapper with year-over-year comparison support.
 * Extends BreakdownChart to show grouped bars for comparing multiple years.
 */

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LabelList,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';

const COLORS = [
  'hsl(160, 100%, 35%)', // Primary green
  'hsl(42, 92%, 50%)', // Accent gold
  'hsl(200, 70%, 50%)', // Blue
  'hsl(280, 60%, 50%)', // Purple
  'hsl(350, 70%, 50%)', // Red
  'hsl(100, 60%, 45%)', // Lime
  'hsl(30, 80%, 50%)', // Orange
  'hsl(180, 60%, 45%)', // Teal
];

// Colors for comparison years (slightly muted versions)
const COMPARISON_COLORS = [
  'hsl(160, 60%, 50%)', // Primary green (muted)
  'hsl(42, 60%, 60%)', // Accent gold (muted)
  'hsl(200, 50%, 60%)', // Blue (muted)
  'hsl(280, 40%, 60%)', // Purple (muted)
];

interface ChartDataItem {
  name: string;
  value: number;
  percentage?: number;
  [key: string]: string | number | undefined;
}

interface ComparisonBreakdownChartProps {
  data: ChartDataItem[];
  comparisonData: Record<number, ChartDataItem[]> | undefined; // {2024: [...], 2023: [...]}
  title: string;
  type?: 'bar' | 'pie';
  currentYear: number;
  availableComparisonYears?: number[];
  height?: number;
  showPercentage?: boolean;
  className?: string;
}

export function ComparisonBreakdownChart({
  data,
  comparisonData,
  title,
  type = 'bar',
  currentYear,
  availableComparisonYears = [],
  height = 300,
  showPercentage = false,
  className = '',
}: ComparisonBreakdownChartProps) {
  const [activeComparisonYear, setActiveComparisonYear] = useState<number | null>(null);

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

  // Merge comparison data with primary data for grouped bars
  const mergedData = data.map((item) => {
    const result: ChartDataItem = { ...item };
    if (activeComparisonYear && comparisonData?.[activeComparisonYear]) {
      const compareItem = comparisonData[activeComparisonYear].find(c => c.name === item.name);
      if (compareItem) {
        result[`value_${activeComparisonYear}`] = compareItem.value;
        result[`percentage_${activeComparisonYear}`] = compareItem.percentage;
      }
    }
    return result;
  });

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartDataItem; dataKey: string }> }) => {
    if (active && payload && payload.length && payload[0]) {
      const item = payload[0].payload;
      const currentPct = item.percentage;
      const comparePct = activeComparisonYear ? item[`percentage_${activeComparisonYear}`] as number | undefined : undefined;
      const compareValue = activeComparisonYear ? item[`value_${activeComparisonYear}`] as number | undefined : undefined;

      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground">{item.name}</p>
          <p className="text-sm text-muted-foreground">
            {currentYear}: <span className="font-semibold text-foreground">{item.value}</span>
            {currentPct !== undefined && <span className="text-muted-foreground"> ({currentPct.toFixed(1)}%)</span>}
          </p>
          {activeComparisonYear && compareValue !== undefined && (
            <p className="text-sm text-muted-foreground">
              {activeComparisonYear}: <span className="font-semibold text-foreground">{compareValue}</span>
              {comparePct !== undefined && <span className="text-muted-foreground"> ({comparePct.toFixed(1)}%)</span>}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {availableComparisonYears.length > 0 && (
          <select
            value={activeComparisonYear ?? ''}
            onChange={(e) => setActiveComparisonYear(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground"
          >
            <option value="">No comparison</option>
            {availableComparisonYears.map(year => (
              <option key={year} value={year}>Compare: {year}</option>
            ))}
          </select>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        {type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={(props: PieLabelRenderProps) => {
                const item = props.payload as ChartDataItem;
                const pct = item.percentage;
                const count = item.value;
                const labelName = props.name ?? '';
                const comparePct = activeComparisonYear && comparisonData?.[activeComparisonYear]
                  ? comparisonData[activeComparisonYear].find(c => c.name === labelName)?.percentage
                  : undefined;

                // Show count always, percentage conditionally
                let label = `${labelName}: ${count}`;
                if (showPercentage && pct !== undefined) {
                  label = `${labelName}: ${count} (${pct.toFixed(0)}%)`;
                  if (comparePct !== undefined) {
                    const delta = pct - comparePct;
                    const sign = delta >= 0 ? '+' : '';
                    label += ` [${sign}${delta.toFixed(0)}%]`;
                  }
                }
                return label;
              }}
              labelLine={false}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length] ?? '#00b36b'} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        ) : (
          <BarChart data={mergedData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" className="text-xs" />
            <YAxis
              type="category"
              dataKey="name"
              className="text-xs"
              width={130}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(value: string) => value.length > 18 ? `${value.slice(0, 16)}...` : value}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" name={String(currentYear)} fill={COLORS[0]} radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="value"
                position="right"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
              />
            </Bar>
            {activeComparisonYear && (
              <Bar
                dataKey={`value_${activeComparisonYear}`}
                name={String(activeComparisonYear)}
                fill={COMPARISON_COLORS[0]}
                radius={[0, 4, 4, 0]}
              />
            )}
            {activeComparisonYear && <Legend />}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
