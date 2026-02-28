/**
 * CssStackedHorizontalBarChart - Pure CSS stacked horizontal bar chart.
 *
 * Generic component handling all stacked horizontal bar patterns:
 * - WaitlistGradeChart (2 segments)
 * - WaitlistBySessionChart (dynamic segments)
 * - CancellationGradeChart (5 segments)
 * - CancellationBySessionChart (5 segments)
 *
 * Configured via `segments` prop that defines the stacked layers.
 */

import { useState, useCallback } from 'react'
import { getNiceTicks, useChartTooltip, calculateBarSizing } from './cssChartUtils'
import { ChartLegend } from './ChartLegend'

export interface StackedSegment {
  key: string
  label: string
  color: string
}

export interface StackedBarDataItem {
  name: string
  total: number
  [key: string]: string | number
}

interface CssStackedHorizontalBarChartProps {
  data: StackedBarDataItem[]
  segments: StackedSegment[]
  title?: string
  height?: number
  /** Width of the row label column in pixels (default: 96) */
  labelWidth?: number
  /** Width of the total value column in pixels (default: 40) */
  valueWidth?: number
  onBarClick?: (item: StackedBarDataItem) => void
  className?: string
}

export function CssStackedHorizontalBarChart({
  data,
  segments,
  title,
  height = 300,
  labelWidth = 96,
  valueWidth = 40,
  onBarClick,
  className = '',
}: CssStackedHorizontalBarChartProps) {
  const { tooltip, tooltipRef, handleMouseMove, handleMouseLeave } =
    useChartTooltip<StackedBarDataItem>()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const isClickable = !!onBarClick

  if (data.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        {title && <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>}
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  // Filter to only segments that have data
  const activeSegments = segments.filter((seg) =>
    data.some((d) => (d[seg.key] as number) > 0)
  )

  const maxTotal = Math.max(...data.map((d) => d.total), 1)
  const ticks = getNiceTicks(maxTotal)
  const axisMax = ticks[ticks.length - 1] ?? maxTotal
  const { isDense, barHeight, rowGap } = calculateBarSizing(height, data.length)

  const handleClick = useCallback(
    (item: StackedBarDataItem) => {
      if (!onBarClick) return
      onBarClick(item)
    },
    [onBarClick]
  )

  return (
    <div className={`card-lodge p-4 ${className}`}>
      {title && <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>}

      <div className="relative flex flex-col" style={{ height }}>
        {/* Bars area - vertically centered when not filling card */}
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isDense ? '' : 'justify-center'}`} style={{ gap: rowGap }}>
        {data.map((item, index) => {
          return (
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
                {item.name}
              </span>

              {/* Stacked bar track */}
              <div
                className="relative flex-1 overflow-hidden rounded"
                style={{ height: barHeight }}
              >
                {/* Background track */}
                <div className="bg-muted absolute inset-0 rounded" />
                {/* Stacked segments */}
                <div
                  className="relative flex h-full overflow-hidden rounded"
                  style={{ width: `${(item.total / axisMax) * 100}%`, minWidth: item.total > 0 ? '4px' : '0px' }}
                >
                  {activeSegments.map((seg) => {
                    const value = (item[seg.key] as number) || 0
                    if (value <= 0) return null
                    const pct = (value / item.total) * 100
                    return (
                      <div
                        key={seg.key}
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: seg.color,
                          minWidth: '1px',
                        }}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Total label */}
              <span className="text-muted-foreground shrink-0 text-right text-sm tabular-nums" style={{ width: valueWidth }}>
                {item.total}
              </span>
            </div>
          )
        })}
        </div>

        {/* X-axis line + tick labels */}
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
                {tick}
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
            <p className="text-foreground mb-2 font-medium">{tooltip.item.name}</p>
            {activeSegments
              .filter((seg) => ((tooltip.item![seg.key] as number) || 0) > 0)
              .sort((a, b) => ((tooltip.item![b.key] as number) || 0) - ((tooltip.item![a.key] as number) || 0))
              .map((seg) => {
                const value = (tooltip.item![seg.key] as number) || 0
                const pct = tooltip.item!.total > 0 ? ((value / tooltip.item!.total) * 100).toFixed(0) : '0'
                return (
                  <p key={seg.key} className="text-muted-foreground text-sm">
                    <span style={{ color: seg.color }}>{seg.label}:</span>{' '}
                    <span className="text-foreground font-semibold">
                      {value} ({pct}%)
                    </span>
                  </p>
                )
              })}
            <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-sm">
              Total: <span className="text-foreground font-semibold">{tooltip.item.total}</span>
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <ChartLegend
        items={activeSegments.map((seg) => ({ label: seg.label, color: seg.color }))}
        className="mt-2"
      />
    </div>
  )
}
