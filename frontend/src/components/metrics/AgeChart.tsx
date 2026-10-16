/**
 * Campers by age on Registration › Overview (epic #3207, owner ruling D-UNCOVERED): bars 5–7,
 * 8–10, 11–13, 14–16, 17+ and None, each camper counted once. Age is the season year minus the
 * birth year, worked out by the server (`by_age`); the numbered note says so.
 */
import { useMemo } from 'react'

import { DefRef } from '../camperships/kit/DefinitionNotes'
import type { AgeBandBreakdown, DrilldownFilter } from '../../types/metrics'
import { ageBandLabel, transformAgeData } from '../../utils/metricsTransforms'
import { formatCount } from '../../utils/numberFormat'
import { CssVerticalBarChart, type CssVerticalBarItem } from './CssVerticalBarChart'

// The grade chart's bar colour; None (no birthdate) is muted, as the mock draws it.
const BAR_COLOR = 'hsl(160, 100%, 35%)'
const NONE_COLOR = 'hsl(var(--muted-foreground) / 0.45)'

function ageFilter(band: string): DrilldownFilter {
  if (band === 'none') {
    return { type: 'age_band', value: band, label: 'No Birthdate', titleFormat: 'adjective' }
  }
  return { type: 'age_band', value: band, label: `Ages ${ageBandLabel(band)}` }
}

export function AgeChart({
  data,
  title,
  height = 300,
  onBarClick,
  note,
}: {
  data: AgeBandBreakdown[] | undefined
  title?: string
  height?: number
  /** The drill-down; the compare-year chart passes none, as the grade chart's does. */
  onBarClick?: (filter: DrilldownFilter) => void
  /** The page's number for the age note; no mark when the page lists none. */
  note?: number | undefined
}) {
  const bars = useMemo(() => transformAgeData(data), [data])
  const total = bars.reduce((sum, b) => sum + b.value, 0)

  return (
    <CssVerticalBarChart
      data={bars}
      {...(title !== undefined ? { title } : {})}
      height={height}
      labelFormat={(item) => formatCount(item.value)}
      colorFn={(item) => (item.id === 'none' ? NONE_COLOR : BAR_COLOR)}
      onBarClick={
        onBarClick
          ? (item: CssVerticalBarItem) => onBarClick(ageFilter(String(item.id)))
          : undefined
      }
      footer={
        bars.length > 0 ? (
          <p className="text-muted-foreground pt-2 text-sm">
            {formatCount(total)} campers, each counted once.
            {note !== undefined && <DefRef n={note} />}
          </p>
        ) : undefined
      }
    />
  )
}
