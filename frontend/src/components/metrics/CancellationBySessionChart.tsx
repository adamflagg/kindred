/**
 * CancellationBySessionChart - Horizontal stacked bar chart showing
 * prior status breakdown for cancelled campers per session.
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
const WAS_APPLIED_COLOR = 'hsl(280, 60%, 55%)' // Purple
const OTHER_PRIOR_COLOR = 'hsl(200, 15%, 55%)' // Gray-blue
const UNKNOWN_COLOR = 'hsl(0, 0%, 75%)' // Light gray

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
  was_applied: number
  other_prior_status: number
  unknown: number
}

// Segment definitions in render order (first = leftmost in stacked bar)
const SEGMENTS = [
  { key: 'was_enrolled', label: 'Was Enrolled', color: WAS_ENROLLED_COLOR },
  { key: 'was_waitlisted', label: 'Was Waitlisted', color: WAS_WAITLISTED_COLOR },
  { key: 'was_applied', label: 'Was Applied', color: WAS_APPLIED_COLOR },
  { key: 'other_prior_status', label: 'Other Prior Status', color: OTHER_PRIOR_COLOR },
  { key: 'unknown', label: 'Unknown', color: UNKNOWN_COLOR },
] as const

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

  const chartData: ChartDataItem[] = data.map((item) => {
    const known =
      item.was_enrolled +
      item.was_waitlisted +
      (item.was_applied ?? 0) +
      (item.other_prior_status ?? 0)
    return {
      name: item.session_name,
      session_cm_id: item.session_cm_id,
      total: item.total_cancelled,
      was_enrolled: item.was_enrolled,
      was_waitlisted: item.was_waitlisted,
      was_applied: item.was_applied ?? 0,
      other_prior_status: item.other_prior_status ?? 0,
      unknown: Math.max(0, item.total_cancelled - known),
    }
  })

  // Determine which segments have data (any item with non-zero value)
  const activeSegments = SEGMENTS.filter((seg) =>
    chartData.some((d) => (d[seg.key as keyof ChartDataItem] as number) > 0)
  )

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
      payload: ChartDataItem
    }>
    label?: string
  }) => {
    if (active && payload && payload.length) {
      const nonZero = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
      if (nonZero.length === 0) return null

      const total = nonZero[0]?.payload?.total ?? 0
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
          {activeSegments.map((seg, idx) => {
            const isLast = idx === activeSegments.length - 1
            return (
              <Bar
                key={seg.key}
                dataKey={seg.key}
                name={seg.label}
                stackId="cancellation"
                fill={seg.color}
                {...(isLast ? { radius: [0, 4, 4, 0] as [number, number, number, number] } : {})}
                cursor={onBarClick ? 'pointer' : undefined}
                onClick={(data) => {
                  if (data) handleBarClick(data as unknown as ChartDataItem)
                }}
              >
                {isLast && (
                  <LabelList
                    dataKey="total"
                    position="right"
                    offset={8}
                    className="text-xs"
                    fill="hsl(var(--muted-foreground))"
                  />
                )}
              </Bar>
            )
          })}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {activeSegments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-muted-foreground text-sm">{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
