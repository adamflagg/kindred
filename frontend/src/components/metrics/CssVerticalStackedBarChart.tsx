/**
 * CssVerticalStackedBarChart - Pure CSS flexbox vertical stacked bar chart.
 *
 * Replaces Recharts stacked BarChart with native CSS columns that size
 * proportionally using flex. Supports drill-down by grade and hover tooltips.
 *
 * Note: Only M/F tracked since CampMinder sex field only has these values.
 */

import { useState, useCallback, useRef } from 'react'
import type { GenderByGradeBreakdown, DrilldownFilter } from '../../types/metrics'
import { ChartLegend } from './ChartLegend'

const COLORS = {
  male: 'hsl(200, 70%, 50%)',
  female: 'hsl(350, 70%, 50%)',
}

interface CssVerticalStackedBarChartProps {
  data: GenderByGradeBreakdown[]
  title?: string
  height?: number
  onBarClick?: (filter: DrilldownFilter) => void
  className?: string
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  item: GenderByGradeBreakdown | null
}

function getNiceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const rawInterval = max / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)))
  const residual = rawInterval / magnitude
  const niceResidual = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10
  const interval = niceResidual * magnitude
  const ticks: number[] = []
  for (let v = 0; v <= max; v += interval) {
    ticks.push(Math.round(v))
  }
  const last = ticks[ticks.length - 1]
  if (last !== undefined && last < max) ticks.push(Math.ceil(max / interval) * interval)
  return ticks
}

export function CssVerticalStackedBarChart({
  data,
  title = 'Gender by Grade',
  height = 300,
  onBarClick,
  className = '',
}: CssVerticalStackedBarChartProps) {
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
  const maxTotal = Math.max(...data.map((d) => d.total), 1)
  const ticks = getNiceTicks(maxTotal)
  const axisMax = ticks[ticks.length - 1] ?? maxTotal

  const getGradeLabel = (grade: number | null) =>
    grade !== null ? `Grade ${grade}` : 'Unknown'

  const getShortGradeLabel = (grade: number | null) =>
    grade !== null ? String(grade) : '?'

  const handleClick = useCallback(
    (item: GenderByGradeBreakdown) => {
      if (!onBarClick) return
      const value = item.grade !== null ? String(item.grade) : 'null'
      onBarClick({
        type: 'grade',
        value,
        label: getGradeLabel(item.grade),
      })
    },
    [onBarClick]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, item: GenderByGradeBreakdown) => {
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

        // Y: follow cursor with slight wiggle, clamped to chart area
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
          <div className="relative mr-2 w-8 shrink-0" style={{ height: barsHeight }}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="text-muted-foreground absolute right-0 text-xs font-semibold tabular-nums"
                style={{
                  bottom: `${(tick / axisMax) * drawingHeight}px`,
                  transform: 'translateY(50%)',
                }}
              >
                {tick}
              </span>
            ))}
          </div>

          {/* Bars area */}
          <div ref={chartRef} className="border-foreground/30 relative flex flex-1 items-end border-l" style={{ height: barsHeight }}>
            {data.map((item, index) => {
              const heightPct = (item.total / axisMax) * 100
              const malePct = item.total > 0 ? (item.male_count / item.total) * 100 : 0
              const femalePct = item.total > 0 ? (item.female_count / item.total) * 100 : 0

              return (
                <div
                  key={index}
                  className={`relative flex h-full flex-1 flex-col items-center justify-end px-1 ${isClickable ? 'cursor-pointer' : ''}`}
                  onMouseEnter={(e) => {
                    setHoveredIndex(index)
                    setHoveredColRect(e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseMove={(e) => handleMouseMove(e, item)}
                  onMouseLeave={() => { setHoveredIndex(null); setHoveredColRect(null); handleMouseLeave() }}
                  onClick={() => isClickable && handleClick(item)}
                >

                  {/* Total label above bar */}
                  <span className="text-muted-foreground relative z-10 mb-1 text-sm tabular-nums">
                    {item.total}
                  </span>

                  {/* Stacked bar */}
                  <div
                    className="relative z-10 flex w-full flex-col overflow-hidden rounded-t transition-all duration-300"
                    style={{
                      height: `${(heightPct / 100) * drawingHeight}px`,
                      minHeight: item.total > 0 ? '4px' : '0px',
                    }}
                  >
                    {/* Female segment (top) */}
                    {item.female_count > 0 && (
                      <div
                        className="w-full transition-all duration-300"
                        style={{
                          flex: femalePct,
                          backgroundColor: COLORS.female,
                        }}
                      />
                    )}
                    {/* Male segment (bottom) */}
                    {item.male_count > 0 && (
                      <div
                        className="w-full transition-all duration-300"
                        style={{
                          flex: malePct,
                          backgroundColor: COLORS.male,
                        }}
                      />
                    )}
                  </div>
                </div>
              )
            })}

            {/* Sliding hover overlay — single div that slides between columns */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 z-0 rounded bg-foreground/[0.06] transition-[transform,opacity] duration-150"
              style={{
                width: `${100 / data.length}%`,
                transform: `translateX(${(hoveredIndex ?? lastIndexRef.current) * 100}%)`,
                opacity: hoveredIndex !== null ? 1 : 0,
              }}
            />
          </div>
        </div>

        {/* X-axis labels */}
        <div className="border-foreground/30 flex border-t pt-1" style={{ marginLeft: '2.5rem' }}>
          {data.map((item, index) => (
            <div key={index} className="flex-1 text-center">
              <span className="text-muted-foreground text-sm">{getShortGradeLabel(item.grade)}</span>
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
            <p className="text-foreground mb-2 font-medium">
              {getGradeLabel(tooltip.item.grade)}
            </p>
            <p className="text-muted-foreground text-sm">
              <span style={{ color: COLORS.male }}>Male:</span>{' '}
              <span className="text-foreground font-semibold">
                {tooltip.item.male_count} (
                {tooltip.item.total > 0
                  ? ((tooltip.item.male_count / tooltip.item.total) * 100).toFixed(0)
                  : 0}
                %)
              </span>
            </p>
            <p className="text-muted-foreground text-sm">
              <span style={{ color: COLORS.female }}>Female:</span>{' '}
              <span className="text-foreground font-semibold">
                {tooltip.item.female_count} (
                {tooltip.item.total > 0
                  ? ((tooltip.item.female_count / tooltip.item.total) * 100).toFixed(0)
                  : 0}
                %)
              </span>
            </p>
            <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-sm">
              Total: <span className="text-foreground font-semibold">{tooltip.item.total}</span>
            </p>
          </div>
        )}
      </div>

      <ChartLegend
        items={[
          { label: 'Male', color: COLORS.male },
          { label: 'Female', color: COLORS.female },
        ]}
        className="mt-1"
      />
    </div>
  )
}
