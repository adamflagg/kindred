/**
 * RetentionRateLineChart - Line/dot chart for retention rates across numeric categories.
 *
 * Best for ordered numeric categories (grade, summers at camp, first summer year)
 * where the x-axis progression matters. Data is always sorted by name (natural order).
 * Uses ChartCard for standardized HTML-rendered axes with Recharts SVG content.
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
import type { RetentionRateBarItem } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { calculateVerticalLayout } from './cssChartUtils'

interface RetentionRateLineChartProps {
  data: RetentionRateBarItem[]
  title: string
  height?: number
  tooltipLabelPrefix?: string
  onDotClick?: (item: RetentionRateBarItem) => void
}

interface ChartItem {
  name: string
  rate: number
  baseCount: number
  returnedCount: number
  id?: string | number | undefined
}

export function RetentionRateLineChart({
  data,
  title,
  height = 250,
  tooltipLabelPrefix,
  onDotClick,
}: RetentionRateLineChartProps) {
  // Always sort by name for line charts (x-axis must be ordered)
  const sorted = sortRetentionBarData(data, 'name')

  const chartData: ChartItem[] = sorted.map((d) => ({
    name: d.name,
    rate: Math.round(d.retentionRate * 100),
    baseCount: d.baseCount,
    returnedCount: d.returnedCount,
    id: d.id,
  }))

  // Compute layout for ChartCard
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height)
  const ticks = [0, 20, 40, 60, 80, 100]
  const axisMax = 100

  // Handle activeDot click: map chart item back to original RetentionRateBarItem
  const handleDotClick = onDotClick
    ? (props: { payload?: ChartItem }) => {
        if (!props.payload) return
        const payloadName = props.payload.name
        const original = sorted.find((d) => d.name === payloadName)
        if (original) onDotClick(original)
      }
    : undefined

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
    <ChartCard
      title={title}
      isEmpty={data.length === 0}
      yAxis={{
        ticks,
        axisMax,
        drawingHeight,
        barsHeight,
        formatTick: (v: number) => `${v}%`,
      }}
      xLabels={chartData.map((d) => d.name)}
      xAxisEdgeAligned
      xAxisRightPadding={20}
    >
      <ResponsiveContainer width="100%" height="100%">
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
            dataKey="rate"
            stroke="hsl(160, 100%, 35%)"
            strokeWidth={2.5}
            dot={{ fill: 'hsl(160, 100%, 35%)', r: 5 }}
            activeDot={
              handleDotClick
                ? { r: 7, onClick: handleDotClick, style: { cursor: 'pointer' } }
                : { r: 7 }
            }
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
    </ChartCard>
  )
}
