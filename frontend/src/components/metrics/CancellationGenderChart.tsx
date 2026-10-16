/**
 * CancellationGenderChart - cancelled campers by gender identity (inner ring), each split by the status they had
 * before cancelling (outer ring, the gender's colour at falling opacity; no recorded status in grey). See
 * NestedGenderDonut.
 */

import type { ReactNode } from 'react'
import type { GenderBreakdown, DrilldownFilter } from '../../types/metrics'
import { NestedGenderDonut, type DonutPart } from './NestedGenderDonut'
import { GENDER_NOT_GIVEN } from '../camperships/kit/genderIdentity'

const PARTS: readonly DonutPart[] = [
  { key: 'was_enrolled', label: 'Was Enrolled', opacity: 1 },
  { key: 'was_waitlisted', label: 'Was Waitlisted', opacity: 0.7 },
  { key: 'was_applied', label: 'Was Applied', opacity: 0.5 },
  { key: 'other_prior_status', label: 'Other Prior Status', opacity: 0.35 },
]

/** The status before cancelling is recorded from 2026; earlier campers have none. */
const UNKNOWN: DonutPart = {
  key: 'unknown',
  label: 'Unknown Status',
  opacity: 1,
  color: GENDER_NOT_GIVEN,
}

interface CancellationGenderChartProps {
  data: GenderBreakdown[]
  title?: string
  height?: number
  onSegmentClick?: (filter: DrilldownFilter) => void
  footer?: ReactNode
}

export function CancellationGenderChart(props: CancellationGenderChartProps) {
  return (
    <NestedGenderDonut
      {...props}
      parts={PARTS}
      remainder={UNKNOWN}
      drilldown={{
        titleFormat: 'adjective',
        statusOverride: ['cancelled', 'withdrawn', 'dismissed'],
      }}
    />
  )
}
