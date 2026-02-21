/**
 * CancellationGenderChart - Nested donut chart showing gender breakdown
 * with was_enrolled / was_waitlisted split for cancelled campers.
 *
 * Inner ring: Gender totals (M, F, Unknown) using app gender colors.
 * Outer ring: Each gender split into Was Enrolled / Was Waitlisted.
 */

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { GenderBreakdown, DrilldownFilter } from '../../types/metrics'

// Gender colors matching GenderStackedChart and GenderByGradeChart
const GENDER_COLORS: Record<string, string> = {
  M: 'hsl(200, 70%, 50%)', // Blue
  F: 'hsl(340, 70%, 50%)', // Pink
  Unknown: 'hsl(0, 0%, 60%)', // Gray
}

const FALLBACK_COLOR = 'hsl(280, 60%, 50%)' // Purple

function getGenderColor(gender: string): string {
  return GENDER_COLORS[gender] ?? FALLBACK_COLOR
}

/** Darker variant for "Was Enrolled" */
function getWasEnrolledColor(gender: string): string {
  const base = getGenderColor(gender)
  return base.replace(/(\d+)%\)$/, (_, l) => `${Math.max(Number(l) - 15, 20)}%)`)
}

/** Lighter variant for "Was Waitlisted" */
function getWasWaitlistedColor(gender: string): string {
  const base = getGenderColor(gender)
  return base.replace(/(\d+),\s*(\d+)%,\s*(\d+)%\)/, (_, h, s, l) => {
    return `${h}, ${Math.max(Number(s) - 25, 10)}%, ${Math.min(Number(l) + 20, 85)}%)`
  })
}

interface CancellationGenderChartProps {
  data: GenderBreakdown[]
  title?: string
  height?: number
  onSegmentClick?: (filter: DrilldownFilter) => void
}

interface InnerDatum {
  name: string
  value: number
  gender: string
}

interface OuterDatum {
  name: string
  value: number
  gender: string
  priorStatus: 'was_enrolled' | 'was_waitlisted'
}

export function CancellationGenderChart({
  data,
  title = 'Gender Distribution',
  height = 300,
  onSegmentClick,
}: CancellationGenderChartProps) {
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

  // Inner ring: gender totals
  const innerData: InnerDatum[] = data.map((g) => ({
    name: g.gender,
    value: g.count,
    gender: g.gender,
  }))

  // Outer ring: each gender split into was_enrolled / was_waitlisted
  const outerData: OuterDatum[] = []
  for (const g of data) {
    const wasEnrolled = g.was_enrolled ?? 0
    const wasWaitlisted = g.was_waitlisted ?? 0
    if (wasEnrolled > 0) {
      outerData.push({
        name: `${g.gender} - Was Enrolled`,
        value: wasEnrolled,
        gender: g.gender,
        priorStatus: 'was_enrolled',
      })
    }
    if (wasWaitlisted > 0) {
      outerData.push({
        name: `${g.gender} - Was Waitlisted`,
        value: wasWaitlisted,
        gender: g.gender,
        priorStatus: 'was_waitlisted',
      })
    }
    // If both are 0 but count > 0, show total as was_enrolled
    if (wasEnrolled === 0 && wasWaitlisted === 0 && g.count > 0) {
      outerData.push({
        name: `${g.gender} - Was Enrolled`,
        value: g.count,
        gender: g.gender,
        priorStatus: 'was_enrolled',
      })
    }
  }

  const total = data.reduce((sum, g) => sum + g.count, 0)

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: InnerDatum | OuterDatum; value: number }>
  }) => {
    if (active && payload && payload.length && payload[0]) {
      const item = payload[0].payload
      const pct = total > 0 ? ((item.value / total) * 100).toFixed(0) : '0'
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground font-medium">{item.name}</p>
          <p className="text-muted-foreground text-sm">
            Count: <span className="text-foreground font-semibold">{item.value}</span>
          </p>
          <p className="text-muted-foreground text-sm">
            Percentage: <span className="text-foreground font-semibold">{pct}%</span>
          </p>
        </div>
      )
    }
    return null
  }

  const handleClick = (_: unknown, index: number, isInner: boolean) => {
    if (!onSegmentClick) return
    const item = isInner ? innerData[index] : outerData[index]
    if (!item) return
    onSegmentClick({
      type: 'gender',
      value: item.gender,
      label: item.gender,
      titleFormat: 'adjective',
      statusOverride: ['cancelled', 'withdrawn', 'dismissed'],
    })
  }

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          {/* Inner ring: gender totals */}
          <Pie
            data={innerData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={65}
            onClick={(_, idx) => handleClick(_, idx, true)}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {innerData.map((d, i) => (
              <Cell key={`inner-${i}`} fill={getGenderColor(d.gender)} />
            ))}
          </Pie>
          {/* Outer ring: was_enrolled / was_waitlisted split */}
          <Pie
            data={outerData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={95}
            onClick={(_, idx) => handleClick(_, idx, false)}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {outerData.map((d, i) => (
              <Cell
                key={`outer-${i}`}
                fill={
                  d.priorStatus === 'was_enrolled'
                    ? getWasEnrolledColor(d.gender)
                    : getWasWaitlistedColor(d.gender)
                }
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {data.map((g) => (
          <div key={g.gender} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: getGenderColor(g.gender) }}
            />
            <span className="text-muted-foreground text-sm">{g.gender}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: 'hsl(200, 70%, 35%)' }}
          />
          <span className="text-muted-foreground text-sm">Was Enrolled</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: 'hsl(42, 67%, 70%)' }}
          />
          <span className="text-muted-foreground text-sm">Was Waitlisted</span>
        </div>
      </div>
    </div>
  )
}
