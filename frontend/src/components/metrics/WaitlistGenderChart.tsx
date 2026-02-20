/**
 * WaitlistGenderChart - Nested donut chart showing gender breakdown
 * with enrollment split for waitlisted campers.
 *
 * Inner ring: Gender totals (M, F, Unknown) using app gender colors.
 * Outer ring: Each gender split into No Other Sessions / Has Other Sessions.
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

/** Darker variant for "No Other Sessions" */
function getNoEnrollmentColor(gender: string): string {
  const base = getGenderColor(gender)
  // Increase saturation, decrease lightness for a more saturated/darker variant
  return base.replace(/(\d+)%\)$/, (_, l) => `${Math.max(Number(l) - 15, 20)}%)`)
}

/** Lighter variant for "Has Other Sessions" */
function getHasEnrollmentColor(gender: string): string {
  const base = getGenderColor(gender)
  // Decrease saturation, increase lightness for a lighter variant
  return base.replace(/(\d+),\s*(\d+)%,\s*(\d+)%\)/, (_, h, s, l) => {
    return `${h}, ${Math.max(Number(s) - 25, 10)}%, ${Math.min(Number(l) + 20, 85)}%)`
  })
}

interface WaitlistGenderChartProps {
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
  enrollmentType: 'no_enrollment' | 'has_enrollment'
}

export function WaitlistGenderChart({
  data,
  title = 'Gender Distribution',
  height = 300,
  onSegmentClick,
}: WaitlistGenderChartProps) {
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

  // Outer ring: each gender split into enrollment status
  const outerData: OuterDatum[] = []
  for (const g of data) {
    const noEnroll = g.no_enrollment ?? 0
    const hasEnroll = g.has_enrollment ?? 0
    if (noEnroll > 0) {
      outerData.push({
        name: `${g.gender} - No Other Sessions`,
        value: noEnroll,
        gender: g.gender,
        enrollmentType: 'no_enrollment',
      })
    }
    if (hasEnroll > 0) {
      outerData.push({
        name: `${g.gender} - Has Other Sessions`,
        value: hasEnroll,
        gender: g.gender,
        enrollmentType: 'has_enrollment',
      })
    }
    // If both are 0 but count > 0, show the total as no_enrollment
    if (noEnroll === 0 && hasEnroll === 0 && g.count > 0) {
      outerData.push({
        name: `${g.gender} - No Other Sessions`,
        value: g.count,
        gender: g.gender,
        enrollmentType: 'no_enrollment',
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

  const handleInnerClick = (_: unknown, index: number) => {
    if (!onSegmentClick) return
    const item = innerData[index]
    if (!item) return
    onSegmentClick({
      type: 'gender',
      value: item.gender,
      label: item.gender,
      titleFormat: 'adjective',
      statusOverride: ['waitlisted'],
      waitlistContext: true,
    })
  }

  const handleOuterClick = (_: unknown, index: number) => {
    if (!onSegmentClick) return
    const item = outerData[index]
    if (!item) return
    onSegmentClick({
      type: 'gender',
      value: item.gender,
      label: item.gender,
      titleFormat: 'adjective',
      statusOverride: ['waitlisted'],
      waitlistContext: true,
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
            onClick={handleInnerClick}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {innerData.map((d, i) => (
              <Cell key={`inner-${i}`} fill={getGenderColor(d.gender)} />
            ))}
          </Pie>
          {/* Outer ring: enrollment split */}
          <Pie
            data={outerData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={95}
            onClick={handleOuterClick}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {outerData.map((d, i) => (
              <Cell
                key={`outer-${i}`}
                fill={
                  d.enrollmentType === 'no_enrollment'
                    ? getNoEnrollmentColor(d.gender)
                    : getHasEnrollmentColor(d.gender)
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
            style={{ backgroundColor: 'hsl(0, 0%, 40%)' }}
          />
          <span className="text-muted-foreground text-sm">No Other Sessions</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: 'hsl(0, 0%, 75%)' }}
          />
          <span className="text-muted-foreground text-sm">Has Other Sessions</span>
        </div>
      </div>
    </div>
  )
}
