/**
 * BreakdownChart - Recharts wrapper for displaying breakdown data.
 */

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

interface ChartData {
  name: string;
  value: number;
  percentage?: number;
  [key: string]: string | number | undefined;
}

interface BreakdownChartProps {
  data: ChartData[];
  title: string;
  type?: 'bar' | 'pie';
  height?: number;
  showPercentage?: boolean;
  className?: string;
}

export function BreakdownChart({
  data,
  title,
  type = 'bar',
  height = 300,
  showPercentage = false,
  className = '',
}: BreakdownChartProps) {
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

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartData }> }) => {
    if (active && payload && payload.length && payload[0]) {
      const item = payload[0].payload;
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-foreground">{item.name}</p>
          <p className="text-sm text-muted-foreground">
            Count: <span className="font-semibold text-foreground">{item.value}</span>
          </p>
          {item.percentage !== undefined && (
            <p className="text-sm text-muted-foreground">
              Percentage: <span className="font-semibold text-foreground">{item.percentage.toFixed(1)}%</span>
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
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
                const pct = (props.payload as ChartData).percentage;
                const labelName = props.name ?? '';
                return showPercentage && pct !== undefined
                  ? `${labelName} (${pct.toFixed(0)}%)`
                  : labelName;
              }}
              labelLine={false}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" className="text-xs" />
            <YAxis
              type="category"
              dataKey="name"
              className="text-xs"
              width={90}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
