/**
 * CssRetentionBarChart - Pure CSS horizontal bar chart for retention rates.
 *
 * CSS prototype replacing RetentionRateBarChart's horizontal mode.
 * Per-bar conditional coloring: green (>=60%), amber (40-60%), red (<40%).
 * Fixed 0-100% domain with percentage tick labels.
 */

import { useState, useCallback } from 'react'
import { getNiceTicks, useChartTooltip, calculateBarSizing } from './cssChartUtils'
import {
  sortRetentionBarData,
  type RetentionSortBy,
} from '../../utils/retentionTransforms'
import type { RetentionRateBarItem } from './RetentionRateBarChart'

interface CssRetentionBarChartProps {
  data: RetentionRateBarItem[]
  title: string
  topN?: number
  height?: number
  /** Width of the row label column in pixels (default: 144) */
  labelWidth?: number
  /** Width of the rate/value column in pixels (default: 96) */
  valueWidth?: number
  sortBy?: RetentionSortBy
  showCounts?: boolean
  onBarClick?: (item: RetentionRateBarItem) => void
  className?: string
}

function getBarColor(rate: number): string {
  if (rate >= 0.6) return 'hsl(160, 100%, 35%)' // Green
  if (rate >= 0.4) return 'hsl(42, 92%, 50%)' // Amber/Gold
  return 'hsl(350, 70%, 50%)' // Red
}

interface ChartItem {
  original: RetentionRateBarItem
  rate: number
  rateLabel: string
}

export function CssRetentionBarChart({
  data,
  title,
  topN,
  height,
  labelWidth = 144,
  valueWidth = 96,
  sortBy = 'rate',
  showCounts = false,
  onBarClick,
  className = '',
}: CssRetentionBarChartProps) {
  const { tooltip, tooltipRef, handleMouseMove, handleMouseLeave } =
    useChartTooltip<ChartItem>()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const isClickable = !!onBarClick

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

  const sorted = sortRetentionBarData(data, sortBy, topN)

  const chartItems: ChartItem[] = sorted.map((d) => {
    const rate = Math.round(d.retentionRate * 100)
    return {
      original: d,
      rate,
      rateLabel: showCounts ? `${rate}% (${d.returnedCount}/${d.baseCount})` : `${rate}%`,
    }
  })

  // Fixed 0-100% domain
  const ticks = getNiceTicks(100, 4)
  const axisMax = 100
  const chartHeight = height ?? 300
  const { isDense, barHeight, rowGap } = calculateBarSizing(chartHeight, chartItems.length)

  const handleClick = useCallback(
    (item: ChartItem) => {
      if (!onBarClick) return
      onBarClick(item.original)
    },
    [onBarClick]
  )

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>

      <div className="relative flex flex-col" style={{ height: chartHeight }}>
        {/* Bars area - vertically centered when not filling card */}
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isDense ? '' : 'justify-center'}`} style={{ gap: rowGap }}>
        {chartItems.map((item, index) => (
          <div
            key={index}
            className={`flex items-center ${isDense ? 'gap-2' : 'gap-3'} rounded transition-colors ${hoveredIndex === index ? 'bg-foreground/10' : ''} ${isClickable ? 'cursor-pointer' : ''}`}
            onClick={() => isClickable && handleClick(item)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseMove={(e) => handleMouseMove(e, item)}
            onMouseLeave={() => {
              setHoveredIndex(null)
              handleMouseLeave()
            }}
          >
            {/* Label */}
            <span className="text-muted-foreground shrink-0 truncate text-right text-sm" style={{ width: labelWidth }}>
              {item.original.name}
            </span>

            {/* Bar track */}
            <div
              className="relative flex-1 overflow-hidden rounded"
              style={{
                height: barHeight,
              }}
            >
              {/* Background track */}
              <div className="bg-muted absolute inset-0 rounded" />
              {/* Bar fill — conditional color */}
              <div
                className="relative h-full rounded transition-all duration-300"
                style={{
                  width: `${item.rate}%`,
                  backgroundColor: getBarColor(item.original.retentionRate),
                  minWidth: item.rate > 0 ? '4px' : '0px',
                }}
              />
            </div>

            {/* Rate label */}
            <span className="text-muted-foreground shrink-0 text-right text-sm tabular-nums" style={{ width: valueWidth }}>
              {item.rateLabel}
            </span>
          </div>
        ))}
        </div>

        {/* X-axis line + tick labels (percentage) */}
        <div className={`${isDense ? 'mt-1' : 'mt-2'} flex shrink-0 items-center ${isDense ? 'gap-2' : 'gap-3'}`}>
          <span className="shrink-0" style={{ width: labelWidth }} />
          <div className="border-foreground/40 relative h-5 flex-1 border-t pt-1">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="text-muted-foreground absolute text-xs font-semibold tabular-nums"
                style={{
                  left: `${(tick / axisMax) * 100}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                {tick}%
              </span>
            ))}
          </div>
          <span className="shrink-0" style={{ width: valueWidth }} />
        </div>

        {/* Tooltip */}
        {tooltip.visible && tooltip.item && (
          <div
            ref={tooltipRef}
            className="bg-card border-border pointer-events-none fixed z-50 rounded-lg border p-3 shadow-lg"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translateY(-50%)',
            }}
          >
            <p className="text-foreground font-medium">{tooltip.item.original.name}</p>
            <p className="text-muted-foreground text-sm">
              Retention:{' '}
              <span className="text-foreground font-semibold">{tooltip.item.rate}%</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {tooltip.item.original.returnedCount} of {tooltip.item.original.baseCount} returned
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
