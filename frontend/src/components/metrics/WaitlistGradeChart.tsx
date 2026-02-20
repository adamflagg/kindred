/**
 * WaitlistGradeChart - Stacked horizontal bar chart showing enrollment
 * split for waitlisted campers per grade.
 *
 * Each bar = one grade. Two segments:
 * - Red: "No Other Sessions" (no_enrollment)
 * - Green: "Has Other Sessions" (has_enrollment)
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
import type { GradeBreakdown, DrilldownFilter } from '../../types/metrics'

const NO_ENROLLMENT_COLOR = 'hsl(0, 70%, 50%)'
const HAS_ENROLLMENT_COLOR = 'hsl(160, 100%, 35%)'

interface WaitlistGradeChartProps {
  data: GradeBreakdown[]
  title?: string
  height?: number
  onBarClick?: (filter: DrilldownFilter) => void
}

interface ChartDataItem {
  name: string
  grade: number | null
  total: number
  no_enrollment: number
  has_enrollment: number
}

export function WaitlistGradeChart({
  data,
  title = 'Grade Distribution',
  height = 300,
  onBarClick,
}: WaitlistGradeChartProps) {
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
    name: item.grade !== null ? `Grade ${item.grade}` : 'Unknown',
    grade: item.grade,
    total: item.count,
    no_enrollment: item.no_enrollment ?? 0,
    has_enrollment: item.has_enrollment ?? 0,
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
      const nonZero = payload.filter((p) => p.value > 0)
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
      type: 'grade',
      value: barData.grade !== null ? String(barData.grade) : 'null',
      label: barData.name,
      statusOverride: ['waitlisted'],
      waitlistContext: true,
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
            width={100}
            interval={0}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="no_enrollment"
            name="No Other Sessions"
            stackId="enrollment"
            fill={NO_ENROLLMENT_COLOR}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={(data) => {
              if (data) handleBarClick(data as unknown as ChartDataItem)
            }}
          />
          <Bar
            dataKey="has_enrollment"
            name="Has Other Sessions"
            stackId="enrollment"
            fill={HAS_ENROLLMENT_COLOR}
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
            style={{ backgroundColor: NO_ENROLLMENT_COLOR }}
          />
          <span className="text-muted-foreground text-sm">No Other Sessions</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: HAS_ENROLLMENT_COLOR }}
          />
          <span className="text-muted-foreground text-sm">Has Other Sessions</span>
        </div>
      </div>
    </div>
  )
}
