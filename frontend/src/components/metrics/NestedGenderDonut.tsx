/**
 * NestedGenderDonut - the Waitlist and Cancellations gender donuts (#2898).
 *
 * Inner ring: every gender identity label, in the fixed order (#76 a), in the kit's colour tokens.
 * Outer ring: each label split into the tab's parts, in the label's colour at the part's opacity. The kit's
 * colours are hex and var(), so the old shading by parsing an HSL string is gone.
 */

import type { ReactNode } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCount, formatPercent } from '../../utils/numberFormat'
import type { GenderBreakdown, DrilldownFilter } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { genderDisplayName } from '../camperships/kit/genderIdentity'
import { nestedGenderRings, type DonutPart, type OuterSlice, type Slice } from './nestedGenderRings'

export type { DonutPart } from './nestedGenderRings'

/** Neutral swatch for a part in the legend: the part's opacity on a mid grey. */
const PART_SWATCH = (opacity: number) => `hsl(0 0% 40% / ${opacity})`

interface NestedGenderDonutProps {
  data: GenderBreakdown[]
  parts: readonly DonutPart[]
  remainder?: DonutPart
  title?: string
  height?: number
  /** The drill-down a slice opens (statuses, waitlist context); gender value and label are filled in. */
  drilldown?: Omit<DrilldownFilter, 'type' | 'value' | 'label'>
  onSegmentClick?: (filter: DrilldownFilter) => void
  /** Under the legend: the Gender field count line. */
  footer?: ReactNode
}

export function NestedGenderDonut({
  data,
  parts,
  remainder,
  title = 'Gender Distribution',
  height = 300,
  drilldown,
  onSegmentClick,
  footer,
}: NestedGenderDonutProps) {
  const { inner, outer } = nestedGenderRings(data, parts, remainder)
  const total = data.reduce((sum, g) => sum + g.count, 0)

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: Slice; value: number }>
  }) => {
    if (active && payload?.length && payload[0]) {
      const item = payload[0].payload
      const pct = formatPercent(total > 0 ? (item.value / total) * 100 : 0)
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground font-medium">{item.name}</p>
          <p className="text-muted-foreground text-sm">
            Count: <span className="text-foreground font-semibold">{formatCount(item.value)}</span>
          </p>
          <p className="text-muted-foreground text-sm">
            Percentage: <span className="text-foreground font-semibold">{pct}</span>
          </p>
        </div>
      )
    }
    return null
  }

  const open = (item: Slice | undefined) => {
    if (!onSegmentClick || !item) return
    onSegmentClick({
      ...drilldown,
      type: 'gender',
      value: item.gender,
      label: genderDisplayName(item.gender),
    })
  }

  const shownParts = [...parts, ...(remainder ? [remainder] : [])].filter((p) =>
    outer.some((o) => o.part === p.label)
  )
  const legendItems = [
    ...inner.map((d) => ({ label: d.name, color: d.color })),
    ...shownParts.map((p) => ({ label: p.label, color: p.color ?? PART_SWATCH(p.opacity) })),
  ]

  return (
    <ChartCard title={title} isEmpty={data.length === 0} legend={legendItems} footer={footer}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie<Slice>
            data={inner}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
            onClick={(_, i) => open(inner[i])}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {inner.map((d, i) => (
              <Cell key={`inner-${i}`} fill={d.color} />
            ))}
          </Pie>
          <Pie<OuterSlice>
            data={outer}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={95}
            outerRadius={125}
            onClick={(_, i) => open(outer[i])}
            style={{ cursor: onSegmentClick ? 'pointer' : undefined }}
          >
            {outer.map((d, i) => (
              <Cell key={`outer-${i}`} fill={d.color} fillOpacity={d.opacity} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
