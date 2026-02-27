/**
 * CssHorizontalBarChart - Pure CSS flexbox horizontal bar chart.
 *
 * Replaces Recharts BarChart (layout="vertical") with native CSS bars
 * that flow naturally in card containers without manual height/width tuning.
 * Supports drill-down: click a bar to show matching campers.
 */

import { useState, useCallback, useRef } from 'react'
import type { DrilldownFilter } from '../../types/metrics'

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
  breakdownType?: DrilldownFilter['type']
  onBarClick?: (filter: DrilldownFilter) => void
  className?: string
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  item: ChartDataItem | null
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

export function CssHorizontalBarChart({
  data,
  title,
  color = 'hsl(160, 100%, 35%)',
  height = 300,
  breakdownType,
  onBarClick,
  className = '',
}: CssHorizontalBarChartProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  })
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const isClickable = !!onBarClick && !!breakdownType
  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const ticks = getNiceTicks(maxValue)
  const axisMax = ticks[ticks.length - 1] ?? maxValue

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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, item: ChartDataItem) => {
      let x = e.clientX + 12
      let y = e.clientY - 12
      const tt = tooltipRef.current
      if (tt) {
        const { width, height } = tt.getBoundingClientRect()
        if (x + width > window.innerWidth - 8) x = e.clientX - width - 12
        if (y - height / 2 < 8) y = height / 2 + 8
        if (y + height / 2 > window.innerHeight - 8) y = window.innerHeight - height / 2 - 8
      }
      setTooltip({ visible: true, x, y, item })
    },
    []
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }))
  }, [])

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

      <div className="relative flex flex-col justify-center" style={{ height }}>
        {data.map((item, index) => (
          <div
            key={index}
            className={`flex items-center gap-3 rounded py-0.5 transition-colors ${hoveredIndex === index ? 'bg-foreground/10' : ''} ${isClickable ? 'cursor-pointer' : ''}`}
            onClick={() => isClickable && handleClick(item)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseMove={(e) => handleMouseMove(e, item)}
            onMouseLeave={() => { setHoveredIndex(null); handleMouseLeave() }}
          >
            {/* Label */}
            <span className="text-muted-foreground w-20 shrink-0 truncate text-right text-sm">
              {item.name}
            </span>

            {/* Bar track with gridlines */}
            <div className="relative flex-1 overflow-hidden rounded" style={{ height: `${Math.max(24, Math.floor((height - 48) / data.length) - 4)}px` }}>
              {/* Gridlines */}
              {ticks.slice(1).map((tick) => (
                <div
                  key={tick}
                  className="border-border/50 absolute top-0 h-full border-l border-dashed"
                  style={{ left: `${(tick / axisMax) * 100}%` }}
                />
              ))}
              {/* Background track */}
              <div className="bg-muted absolute inset-0 rounded" />
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
            <span className="text-muted-foreground w-10 shrink-0 text-right text-sm tabular-nums">
              {item.value}
            </span>
          </div>
        ))}

        {/* X-axis tick labels */}
        <div className="mt-2 flex items-center gap-3">
          <span className="w-20 shrink-0" />
          <div className="relative h-5 flex-1">
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
          <span className="w-10 shrink-0" />
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
                Percentage:{' '}
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
