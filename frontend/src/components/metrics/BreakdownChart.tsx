/**
 * BreakdownChart - Recharts wrapper for displaying breakdown data.
 *
 * Supports drill-down: click a bar/segment to show matching campers.
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
  LabelList,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import type { DrilldownFilter } from '../../types/metrics';

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
  /** Optional ID for drill-down (e.g., session_cm_id) */
  id?: string | number;
  [key: string]: string | number | undefined;
}

interface BreakdownChartProps {
  data: ChartData[];
  title: string;
  type?: 'bar' | 'pie';
  height?: number;
  showPercentage?: boolean;
  className?: string;
  /** Type of breakdown for drill-down (e.g., 'gender', 'grade', 'session') */
  breakdownType?: DrilldownFilter['type'];
  /** Callback when a bar/segment is clicked */
  onSegmentClick?: (filter: DrilldownFilter) => void;
}

export function BreakdownChart({
  data,
  title,
  type = 'bar',
  height = 300,
  showPercentage = false,
  className = '',
  breakdownType,
  onSegmentClick,
}: BreakdownChartProps) {
  const isClickable = !!onSegmentClick && !!breakdownType;

  const handleClick = (item: ChartData) => {
    if (!onSegmentClick || !breakdownType) return;

    // Use id if available (e.g., session_cm_id), otherwise use name
    const value = item.id !== undefined ? String(item.id) : item.name;

    onSegmentClick({
      type: breakdownType,
      value,
      label: item.name,
    });
  };
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
                const item = props.payload as ChartData;
                const pct = item.percentage;
                const count = item.value;
                const labelName = props.name ?? '';
                // Show count always, percentage conditionally
                if (showPercentage && pct !== undefined) {
                  return `${labelName}: ${count} (${pct.toFixed(0)}%)`;
                }
                return `${labelName}: ${count}`;
              }}
              labelLine={false}
              onClick={(_, index) => {
                const item = data[index];
                if (item) handleClick(item);
              }}
              style={{ cursor: isClickable ? 'pointer' : undefined }}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length] ?? '#00b36b'} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" className="text-xs" />
            <YAxis
              type="category"
              dataKey="name"
              className="text-xs"
              width={130}
              tick={{ fill: 'hsl(var(--muted-foreground))', style: { whiteSpace: 'nowrap' } }}
              tickFormatter={(value: string) => value.length > 18 ? `${value.slice(0, 16)}…` : value}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="value"
              fill={COLORS[0]}
              radius={[0, 4, 4, 0]}
              onClick={(barData) => {
                // barData contains the original data item properties
                const item = barData as unknown as ChartData;
                if (item?.name) handleClick(item);
              }}
              style={{ cursor: isClickable ? 'pointer' : undefined }}
            >
              <LabelList
                dataKey="value"
                position="right"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
              />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
