/**
 * SessionLengthBySessionChart - Stacked bar chart showing session breakdown per length category.
 *
 * Displays individual session counts for each length category (1-week, 2-week, etc.),
 * enabling comparison of session distribution across length categories.
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
import type { SessionLengthBySessionBreakdown } from '../../types/metrics'
import type { SessionDateLookup, SessionTypeLookup } from '../../utils/sessionUtils'
import { compareByDateCampThenQuest } from '../../utils/sessionUtils'

// Color palette for sessions (cycles if more than 8 sessions)
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

interface SessionLengthBySessionChartProps {
  data: SessionLengthBySessionBreakdown[]
  title?: string
  height?: number
  className?: string
  /** Callback when a length category bar is clicked */
  onCategoryClick?: (lengthCategory: string) => void
  /** Lookup map for session dates (for chronological sorting) */
  sessionDateLookup?: SessionDateLookup
  /** Lookup map for session types (for camp-then-quest sorting) */
  sessionTypeLookup?: SessionTypeLookup
}

interface ChartDataItem {
  name: string
  total: number
  [sessionKey: string]: string | number
}

export function SessionLengthBySessionChart({
  data,
  title = 'Enrollment by Session Length',
  height = 300,
  className = '',
  onCategoryClick,
  sessionDateLookup = {},
  sessionTypeLookup = {},
}: SessionLengthBySessionChartProps) {
  if (data.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  // Collect all unique sessions across all length categories
  const allSessions = new Map<number, string>()
  for (const item of data) {
    for (const session of item.sessions) {
      allSessions.set(session.session_cm_id, session.session_name)
    }
  }
  // Sort sessions: camp first, then quests, chronological within each group
  const sessionList = Array.from(allSessions.entries()).sort((a, b) =>
    compareByDateCampThenQuest(a[1], b[1], sessionDateLookup, sessionTypeLookup)
  )
  // Reversed for Recharts stacking: first <Bar> = bottom of stack.
  // Quest first (bottom) → camp last (top) gives camp-on-top visual.
  const reversedSessionList = [...sessionList].reverse()

  // Transform data for stacked bar chart
  const chartData: ChartDataItem[] = data.map((item) => {
    const point: ChartDataItem = {
      name: item.length_category,
      total: item.total,
    }

    // Add count for each session (default 0 if not present)
    for (const [sessionId] of sessionList) {
      const sessionData = item.sessions.find((s) => s.session_cm_id === sessionId)
      point[`session_${sessionId}`] = sessionData?.count || 0
    }

    return point
  })

  // Build session color map
  const sessionColors = new Map<string, string>()
  sessionList.forEach(([sessionId], index) => {
    sessionColors.set(`session_${sessionId}`, COLORS[index % COLORS.length] ?? '#00b36b')
  })

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
      // Filter out zero values and reverse to show camp-first order
      // (Recharts passes payload in <Bar> order which is quest-first after reversal)
      const nonZeroPayload = payload.filter((p) => p.value > 0).reverse()

      if (nonZeroPayload.length === 0) return null

      const total = nonZeroPayload.reduce((sum, p) => sum + (p.value || 0), 0)
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground mb-2 font-medium">{label}</p>
          {nonZeroPayload.map((p, idx) => (
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

  // Last rendered <Bar> = topmost bar = last in reversedSessionList = last camp session
  const lastSessionKey =
    reversedSessionList.length > 0
      ? `session_${reversedSessionList[reversedSessionList.length - 1]?.[0]}`
      : null

  const needsRotation = chartData.length > 3
  const isCompactLegend = sessionList.length > 6

  // Custom tick that renders rotated text entirely below the axis line
  const RotatedTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
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

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height - 30}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            interval={0}
            tick={
              needsRotation
                ? (RotatedTick as unknown as React.SVGProps<SVGTextElement>)
                : { fill: 'hsl(var(--muted-foreground))' }
            }
            height={needsRotation ? 80 : 30}
          />
          <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip content={<CustomTooltip />} />
          {reversedSessionList.map(([sessionId, sessionName], index) => {
            const dataKey = `session_${sessionId}`
            const isLast = index === reversedSessionList.length - 1
            return (
              <Bar
                key={dataKey}
                dataKey={dataKey}
                name={sessionName}
                stackId="sessions"
                fill={sessionColors.get(dataKey)}
                radius={isLast ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                cursor={onCategoryClick ? 'pointer' : undefined}
                onClick={(data) => {
                  if (onCategoryClick && data?.name) {
                    onCategoryClick(data.name as string)
                  }
                }}
              >
                {isLast && lastSessionKey && (
                  <LabelList
                    dataKey="total"
                    position="top"
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
      {/* Legend outside ResponsiveContainer to preserve chart height */}
      <div
        className={`mt-2 flex flex-wrap justify-center ${isCompactLegend ? 'gap-x-6 gap-y-1' : 'gap-4'}`}
      >
        {sessionList.map(([sessionId, sessionName], index) => (
          <div key={sessionId} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{
                backgroundColor:
                  sessionColors.get(`session_${sessionId}`) ??
                  COLORS[index % COLORS.length] ??
                  '#00b36b',
              }}
            />
            <span
              data-testid="legend-label"
              className={`text-muted-foreground ${isCompactLegend ? 'text-xs' : 'text-sm'}`}
            >
              {sessionName}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
