/**
 * RetentionRateLineChart - Line/dot chart for retention rates across numeric categories.
 *
 * Best for ordered numeric categories (grade, summers at camp, first summer year)
 * where the x-axis progression matters. Data is always sorted by name (natural order).
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
import { sortRetentionBarData } from '../../utils/retentionTransforms'
import type { RetentionRateBarItem } from './RetentionRateBarChart'

interface RetentionRateLineChartProps {
  data: RetentionRateBarItem[]
  title: string
  height?: number
  tooltipLabelPrefix?: string
}

interface ChartItem {
  name: string
  rate: number
  baseCount: number
  returnedCount: number
}

export function RetentionRateLineChart({
  data,
  title,
  height = 250,
  tooltipLabelPrefix,
}: RetentionRateLineChartProps) {
  if (data.length === 0) {
    return (
      <div className="card-lodge p-4">
        <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  // Always sort by name for line charts (x-axis must be ordered)
  const sorted = sortRetentionBarData(data, 'name')

  const chartData: ChartItem[] = sorted.map((d) => ({
    name: d.name,
    rate: Math.round(d.retentionRate * 100),
    baseCount: d.baseCount,
    returnedCount: d.returnedCount,
  }))

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: ChartItem }>
  }) => {
    if (active && payload && payload.length && payload[0]) {
      const item = payload[0].payload
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground font-medium">
            {tooltipLabelPrefix ? `${tooltipLabelPrefix}${item.name}` : item.name}
          </p>
          <p className="text-muted-foreground text-sm">
            Retention: <span className="text-primary font-semibold">{item.rate}%</span>
          </p>
          <p className="text-muted-foreground text-sm">
            {item.returnedCount} of {item.baseCount} returned
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            interval={0}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="hsl(160, 100%, 35%)"
            strokeWidth={2.5}
            dot={{ fill: 'hsl(160, 100%, 35%)', r: 5 }}
            activeDot={{ r: 7 }}
          >
            <LabelList
              dataKey="rate"
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
