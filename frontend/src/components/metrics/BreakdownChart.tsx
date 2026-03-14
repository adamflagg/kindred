/**
 * BreakdownChart - Pie chart for displaying breakdown data.
 *
 * Supports drill-down: click a segment to show matching campers.
 */

import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import type { DrilldownFilter } from '../../types/metrics'
import { ChartCard } from './ChartCard'

const COLORS = [
  'hsl(160, 100%, 35%)', // Primary green
  'hsl(42, 92%, 50%)', // Accent gold
  'hsl(200, 70%, 50%)', // Blue
  'hsl(280, 60%, 50%)', // Purple
  'hsl(350, 70%, 50%)', // Red
  'hsl(100, 60%, 45%)', // Lime
  'hsl(30, 80%, 50%)', // Orange
  'hsl(180, 60%, 45%)', // Teal
]

interface ChartData {
  name: string
  value: number
  percentage?: number
  /** Optional ID for drill-down (e.g., session_cm_id) */
  id?: string | number
  [key: string]: string | number | undefined
}

interface BreakdownChartProps {
  data: ChartData[]
  title: string
  height?: number
  showPercentage?: boolean
  className?: string
  /** Type of breakdown for drill-down (e.g., 'gender', 'grade', 'session') */
  breakdownType?: DrilldownFilter['type']
  /** Callback when a segment is clicked */
  onSegmentClick?: (filter: DrilldownFilter) => void
  /** Optional color map keyed by item name, overrides default palette */
  colorMap?: Record<string, string>
}

export function BreakdownChart({
  data,
  title,
  height = 300,
  showPercentage = false,
  className = '',
  breakdownType,
  onSegmentClick,
  colorMap,
}: BreakdownChartProps) {
  const getColor = (index: number, name?: string) =>
    (name && colorMap?.[name]) ?? COLORS[index % COLORS.length] ?? '#00b36b'

  const isClickable = !!onSegmentClick && !!breakdownType

  const handleClick = (item: ChartData) => {
    if (!onSegmentClick || !breakdownType) return

    // Use id if available (e.g., session_cm_id), otherwise use name
    const value = item.id !== undefined ? String(item.id) : item.name

    onSegmentClick({
      type: breakdownType,
      value,
      label: item.name,
      ...(breakdownType === 'gender' ? { titleFormat: 'adjective' as const } : {}),
    })
  }

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: ChartData }>
  }) => {
    if (active && payload?.length && payload[0]) {
      const item = payload[0].payload
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground font-medium">{item.name}</p>
          <p className="text-muted-foreground text-sm">
            Count: <span className="text-foreground font-semibold">{item.value}</span>
          </p>
          {item.percentage !== undefined && (
            <p className="text-muted-foreground text-sm">
              Percentage:{' '}
              <span className="text-foreground font-semibold">{item.percentage.toFixed(1)}%</span>
            </p>
          )}
        </div>
      )
    }
    return null
  }

  const legendItems = data.map((d, i) => ({
    label: d.name,
    color: getColor(i, d.name),
  }))

  return (
    <ChartCard title={title} className={className} isEmpty={data.length === 0} legend={legendItems}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            startAngle={90}
            endAngle={-270}
            label={(props: PieLabelRenderProps) => {
              const item = props.payload as ChartData
              const pct = item.percentage
              const count = item.value
              const labelName = props.name ?? ''
              let text = `${labelName}: ${count}`
              if (showPercentage && pct !== undefined) {
                text = `${labelName}: ${count} (${pct.toFixed(0)}%)`
              }
              // Position labels to the left/right of the pie, never above/below
              const RADIAN = Math.PI / 180
              const midAngle = Number(props.midAngle)
              const outerR = Number(props.outerRadius)
              const cx = Number(props.cx)
              const cy = Number(props.cy)
              const radius = outerR + 16
              const x = cx + radius * Math.cos(-midAngle * RADIAN)
              const y = cy + radius * Math.sin(-midAngle * RADIAN)
              const isRight = Math.cos(-midAngle * RADIAN) >= 0

              return (
                <text
                  x={x}
                  y={y}
                  textAnchor={isRight ? 'start' : 'end'}
                  dominantBaseline="central"
                  className="text-xs"
                  fill="hsl(var(--foreground))"
                >
                  {text}
                </text>
              )
            }}
            labelLine={false}
            onClick={(_, index) => {
              const item = data[index]
              if (item) handleClick(item)
            }}
            style={{ cursor: isClickable ? 'pointer' : undefined }}
          >
            {data.map((d, index) => (
              <Cell key={`cell-${index}`} fill={getColor(index, d.name)} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
