/**
 * CssVerticalRetentionBarChart - Retention-specific wrapper around CssVerticalBarChart.
 *
 * Thin wrapper that maps RetentionRateBarItem[] to CssVerticalBarItem[] and applies
 * retention-specific options: conditional coloring (green/amber/red), 0-100% Y-axis,
 * percentage labels, and a retention tooltip.
 */

import { useCallback, useMemo } from 'react'
import { CssVerticalBarChart, type CssVerticalBarItem } from './CssVerticalBarChart'
import { sortRetentionBarData, type RetentionSortBy } from '../../utils/retentionTransforms'
import type { RetentionRateBarItem } from '../../types/metrics'
import { chartAxisLabels } from '../../utils/chartLabels'
import { formatCount, formatPercent } from '../../utils/numberFormat'

interface CssVerticalRetentionBarChartProps {
  data: RetentionRateBarItem[]
  title: string
  topN?: number
  height?: number
  sortBy?: RetentionSortBy
  showCounts?: boolean
  onBarClick?: (item: RetentionRateBarItem) => void
  /** Bar width as percentage of column (1-100). Passed through to CssVerticalBarChart. */
  barWidthPercent?: number
  /**
   * Shortens a name for the x-axis only (P-20 option B). Names that would then
   * read the same keep their full names. The tooltip and the click keep the full name.
   */
  shortenLabel?: (name: string) => string
  className?: string
}

function getBarColor(rate: number): string {
  if (rate >= 0.6) return 'hsl(160, 100%, 35%)' // Green
  if (rate >= 0.4) return 'hsl(42, 92%, 50%)' // Amber/Gold
  return 'hsl(350, 70%, 50%)' // Red
}

export function CssVerticalRetentionBarChart({
  data,
  title,
  topN,
  height = 300,
  sortBy = 'rate',
  showCounts = false,
  onBarClick,
  barWidthPercent,
  shortenLabel,
  className = '',
}: CssVerticalRetentionBarChartProps) {
  const sorted = useMemo(() => sortRetentionBarData(data, sortBy, topN), [data, sortBy, topN])

  // Map RetentionRateBarItem[] to CssVerticalBarItem[]
  // Shortened over the bars shown (after topN), so a cut bar can't force a full name.
  const barData: CssVerticalBarItem[] = useMemo(() => {
    const axisLabels = shortenLabel
      ? chartAxisLabels(
          sorted.map((item) => item.name),
          shortenLabel
        )
      : undefined
    return sorted.map((item, i) => ({
      ...item,
      name: item.name,
      ...(axisLabels ? { axisLabel: axisLabels[i] } : {}),
      value: item.retentionRate * 100,
    }))
  }, [sorted, shortenLabel])

  const colorFn = useCallback(
    (item: CssVerticalBarItem) => getBarColor(item['retentionRate'] as number),
    []
  )

  const labelFormat = useCallback(
    (item: CssVerticalBarItem) => {
      const rate = item.value
      if (showCounts) {
        const returned = item['returnedCount'] as number
        const base = item['baseCount'] as number
        return `${formatPercent(rate)} (${formatCount(returned)}/${formatCount(base)})`
      }
      return formatPercent(rate)
    },
    [showCounts]
  )

  const renderTooltip = useCallback((item: CssVerticalBarItem) => {
    const returned = item['returnedCount'] as number
    const base = item['baseCount'] as number
    return (
      <>
        <p className="text-foreground font-medium">{item.name}</p>
        <p className="text-muted-foreground text-sm">
          Retention:{' '}
          <span className="text-foreground font-semibold">{formatPercent(item.value)}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          {formatCount(returned)} of {formatCount(base)} returned
        </p>
      </>
    )
  }, [])

  const handleBarClick = useCallback(
    (item: CssVerticalBarItem) => {
      if (!onBarClick) return
      // Find the original RetentionRateBarItem from the sorted list
      const original = sorted.find((d) => d.name === item.name)
      if (original) onBarClick(original)
    },
    [onBarClick, sorted]
  )

  return (
    <CssVerticalBarChart
      data={barData}
      title={title}
      height={height}
      yAxisMax={100}
      yAxisTicks={[0, 25, 50, 75, 100]}
      yAxisFormat={(t: number) => `${t}%`}
      yAxisWidth="w-10"
      colorFn={colorFn}
      labelFormat={labelFormat}
      renderTooltip={renderTooltip}
      rotateLabels={true}
      onBarClick={onBarClick ? handleBarClick : undefined}
      barWidthPercent={barWidthPercent}
      className={className}
    />
  )
}
