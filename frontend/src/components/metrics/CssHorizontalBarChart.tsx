/**
 * CssHorizontalBarChart - Pure CSS flexbox horizontal bar chart.
 *
 * Replaces Recharts BarChart (layout="vertical") with native CSS bars
 * that flow naturally in card containers without manual height/width tuning.
 * Supports drill-down: click a bar to show matching campers.
 */

import { useState, useCallback, useMemo } from 'react'
import type { DrilldownFilter } from '../../types/metrics'
import { getNiceTicks, useChartTooltip, calculateBarSizing } from './cssChartUtils'

interface ChartDataItem {
  name: string
  value: number
  percentage?: number
  id?: string | number
}

interface CssHorizontalBarChartProps {
  data: ChartDataItem[]
  title?: string
  color?: string
  height?: number
  /** Width of the row label column in pixels (default: 80) */
  labelWidth?: number
  /** Width of the value column in pixels (default: 40) */
  valueWidth?: number
  breakdownType?: DrilldownFilter['type']
  onBarClick?: (filter: DrilldownFilter) => void
  className?: string
  /** Label for the percentage line in the tooltip (default: "Percentage") */
  percentageLabel?: string
}

export function CssHorizontalBarChart({
  data,
  title,
  color = 'hsl(160, 100%, 35%)',
  height = 300,
  labelWidth = 80,
  valueWidth = 40,
  breakdownType,
  onBarClick,
  className = '',
  percentageLabel = 'Percentage',
}: CssHorizontalBarChartProps) {
  const { tooltip, tooltipRef, handleMouseMove, handleMouseLeave } =
    useChartTooltip<ChartDataItem>()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const isClickable = !!onBarClick && !!breakdownType
  const { axisMax, ticks, isDense, barHeight, rowGap } = useMemo(() => {
    const max = Math.max(...data.map((d) => d.value), 1)
    const t = getNiceTicks(max)
    const am = t.at(-1) ?? max
    const sizing = calculateBarSizing(height, data.length)
    return { axisMax: am, ticks: t, ...sizing }
  }, [data, height])

  const handleClick = useCallback(
    (item: ChartDataItem) => {
      if (!onBarClick || !breakdownType) return
      const value = item.id !== undefined ? String(item.id) : item.name
      onBarClick({
        type: breakdownType,
        value,
        label: item.name,
        ...(breakdownType === 'gender' ? { titleFormat: 'adjective' as const } : {}),
      })
    },
    [onBarClick, breakdownType]
  )

  if (data.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        {title && <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>}
        <div className="text-muted-foreground flex items-center justify-center" style={{ height }}>
          No data available
        </div>
      </div>
    )
  }

  return (
    <div className={`card-lodge p-4 ${className}`}>
      {title && <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>}

      <div className="relative flex flex-col" style={{ height }}>
        {/* Bars area - vertically centered when not filling card */}
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isDense ? '' : 'justify-center'}`}
          style={{ gap: rowGap }}
          onMouseLeave={() => {
            setHoveredIndex(null)
            handleMouseLeave()
          }}
        >
          {data.map((item, index) => {
            const rowClass = `flex items-center ${isDense ? 'gap-2' : 'gap-3'} rounded ${isClickable ? 'cursor-pointer' : ''}`
            const rowContent = (
              <>
                {/* Label */}
                <span
                  className="text-muted-foreground shrink-0 truncate text-right text-sm"
                  style={{ width: labelWidth }}
                >
                  {item.name}
                </span>

                {/* Bar track */}
                <div
                  className="relative flex-1 overflow-hidden rounded"
                  style={{ height: barHeight }}
                >
                  {/* Background track */}
                  <div
                    className={`absolute inset-0 rounded transition-colors ${hoveredIndex === index ? 'bg-foreground/20' : 'bg-muted'}`}
                  />
                  {/* Bar fill */}
                  <div
                    className="relative h-full rounded transition-all duration-300"
                    style={{
                      width: `${(item.value / axisMax) * 100}%`,
                      backgroundColor: color,
                      minWidth: item.value > 0 ? '4px' : '0px',
                    }}
                  />
                </div>

                {/* Value label */}
                <span
                  className="text-muted-foreground shrink-0 text-center text-sm tabular-nums"
                  style={{ width: valueWidth }}
                >
                  {item.value}
                </span>
              </>
            )

            // A clickable row becomes a real <button> so it's keyboard-
            // operable and gets a discoverable accessible name — bolting
            // role="button"/tabIndex/onKeyDown onto a <div> is exactly what
            // this house style avoids (kindred#2094). Non-clickable rows
            // stay plain <div>s.
            return isClickable ? (
              <button
                key={index}
                type="button"
                className={`${rowClass} w-full text-left`}
                onClick={() => handleClick(item)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseMove={(e) => handleMouseMove(e, item)}
              >
                {rowContent}
              </button>
            ) : (
              <div
                key={index}
                className={rowClass}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseMove={(e) => handleMouseMove(e, item)}
              >
                {rowContent}
              </div>
            )
          })}
        </div>

        {/* X-axis line + tick labels */}
        <div
          className={`${isDense ? 'mt-1' : 'mt-2'} flex shrink-0 items-center ${isDense ? 'gap-2' : 'gap-3'}`}
        >
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

        {/* Tooltip — fixed position, follows cursor with viewport clamping */}
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
            <p className="text-foreground font-medium">{tooltip.item.name}</p>
            <p className="text-muted-foreground text-sm">
              Count: <span className="text-foreground font-semibold">{tooltip.item.value}</span>
            </p>
            {tooltip.item.percentage !== undefined && (
              <p className="text-muted-foreground text-sm">
                {percentageLabel}:{' '}
                <span className="text-foreground font-semibold">
                  {tooltip.item.percentage.toFixed(1)}%
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
