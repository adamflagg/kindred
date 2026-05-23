/**
 * RetentionRateLine - Line chart showing retention rate trend over multiple years.
 *
 * Displays overall retention rate trajectory across year transitions.
 * Uses ChartCard for standardized HTML-rendered axes with Recharts SVG content.
 */

import type { ReactNode } from 'react'
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
import { ChartCard } from './ChartCard'
import { calculateVerticalLayout } from './cssChartUtils'

interface RetentionRateLineProps {
  data: RetentionTrendYear[]
  title?: string
  headerRight?: ReactNode
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
  headerRight,
  height = 250,
  className = '',
}: RetentionRateLineProps) {
  // Transform data for line chart - show base year on X-axis (tooltip shows full transition)
  const chartData: ChartDataItem[] = data.map((year) => ({
    name: year.from_year.toString(),
    transition: `${year.from_year} → ${year.to_year}`,
    retentionRate: Math.round(year.retention_rate * 100),
    baseCount: year.base_count,
    returnedCount: year.returned_count,
  }))

  const { barsHeight, drawingHeight } = calculateVerticalLayout(height)
  const ticks = [0, 20, 40, 60, 80, 100]
  const axisMax = 100

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: ChartDataItem }>
  }) => {
    if (active && payload?.length && payload[0]) {
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
    <ChartCard
      isEmpty={data.length === 0}
      title={title}
      headerRight={headerRight}
      className={className}
      yAxis={{ ticks, axisMax, drawingHeight, barsHeight, formatTick: (v) => `${v}%` }}
      xLabels={chartData.map((d) => d.name)}
      xAxisEdgeAligned
      xAxisRightPadding={20}
    >
      <ResponsiveContainer width="100%" height={barsHeight}>
        <LineChart
          data={chartData}
          margin={{ top: 16, right: 20, left: 0, bottom: 0 }}
          style={{ overflow: 'visible' }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis hide height={0} dataKey="name" />
          <YAxis hide width={0} domain={[0, 100]} ticks={ticks} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
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
    </ChartCard>
  )
}
