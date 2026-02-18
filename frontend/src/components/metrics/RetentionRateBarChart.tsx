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

export interface RetentionRateBarItem {
  name: string
  retentionRate: number // 0-1
  baseCount: number
  returnedCount: number
}

interface RetentionRateBarChartProps {
  data: RetentionRateBarItem[]
  title: string
  topN?: number
  height?: number
  sortBy?: 'rate' | 'count'
}

function getBarColor(rate: number): string {
  if (rate >= 0.6) return 'hsl(160, 100%, 35%)' // Green
  if (rate >= 0.4) return 'hsl(42, 92%, 50%)' // Amber/Gold
  return 'hsl(350, 70%, 50%)' // Red
}

interface ChartItem {
  name: string
  rate: number
  baseCount: number
  returnedCount: number
}

export function RetentionRateBarChart({
  data,
  title,
  topN,
  height,
  sortBy = 'rate',
}: RetentionRateBarChartProps) {
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

  // Sort and limit
  let sorted = [...data]
  if (sortBy === 'rate') {
    sorted.sort((a, b) => b.retentionRate - a.retentionRate)
  } else {
    sorted.sort((a, b) => b.baseCount - a.baseCount)
  }
  if (topN) {
    sorted = sorted.slice(0, topN)
  }

  const chartData: ChartItem[] = sorted.map((d) => ({
    name: d.name,
    rate: Math.round(d.retentionRate * 100),
    baseCount: d.baseCount,
    returnedCount: d.returnedCount,
  }))

  const chartHeight = height ?? Math.max(200, chartData.length * 32 + 60)

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

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 50, left: 0, bottom: 5 }}
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
          <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={getBarColor(entry.rate / 100)} />
            ))}
            <LabelList
              dataKey="rate"
              position="right"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
              formatter={(value) => `${value}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
