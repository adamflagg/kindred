/**
 * WaitlistBySessionChart - Stacked bar chart showing enrollment breakdown
 * for waitlisted campers per session.
 *
 * Each bar represents a waitlisted session. Segments show:
 * - "No Enrollment" (red) - waitlisted with no other enrolled sessions
 * - Individual enrolled session names (dynamic colors)
 *
 * Follows the same dynamic-key stacked bar pattern as SessionLengthBySessionChart.
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
import type { WaitlistSessionBreakdown, DrilldownFilter } from '../../types/metrics'
import type { SessionDateLookup, SessionTypeLookup } from '../../utils/sessionUtils'
import { compareByDateCampThenQuest } from '../../utils/sessionUtils'

const NO_ENROLLMENT_COLOR = 'hsl(0, 70%, 50%)'

// Color palette for enrolled sessions (cycles if more than 8)
const COLORS = [
  'hsl(160, 100%, 35%)', // Green
  'hsl(42, 92%, 50%)', // Gold
  'hsl(200, 70%, 50%)', // Blue
  'hsl(280, 60%, 50%)', // Purple
  'hsl(100, 60%, 45%)', // Lime
  'hsl(30, 80%, 50%)', // Orange
  'hsl(180, 60%, 45%)', // Teal
  'hsl(350, 70%, 50%)', // Red-pink
]

interface WaitlistBySessionChartProps {
  data: WaitlistSessionBreakdown[]
  title?: string
  height?: number
  onBarClick?: (filter: DrilldownFilter) => void
  /** Lookup map for session dates (for chronological sorting of legend) */
  sessionDateLookup?: SessionDateLookup
  /** Lookup map for session types (for camp-then-quest sorting of legend) */
  sessionTypeLookup?: SessionTypeLookup
}

interface ChartDataItem {
  name: string
  session_cm_id: number
  total: number
  no_enrollment: number
  [key: string]: string | number
}

export function WaitlistBySessionChart({
  data,
  title = 'Waitlist by Session',
  height = 300,
  onBarClick,
  sessionDateLookup = {},
  sessionTypeLookup = {},
}: WaitlistBySessionChartProps) {
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

  // Collect all unique enrolled-in sessions across all waitlisted sessions
  const enrolledSessions = new Map<number, string>()
  for (const item of data) {
    for (const enrolled of item.enrolled_in || []) {
      enrolledSessions.set(enrolled.session_cm_id, enrolled.session_name)
    }
  }
  const enrolledSessionList = Array.from(enrolledSessions.entries()).sort((a, b) =>
    compareByDateCampThenQuest(a[1], b[1], sessionDateLookup, sessionTypeLookup)
  )

  // Transform data for stacked bar chart
  const chartData: ChartDataItem[] = data.map((item) => {
    const point: ChartDataItem = {
      name: item.session_name,
      session_cm_id: item.session_cm_id,
      total: item.no_enrollment + item.has_enrollment,
      no_enrollment: item.no_enrollment,
    }

    // Add count for each enrolled-in session
    for (const [sessionId] of enrolledSessionList) {
      const enrolled = (item.enrolled_in || []).find((e) => e.session_cm_id === sessionId)
      point[`session_${sessionId}`] = enrolled?.count || 0
    }

    return point
  })

  // Build color map for enrolled sessions
  const sessionColors = new Map<string, string>()
  enrolledSessionList.forEach(([sessionId], index) => {
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
      const nonZeroPayload = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
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

  // Determine which Bar gets the LabelList (the last stacked segment)
  const hasEnrolledSessions = enrolledSessionList.length > 0
  const lastEnrolledKey = hasEnrolledSessions
    ? `session_${enrolledSessionList[enrolledSessionList.length - 1]?.[0]}`
    : null

  const handleBarClick = (barData: ChartDataItem) => {
    if (!onBarClick || !barData) return
    onBarClick({
      type: 'session',
      value: String(barData.session_cm_id),
      label: barData.name,
      statusOverride: ['waitlisted'],
    })
  }

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* No Enrollment segment (always first, red) */}
          <Bar
            dataKey="no_enrollment"
            name="No Enrollment"
            stackId="waitlist"
            fill={NO_ENROLLMENT_COLOR}
            radius={!hasEnrolledSessions ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={(data) => {
              if (data) handleBarClick(data as unknown as ChartDataItem)
            }}
          >
            {/* Show label on top if no enrolled sessions */}
            {!hasEnrolledSessions && (
              <LabelList
                dataKey="total"
                position="top"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
              />
            )}
          </Bar>
          {/* Enrolled session segments (dynamic) */}
          {enrolledSessionList.map(([sessionId, sessionName], index) => {
            const dataKey = `session_${sessionId}`
            const isLast = index === enrolledSessionList.length - 1
            return (
              <Bar
                key={dataKey}
                dataKey={dataKey}
                name={sessionName}
                stackId="waitlist"
                fill={sessionColors.get(dataKey)}
                radius={isLast ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                cursor={onBarClick ? 'pointer' : undefined}
                onClick={(data) => {
                  if (data) handleBarClick(data as unknown as ChartDataItem)
                }}
              >
                {isLast && lastEnrolledKey && (
                  <LabelList
                    dataKey="total"
                    position="top"
                    className="text-xs"
                    fill="hsl(var(--muted-foreground))"
                  />
                )}
              </Bar>
            )
          })}
        </BarChart>
      </ResponsiveContainer>
      {/* Legend rendered outside ResponsiveContainer for test accessibility */}
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: NO_ENROLLMENT_COLOR }} />
          <span className="text-muted-foreground text-sm">No Enrollment</span>
        </div>
        {enrolledSessionList.map(([sessionId, sessionName], index) => (
          <div key={sessionId} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 rounded-sm"
              style={{
                backgroundColor:
                  sessionColors.get(`session_${sessionId}`) ??
                  COLORS[index % COLORS.length] ??
                  '#00b36b',
              }}
            />
            <span className="text-muted-foreground text-sm">{sessionName}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
