/**
 * CancellationBySessionChart - Horizontal stacked bar chart showing
 * was_enrolled vs was_waitlisted breakdown for cancelled campers per session.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import type { CancellationSessionBreakdown, DrilldownFilter } from '../../types/metrics'

const WAS_ENROLLED_COLOR = 'hsl(200, 70%, 50%)' // Blue
const WAS_WAITLISTED_COLOR = 'hsl(42, 92%, 50%)' // Amber

interface CancellationBySessionChartProps {
  data: CancellationSessionBreakdown[]
  title?: string
  height?: number
  onBarClick?: (filter: DrilldownFilter) => void
}

interface ChartDataItem {
  name: string
  session_cm_id: number
  total: number
  was_enrolled: number
  was_waitlisted: number
}

export function CancellationBySessionChart({
  data,
  title = 'Cancellations by Session',
  height = 300,
  onBarClick,
}: CancellationBySessionChartProps) {
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

  const chartData: ChartDataItem[] = data.map((item) => ({
    name: item.session_name,
    session_cm_id: item.session_cm_id,
    total: item.total_cancelled,
    was_enrolled: item.was_enrolled,
    was_waitlisted: item.was_waitlisted,
  }))

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: Array<{
      name: string
      value: number
      color: string
      dataKey: string
    }>
    label?: string
  }) => {
    if (active && payload && payload.length) {
      const nonZero = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
      if (nonZero.length === 0) return null

      const total = nonZero.reduce((sum, p) => sum + (p.value || 0), 0)
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground mb-2 font-medium">{label}</p>
          {nonZero.map((p, idx) => (
            <p key={idx} className="text-muted-foreground text-sm">
              <span style={{ color: p.color }}>{p.name}:</span>{' '}
              <span className="text-foreground font-semibold">
                {p.value} ({total > 0 ? ((p.value / total) * 100).toFixed(0) : 0}%)
              </span>
            </p>
          ))}
          <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-sm">
            Total: <span className="text-foreground font-semibold">{total}</span>
          </p>
        </div>
      )
    }
    return null
  }

  const handleBarClick = (barData: ChartDataItem) => {
    if (!onBarClick || !barData) return
    onBarClick({
      type: 'cancellation_total',
      value: String(barData.session_cm_id),
      label: barData.name,
    })
  }

  const dynamicHeight = Math.max(height, chartData.length * 45)

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={dynamicHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 40, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            width={140}
            interval={0}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="was_enrolled"
            name="Was Enrolled"
            stackId="cancellation"
            fill={WAS_ENROLLED_COLOR}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={(data) => {
              if (data) handleBarClick(data as unknown as ChartDataItem)
            }}
          />
          <Bar
            dataKey="was_waitlisted"
            name="Was Waitlisted"
            stackId="cancellation"
            fill={WAS_WAITLISTED_COLOR}
            radius={[0, 4, 4, 0]}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={(data) => {
              if (data) handleBarClick(data as unknown as ChartDataItem)
            }}
          >
            <LabelList
              dataKey="total"
              position="right"
              offset={8}
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: WAS_ENROLLED_COLOR }}
          />
          <span className="text-muted-foreground text-sm">Was Enrolled</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: WAS_WAITLISTED_COLOR }}
          />
          <span className="text-muted-foreground text-sm">Was Waitlisted</span>
        </div>
      </div>
    </div>
  )
}
