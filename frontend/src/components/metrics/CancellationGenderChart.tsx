/**
 * CancellationGenderChart - Nested donut chart showing gender breakdown
 * with prior status split for cancelled campers.
 *
 * Inner ring: Gender totals (M, F, Unknown) using app gender colors.
 * Outer ring: Each gender split into prior status segments.
 */

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { GenderBreakdown, DrilldownFilter } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { getGenderColor } from './genderColors'

// Prior status color variants derived from gender base color
type PriorStatus =
  'was_enrolled' | 'was_waitlisted' | 'was_applied' | 'other_prior_status' | 'unknown'

const PRIOR_STATUS_LABELS: Record<PriorStatus, string> = {
  was_enrolled: 'Was Enrolled',
  was_waitlisted: 'Was Waitlisted',
  was_applied: 'Was Applied',
  other_prior_status: 'Other Prior Status',
  unknown: 'Unknown Status',
}

/** Lightness offsets for each prior status to create visual distinction */
function getPriorStatusColor(gender: string, priorStatus: PriorStatus): string {
  const base = getGenderColor(gender)
  const adjustments: Record<PriorStatus, { satDelta: number; lightDelta: number }> = {
    was_enrolled: { satDelta: 0, lightDelta: -15 },
    was_waitlisted: { satDelta: -25, lightDelta: 20 },
    was_applied: { satDelta: -15, lightDelta: 5 },
    other_prior_status: { satDelta: -35, lightDelta: 25 },
    unknown: { satDelta: -45, lightDelta: 30 },
  }
  const adj = adjustments[priorStatus]
  return base.replace(/(\d+),\s*(\d+)%,\s*(\d+)%\)/, (_, h, s, l) => {
    return `${h}, ${Math.max(Number(s) + adj.satDelta, 10)}%, ${Math.min(Math.max(Number(l) + adj.lightDelta, 20), 85)}%)`
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
  priorStatus: PriorStatus
}

export function CancellationGenderChart({
  data,
  title = 'Gender Distribution',
  height = 300,
  onSegmentClick,
}: CancellationGenderChartProps) {
  // Inner ring: gender totals
  const innerData: InnerDatum[] = data.map((g) => ({
    name: g.gender,
    value: g.count,
    gender: g.gender,
  }))

  // Outer ring: each gender split by prior status
  const outerData: OuterDatum[] = []
  const priorStatusKeys: Array<{ field: keyof GenderBreakdown; status: PriorStatus }> = [
    { field: 'was_enrolled', status: 'was_enrolled' },
    { field: 'was_waitlisted', status: 'was_waitlisted' },
    { field: 'was_applied', status: 'was_applied' },
    { field: 'other_prior_status', status: 'other_prior_status' },
  ]

  for (const g of data) {
    let knownTotal = 0
    for (const { field, status } of priorStatusKeys) {
      const val = (g[field] as number | undefined) ?? 0
      if (val > 0) {
        outerData.push({
          name: `${g.gender} - ${PRIOR_STATUS_LABELS[status]}`,
          value: val,
          gender: g.gender,
          priorStatus: status,
        })
        knownTotal += val
      }
    }
    // Unknown: count minus all known prior statuses
    const unknownCount = g.count - knownTotal
    if (unknownCount > 0) {
      outerData.push({
        name: `${g.gender} - Unknown Status`,
        value: unknownCount,
        gender: g.gender,
        priorStatus: 'unknown',
      })
    }
    // If all zeros and count > 0 but no unknowns calculated, show as unknown
    if (knownTotal === 0 && g.count > 0 && unknownCount <= 0) {
      outerData.push({
        name: `${g.gender} - Unknown Status`,
        value: g.count,
        gender: g.gender,
        priorStatus: 'unknown',
      })
    }
  }

  const total = data.reduce((sum, g) => sum + g.count, 0)

  // Track which prior statuses appear in the data for the legend
  const activePriorStatuses = new Set(outerData.map((d) => d.priorStatus))

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: InnerDatum | OuterDatum; value: number }>
  }) => {
    if (active && payload?.length && payload[0]) {
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

  // Prior status legend items (only show those present in data)
  const priorStatusLegend: Array<{ label: string; color: string }> = []
  const legendStatuses: PriorStatus[] = [
    'was_enrolled',
    'was_waitlisted',
    'was_applied',
    'other_prior_status',
    'unknown',
  ]
  for (const status of legendStatuses) {
    if (activePriorStatuses.has(status)) {
      // Use a neutral representative color for the legend
      priorStatusLegend.push({
        label: PRIOR_STATUS_LABELS[status],
        color: getPriorStatusColor('M', status),
      })
    }
  }

  const legendItems = [
    ...data.map((g) => ({ label: g.gender, color: getGenderColor(g.gender) })),
    ...priorStatusLegend,
  ]

  return (
    <ChartCard title={title} isEmpty={data.length === 0} legend={legendItems}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          {/* Inner ring: gender totals */}
          <Pie<InnerDatum>
            data={innerData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
            onClick={(_, idx) => handleClick(_, idx, true)}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {innerData.map((d, i) => (
              <Cell key={`inner-${i}`} fill={getGenderColor(d.gender)} />
            ))}
          </Pie>
          {/* Outer ring: prior status split */}
          <Pie<OuterDatum>
            data={outerData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={95}
            outerRadius={125}
            onClick={(_, idx) => handleClick(_, idx, false)}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {outerData.map((d, i) => (
              <Cell key={`outer-${i}`} fill={getPriorStatusColor(d.gender, d.priorStatus)} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
