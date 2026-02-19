/**
 * RetentionRateBarChart - Horizontal bar chart showing retention rates by category.
 *
 * Displays retention rates as horizontal bars with conditional coloring:
 * green (>=60%), amber (40-60%), red (<40%).
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts'
import { sortRetentionBarData, type RetentionSortBy } from '../../utils/retentionTransforms'

export interface RetentionRateBarItem {
  name: string
  retentionRate: number // 0-1
  baseCount: number
  returnedCount: number
  id?: string | number // Optional identifier for drilldown (e.g., session_cm_id, grade number)
}

interface RetentionRateBarChartProps {
  data: RetentionRateBarItem[]
  title: string
  topN?: number
  height?: number
  sortBy?: RetentionSortBy
  layout?: 'horizontal' | 'vertical' // 'horizontal' = horizontal bars (default), 'vertical' = vertical bars
  showCounts?: boolean // When true, labels show "75% (30/40)" instead of "75%"
  onBarClick?: (item: RetentionRateBarItem) => void
}

function getBarColor(rate: number): string {
  if (rate >= 0.6) return 'hsl(160, 100%, 35%)' // Green
  if (rate >= 0.4) return 'hsl(42, 92%, 50%)' // Amber/Gold
  return 'hsl(350, 70%, 50%)' // Red
}

interface ChartItem {
  name: string
  rate: number
  rateLabel: string
  baseCount: number
  returnedCount: number
  id?: string | number | undefined
}

const RotatedTick = ({
  x,
  y,
  payload,
}: {
  x: string | number
  y: string | number
  payload: { value: string }
}) => (
  <g transform={`translate(${x},${y})`}>
    <text
      x={0}
      y={0}
      dy={12}
      textAnchor="end"
      fill="hsl(var(--muted-foreground))"
      fontSize={12}
      transform="rotate(-40)"
    >
      {payload.value.length > 16 ? `${payload.value.slice(0, 14)}…` : payload.value}
    </text>
  </g>
)

export function RetentionRateBarChart({
  data,
  title,
  topN,
  height,
  sortBy = 'rate',
  layout = 'horizontal',
  showCounts = false,
  onBarClick,
}: RetentionRateBarChartProps) {
  if (data.length === 0) {
    return (
      <div className="card-lodge p-4">
        <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  const sorted = sortRetentionBarData(data, sortBy, topN)

  const chartData: ChartItem[] = sorted.map((d) => {
    const rate = Math.round(d.retentionRate * 100)
    return {
      name: d.name,
      rate,
      rateLabel: showCounts ? `${rate}% (${d.returnedCount}/${d.baseCount})` : `${rate}%`,
      baseCount: d.baseCount,
      returnedCount: d.returnedCount,
      id: d.id,
    }
  })

  // Map chart items back to original RetentionRateBarItem for click callback
  const barClickProps = onBarClick
    ? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick: (chartItem: any) => {
          const original = sorted.find((d: RetentionRateBarItem) => d.name === chartItem.name)
          if (original) onBarClick(original)
        },
        style: { cursor: 'pointer' as const },
      }
    : {}

  const chartHeight =
    height ?? (layout === 'vertical' ? 300 : Math.max(200, chartData.length * 32 + 60))

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
          <p className="text-foreground font-medium">{item.name}</p>
          <p className="text-muted-foreground text-sm">
            Retention: <span className="text-foreground font-semibold">{item.rate}%</span>
          </p>
          <p className="text-muted-foreground text-sm">
            {item.returnedCount} of {item.baseCount} returned
          </p>
        </div>
      )
    }
    return null
  }

  if (layout === 'vertical') {
    return (
      <div className="card-lodge p-4">
        <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" className="text-xs" interval={0} tick={RotatedTick} />
            <YAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="rate" radius={[4, 4, 0, 0]} {...barClickProps}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={getBarColor(entry.rate / 100)} />
              ))}
              <LabelList
                dataKey="rateLabel"
                position="top"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: showCounts ? 110 : 50, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            className="text-xs"
            width={150}
            interval={0}
            tick={{
              fill: 'hsl(var(--muted-foreground))',
              style: { whiteSpace: 'nowrap' },
            }}
            tickFormatter={(value: string) =>
              value.length > 20 ? `${value.slice(0, 18)}…` : value
            }
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="rate" radius={[0, 4, 4, 0]} {...barClickProps}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={getBarColor(entry.rate / 100)} />
            ))}
            <LabelList
              dataKey="rateLabel"
              position="right"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
