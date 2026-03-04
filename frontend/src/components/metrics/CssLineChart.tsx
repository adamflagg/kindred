/**
 * CssLineChart - Generic SVG line chart with monotone cubic curves.
 *
 * Renders line(s) with dots, Y-axis, X-axis, grid, reference lines, tooltips, and legend.
 * Uses shared utilities from cssChartUtils and svgChartUtils.
 */

import { useState, useCallback } from 'react'
import {
  calculateVerticalLayout,
  getNiceTicks,
  VerticalYAxis,
  VerticalXAxis,
  VerticalTooltipShell,
  useChartTooltip,
} from './cssChartUtils'
import { monotoneCubicPath } from './svgChartUtils'
import { ChartLegend } from './ChartLegend'

export interface LineConfig {
  key: string
  label: string
  color: string
  valueLabelPosition?: 'top' | 'bottom'
}

export interface CssLineChartProps<T extends Record<string, unknown> = Record<string, unknown>> {
  data: T[]
  xKey: string
  lines: LineConfig[]
  title?: string
  height?: number
  yDomain?: [number, number]
  referenceLines?: Array<{ y: number }>
  formatYTick?: (value: number) => string
  formatValue?: (value: number) => string
  onDotClick?: (item: T) => void
  className?: string
}

const DOT_RADIUS = 5
const ACTIVE_DOT_RADIUS = 7
const SVG_PAD_X = 40 // left/right padding inside SVG for dot overflow
const Y_AXIS_WIDTH = 'w-8'
const Y_AXIS_MARGIN = '2.5rem'

export function CssLineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  lines,
  title,
  height = 300,
  yDomain,
  referenceLines,
  formatYTick,
  formatValue,
  onDotClick,
  className = '',
}: CssLineChartProps<T>) {
  const [hoveredDot, setHoveredDot] = useState<{ lineIdx: number; dataIdx: number } | null>(null)
  const { tooltip, tooltipRef, handleMouseMove, handleMouseLeave } = useChartTooltip<T>()

  const { barsHeight, drawingHeight } = calculateVerticalLayout(height, { xAxisHeight: 34 })

  // Compute Y-axis range
  const allValues = data.flatMap((d) => lines.map((l) => Number(d[l.key]) || 0))
  const dataMin = yDomain?.[0] ?? 0
  const dataMax = yDomain?.[1] ?? (allValues.length > 0 ? Math.max(...allValues) : 1)

  const ticks = yDomain ? getNiceTicks(dataMax, 5) : getNiceTicks(dataMax)
  const axisMax = ticks[ticks.length - 1] ?? dataMax

  // SVG dimensions
  const svgWidth = 600 // will be stretched via CSS width: 100%
  const svgHeight = drawingHeight
  const drawW = svgWidth - SVG_PAD_X * 2

  // Map data index to X position
  const xPos = useCallback(
    (i: number) => {
      if (data.length <= 1) return SVG_PAD_X
      return SVG_PAD_X + (i / (data.length - 1)) * drawW
    },
    [data.length, drawW]
  )

  // Map value to Y position (inverted: higher value = lower Y)
  const yPos = useCallback(
    (value: number) => {
      const range = axisMax - dataMin
      if (range === 0) return svgHeight / 2
      return svgHeight - ((value - dataMin) / range) * svgHeight
    },
    [axisMax, dataMin, svgHeight]
  )

  const handleDotClick = useCallback(
    (item: T) => {
      if (onDotClick) onDotClick(item)
    },
    [onDotClick]
  )

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

  return (
    <div className={`card-lodge flex flex-col px-4 pt-4 pb-4 ${className}`}>
      {title && <h3 className="text-foreground mb-2 text-base font-semibold">{title}</h3>}

      <div className="relative flex-1">
        <div className="flex">
          <VerticalYAxis
            ticks={ticks}
            axisMax={axisMax}
            drawingHeight={drawingHeight}
            barsHeight={barsHeight}
            width={Y_AXIS_WIDTH}
            formatTick={formatYTick}
          />

          <div className="border-foreground/40 relative flex-1 border-l" style={{ height: barsHeight }}>
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              style={{ bottom: 0 }}
            >
              {/* Grid lines */}
              {ticks
                .filter((t) => t > 0)
                .map((tick) => (
                  <line
                    key={`grid-${tick}`}
                    x1={0}
                    y1={yPos(tick)}
                    x2={svgWidth}
                    y2={yPos(tick)}
                    stroke="currentColor"
                    strokeOpacity={0.1}
                    strokeDasharray="3 3"
                  />
                ))}

              {/* Reference lines */}
              {referenceLines?.map((ref, i) => (
                <line
                  key={`ref-${i}`}
                  data-reference
                  x1={0}
                  y1={yPos(ref.y)}
                  x2={svgWidth}
                  y2={yPos(ref.y)}
                  stroke="currentColor"
                  strokeOpacity={0.3}
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                />
              ))}

              {/* Lines */}
              {lines.map((line) => {
                const points = data.map((d, i) => ({
                  x: xPos(i),
                  y: yPos(Number(d[line.key]) || 0),
                }))
                const pathD = monotoneCubicPath(points)
                if (!pathD) return null

                return (
                  <path
                    key={line.key}
                    data-line={line.key}
                    d={pathD}
                    fill="none"
                    stroke={line.color}
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}

              {/* Dots */}
              {lines.map((line, lineIdx) =>
                data.map((d, dataIdx) => {
                  const cx = xPos(dataIdx)
                  const cy = yPos(Number(d[line.key]) || 0)
                  const isHovered =
                    hoveredDot?.lineIdx === lineIdx && hoveredDot?.dataIdx === dataIdx
                  const r = isHovered ? ACTIVE_DOT_RADIUS : DOT_RADIUS

                  return (
                    <circle
                      key={`${line.key}-${dataIdx}`}
                      data-dot={line.key}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={line.color}
                      stroke="white"
                      strokeWidth={2}
                      style={{
                        cursor: onDotClick ? 'pointer' : 'default',
                        transition: 'r 150ms',
                      }}
                      vectorEffect="non-scaling-stroke"
                      onMouseEnter={(e) => {
                        setHoveredDot({ lineIdx, dataIdx })
                        handleMouseMove(e, d)
                      }}
                      onMouseMove={(e) => handleMouseMove(e, d)}
                      onMouseLeave={() => {
                        setHoveredDot(null)
                        handleMouseLeave()
                      }}
                      onClick={() => handleDotClick(d)}
                    />
                  )
                })
              )}

              {/* Value labels */}
              {formatValue &&
                lines.map((line) =>
                  data.map((d, dataIdx) => {
                    const cx = xPos(dataIdx)
                    const cy = yPos(Number(d[line.key]) || 0)
                    const offset = line.valueLabelPosition === 'bottom' ? 16 : -12

                    return (
                      <text
                        key={`label-${line.key}-${dataIdx}`}
                        data-value-label={line.key}
                        x={cx}
                        y={cy + offset}
                        textAnchor="middle"
                        fontSize={11}
                        fill="currentColor"
                        opacity={0.7}
                      >
                        {formatValue(Number(d[line.key]) || 0)}
                      </text>
                    )
                  })
                )}
            </svg>
          </div>
        </div>

        {/* X-axis labels */}
        <VerticalXAxis
          labels={data.map((d) => String(d[xKey]))}
          marginLeft={Y_AXIS_MARGIN}
        />

        {/* Tooltip */}
        {tooltip.item && (
          <VerticalTooltipShell
            visible={tooltip.visible}
            x={tooltip.x}
            y={tooltip.y}
            tooltipRef={tooltipRef}
          >
            <div className="text-sm font-semibold">{String((tooltip.item as T)[xKey])}</div>
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2 text-sm">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
                <span className="text-muted-foreground">{line.label}:</span>
                <span className="font-medium">{String((tooltip.item as T)[line.key])}</span>
              </div>
            ))}
          </VerticalTooltipShell>
        )}
      </div>

      {/* Legend */}
      {lines.length > 1 && (
        <ChartLegend
          items={lines.map((l) => ({ label: l.label, color: l.color }))}
          className="mt-3"
        />
      )}
    </div>
  )
}
