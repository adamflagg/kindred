/**
 * CssVerticalRetentionBarChart - Pure CSS vertical column chart for retention rates.
 *
 * CSS prototype replacing RetentionRateBarChart's vertical (layout="vertical") mode.
 * Per-bar conditional coloring: green (>=60%), amber (40-60%), red (<40%).
 * Fixed 0-100% Y-axis domain with percentage tick labels.
 * Based on CssVerticalStackedBarChart column layout patterns.
 */

import { useState, useCallback, useRef } from 'react'
import { sortRetentionBarData, type RetentionSortBy } from '../../utils/retentionTransforms'
import type { RetentionRateBarItem } from './RetentionRateBarChart'

interface CssVerticalRetentionBarChartProps {
  data: RetentionRateBarItem[]
  title: string
  topN?: number
  height?: number
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

interface TooltipState {
  visible: boolean
  x: number
  y: number
  item: RetentionRateBarItem | null
}

export function CssVerticalRetentionBarChart({
  data,
  title,
  topN,
  height = 300,
  sortBy = 'rate',
  showCounts = false,
  onBarClick,
  className = '',
}: CssVerticalRetentionBarChartProps) {
  const barsHeight = height - 34
  const drawingHeight = barsHeight - 16
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  })
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredColRect, setHoveredColRect] = useState<DOMRect | null>(null)
  const lastIndexRef = useRef(0)
  if (hoveredIndex !== null) lastIndexRef.current = hoveredIndex
  const isClickable = !!onBarClick

  const sorted = sortRetentionBarData(data, sortBy, topN)

  // Fixed 0-100% Y-axis
  const ticks = [0, 25, 50, 75, 100]
  const axisMax = 100

  const handleClick = useCallback(
    (item: RetentionRateBarItem) => {
      if (!onBarClick) return
      onBarClick(item)
    },
    [onBarClick]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, item: RetentionRateBarItem) => {
      const chart = chartRef.current
      const tt = tooltipRef.current
      const colRect = hoveredColRect

      if (chart && colRect) {
        const chartRect = chart.getBoundingClientRect()
        const ttWidth = tt?.offsetWidth ?? 160
        const ttHeight = tt?.offsetHeight ?? 120

        // X: anchor to right of column, flip left if it overflows
        let x = colRect.right + 8
        if (x + ttWidth > chartRect.right + 40) {
          x = colRect.left - ttWidth - 8
        }

        // Y: follow cursor, clamped to chart area
        const minY = chartRect.top + 8
        const maxY = chartRect.bottom - ttHeight - 8
        const y = Math.max(minY, Math.min(e.clientY - ttHeight / 2, maxY))

        setTooltip({ visible: true, x, y, item })
      } else {
        setTooltip({ visible: true, x: e.clientX + 12, y: e.clientY - 12, item })
      }
    },
    [hoveredColRect]
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }))
  }, [])

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

  return (
    <div className={`card-lodge flex flex-col px-4 pt-4 pb-4 ${className}`}>
      <h3 className="text-foreground mb-2 text-base font-semibold">{title}</h3>

      <div className="relative flex-1">
        {/* Chart area with Y-axis */}
        <div className="flex">
          {/* Y-axis tick labels */}
          <div className="relative mr-2 w-10 shrink-0" style={{ height: barsHeight }}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="text-muted-foreground absolute right-0 text-xs font-semibold tabular-nums"
                style={{
                  bottom: `${(tick / axisMax) * drawingHeight}px`,
                  transform: 'translateY(50%)',
                }}
              >
                {tick}%
              </span>
            ))}
          </div>

          {/* Bars area */}
          <div
            ref={chartRef}
            className="border-foreground/30 relative flex flex-1 items-end border-l"
            style={{ height: barsHeight }}
          >
            {sorted.map((item, index) => {
              const rate = Math.round(item.retentionRate * 100)
              const barHeightPx = (rate / axisMax) * drawingHeight

              return (
                <div
                  key={index}
                  className={`relative flex h-full flex-1 flex-col items-center justify-end px-1 ${isClickable ? 'cursor-pointer' : ''}`}
                  onMouseEnter={(e) => {
                    setHoveredIndex(index)
                    setHoveredColRect(e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseMove={(e) => handleMouseMove(e, item)}
                  onMouseLeave={() => {
                    setHoveredIndex(null)
                    setHoveredColRect(null)
                    handleMouseLeave()
                  }}
                  onClick={() => isClickable && handleClick(item)}
                >
                  {/* Rate label above bar */}
                  <span className="text-muted-foreground relative z-10 mb-1 text-xs tabular-nums">
                    {showCounts ? `${rate}% (${item.returnedCount}/${item.baseCount})` : `${rate}%`}
                  </span>

                  {/* Bar */}
                  <div
                    className="relative z-10 w-full rounded-t transition-all duration-300"
                    style={{
                      height: `${barHeightPx}px`,
                      minHeight: rate > 0 ? '4px' : '0px',
                      backgroundColor: getBarColor(item.retentionRate),
                    }}
                  />
                </div>
              )
            })}

            {/* Sliding hover overlay */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 z-0 rounded bg-foreground/[0.06] transition-[transform,opacity] duration-150"
              style={{
                width: `${100 / sorted.length}%`,
                transform: `translateX(${(hoveredIndex ?? lastIndexRef.current) * 100}%)`,
                opacity: hoveredIndex !== null ? 1 : 0,
              }}
            />
          </div>
        </div>

        {/* X-axis labels — rotated for readability */}
        <div
          className="border-foreground/30 flex border-t"
          style={{ marginLeft: '3rem', height: '60px' }}
        >
          {sorted.map((item, index) => (
            <div key={index} className="relative flex-1">
              <span
                className="text-muted-foreground absolute left-1/2 top-1 origin-top-left text-xs"
                style={{
                  transform: 'rotate(-40deg) translateX(-50%)',
                  whiteSpace: 'nowrap',
                  maxWidth: '100px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.name}
              </span>
            </div>
          ))}
        </div>

        {/* Tooltip — fixed position, anchored to column */}
        {tooltip.visible && tooltip.item && (
          <div
            ref={tooltipRef}
            className="bg-card border-border pointer-events-none fixed z-50 rounded-lg border p-3 shadow-lg"
            style={{
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            <p className="text-foreground font-medium">{tooltip.item.name}</p>
            <p className="text-muted-foreground text-sm">
              Retention:{' '}
              <span className="text-foreground font-semibold">
                {Math.round(tooltip.item.retentionRate * 100)}%
              </span>
            </p>
            <p className="text-muted-foreground text-sm">
              {tooltip.item.returnedCount} of {tooltip.item.baseCount} returned
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
