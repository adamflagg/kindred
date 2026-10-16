/**
 * WaitlistGenderChart - waitlisted campers by gender identity (inner ring), each split into No Other Sessions /
 * Has Other Sessions (outer ring, the gender's colour at full and half opacity). See NestedGenderDonut.
 */

import type { ReactNode } from 'react'
import type { GenderBreakdown, DrilldownFilter } from '../../types/metrics'
import { NestedGenderDonut, type DonutPart } from './NestedGenderDonut'

const PARTS: readonly DonutPart[] = [
  { key: 'no_enrollment', label: 'No Other Sessions', opacity: 1 },
  { key: 'has_enrollment', label: 'Has Other Sessions', opacity: 0.5 },
]

interface WaitlistGenderChartProps {
  data: GenderBreakdown[]
  title?: string
  height?: number
  onSegmentClick?: (filter: DrilldownFilter) => void
  footer?: ReactNode
}

export function WaitlistGenderChart(props: WaitlistGenderChartProps) {
  return (
    <NestedGenderDonut
      {...props}
      parts={PARTS}
      drilldown={{
        titleFormat: 'adjective',
        statusOverride: ['waitlisted'],
        waitlistContext: true,
      }}
    />
  )
}
