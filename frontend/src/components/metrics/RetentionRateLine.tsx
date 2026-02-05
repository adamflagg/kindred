/**
 * RetentionRateLine - Line chart showing retention rate trend over multiple years.
 *
 * Displays overall retention rate trajectory across year transitions.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from 'recharts'
import type { RetentionTrendYear } from '../../types/metrics'

interface RetentionRateLineProps {
  data: RetentionTrendYear[]
  title?: string
  height?: number
  className?: string
}

interface ChartDataItem {
  name: string
  transition: string
  retentionRate: number
  baseCount: number
  returnedCount: number
}

export function RetentionRateLine({
  data,
  title = 'Retention Rate Trend',
  height = 250,
  className = '',
}: RetentionRateLineProps) {
  if (data.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  // Transform data for line chart - show base year on X-axis (tooltip shows full transition)
  const chartData: ChartDataItem[] = data.map((year) => ({
    name: year.from_year.toString(),
    transition: `${year.from_year} → ${year.to_year}`,
    retentionRate: Math.round(year.retention_rate * 100),
    baseCount: year.base_count,
    returnedCount: year.returned_count,
  }))

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: ChartDataItem }>
  }) => {
    if (active && payload && payload.length && payload[0]) {
      const item = payload[0].payload
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground mb-1 font-medium">{item.transition}</p>
          <p className="text-muted-foreground text-sm">
            Retention Rate:{' '}
            <span className="text-primary font-semibold">{item.retentionRate}%</span>
          </p>
          <p className="text-muted-foreground text-sm">
            Returned: {item.returnedCount} of {item.baseCount}
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
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
          {/* Reference line at 50% */}
          <ReferenceLine
            y={50}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="3 3"
            label={{
              value: '50%',
              position: 'left',
              fill: 'hsl(var(--muted-foreground))',
            }}
          />
          <Line
            type="monotone"
            dataKey="retentionRate"
            stroke="hsl(160, 100%, 35%)"
            strokeWidth={3}
            dot={{ fill: 'hsl(160, 100%, 35%)', r: 6 }}
            activeDot={{ r: 8 }}
          >
            <LabelList
              dataKey="retentionRate"
              position="top"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
              formatter={(value) => `${value}%`}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
