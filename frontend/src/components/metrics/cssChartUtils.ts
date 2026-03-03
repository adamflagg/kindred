/**
 * Shared utilities for CSS chart components.
 *
 * Extracted from CssHorizontalBarChart to avoid duplication across
 * CssStackedHorizontalBarChart, CssVerticalRetentionBarChart, and
 * other vertical/horizontal CSS charts.
 */

import React, { useState, useCallback, useRef, type ReactNode } from 'react'

/**
 * Calculate nice tick values for a chart axis.
 * Returns evenly spaced round numbers from 0 to at least `max`.
 */
export function getNiceTicks(max: number, count = 4): number[] {
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

export interface TooltipItem {
  label: string
  lines: Array<{ label: string; value: string; color?: string }>
}

export interface TooltipState<T> {
  visible: boolean
  x: number
  y: number
  item: T | null
}

/**
 * Hook encapsulating tooltip state, mouse tracking, and viewport clamping.
 * Returns tooltip state, a ref for the tooltip element, and mouse handlers.
 */
export interface BarSizing {
  isDense: boolean
  barHeight: number
  rowGap: number
  axisArea: number
}

export interface ColumnSizing {
  mode: 'sparse' | 'normal' | 'dense'
  maxWidth: number | null // null = unconstrained (flex-1)
  gap: number // px gap between columns
  columnPadding: number // px padding inside each column
}

/**
 * Calculate column sizing for vertical CSS bar charts.
 * Adapts gap, maxWidth, and padding based on column count.
 */
export function calculateColumnSizing(columnCount: number): ColumnSizing {
  if (columnCount <= 4) {
    return { mode: 'sparse', maxWidth: 80, gap: 16, columnPadding: 4 }
  }
  if (columnCount <= 9) {
    return { mode: 'normal', maxWidth: null, gap: 4, columnPadding: 4 }
  }
  return { mode: 'dense', maxWidth: null, gap: 2, columnPadding: 1 }
}

/**
 * Calculate bar sizing for horizontal CSS bar charts.
 * Shared across CssHorizontalBarChart and CssStackedHorizontalBarChart.
 */
export function calculateBarSizing(containerHeight: number, itemCount: number): BarSizing {
  const AXIS_TICKS = 24 // h-5 (20px) + pt-1 (4px)
  const MIN_ROW = 20 // text-sm line-height — actual minimum row height
  const normalAvail = containerHeight - AXIS_TICKS - 8 // 8px = mt-2
  const isDense = normalAvail < itemCount * (MIN_ROW + 1)
  const axisArea = AXIS_TICKS + (isDense ? 4 : 8) // mt-1 vs mt-2
  const availableForBars = containerHeight - axisArea
  const rowGap = isDense
    ? Math.max(0, Math.floor((availableForBars - itemCount * MIN_ROW) / Math.max(itemCount - 1, 1)))
    : Math.max(2, Math.min(24, Math.floor((availableForBars / itemCount) * 0.2)))
  const totalGap = itemCount > 1 ? (itemCount - 1) * rowGap : 0
  const barHeight = Math.min(96, Math.max(8, Math.floor((availableForBars - totalGap) / itemCount)))
  return { isDense, barHeight, rowGap, axisArea }
}

export function useChartTooltip<T>() {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState<T>>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  })

  const handleMouseMove = useCallback((e: React.MouseEvent, item: T) => {
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
  }, [])

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }))
  }, [])

  return { tooltip, tooltipRef, handleMouseMove, handleMouseLeave }
}

// ---------------------------------------------------------------------------
// Vertical chart utilities
// ---------------------------------------------------------------------------

/**
 * Layout dimensions for a vertical CSS bar chart.
 */
export interface VerticalChartLayout {
  /** Available height for the bars area (height minus x-axis). */
  barsHeight: number
  /** Drawing height for bars (barsHeight minus top padding for labels). */
  drawingHeight: number
  /** Height reserved for the x-axis labels. */
  xAxisHeight: number
}

/**
 * Calculate the vertical layout dimensions for a CSS bar chart.
 *
 * Replaces the repeated `barsHeight = height - 34` / `drawingHeight = barsHeight - 16`
 * pattern found in CssVerticalRetentionBarChart and CssVerticalStackedBarChart.
 *
 * @param height   - Total chart height in pixels.
 * @param options  - Optional overrides for xAxisHeight (default 34) and topPadding (default 16).
 */
export function calculateVerticalLayout(
  height: number,
  options?: {
    /** Height for x-axis labels: 34 for straight labels, 60 for rotated. */
    xAxisHeight?: number
    /** Space above bars for value labels. */
    topPadding?: number
  }
): VerticalChartLayout {
  const xAxisHeight = options?.xAxisHeight ?? 34
  const topPadding = options?.topPadding ?? 16
  const barsHeight = height - xAxisHeight
  const drawingHeight = barsHeight - topPadding
  return { barsHeight, drawingHeight, xAxisHeight }
}

/**
 * Column-anchored tooltip hook for vertical CSS bar charts.
 *
 * Consolidates the identical state + handlers from CssVerticalRetentionBarChart
 * and CssVerticalStackedBarChart: hoveredIndex, hoveredColRect, lastIndexRef,
 * chartRef, tooltipRef, and the three mouse handlers.
 *
 * Tooltip positioning: anchor to right of column, flip left on overflow.
 * Y follows cursor, clamped to chart area. Falls back to cursor-relative
 * when chartRef or colRect is unavailable.
 */
export function useVerticalColumnTooltip<T>() {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState<T>>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  })
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoveredColRect, setHoveredColRect] = useState<DOMRect | null>(null)
  const lastIndexRef = useRef(0)
  if (hoveredIndex !== null) lastIndexRef.current = hoveredIndex

  const handleColumnEnter = useCallback((index: number, rect: DOMRect) => {
    setHoveredIndex(index)
    setHoveredColRect(rect)
  }, [])

  const handleColumnMove = useCallback(
    (e: React.MouseEvent, item: T) => {
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

  const handleColumnLeave = useCallback(() => {
    setHoveredIndex(null)
    setHoveredColRect(null)
    setTooltip((prev) => ({ ...prev, visible: false }))
  }, [])

  return {
    hoveredIndex,
    lastIndex: lastIndexRef.current,
    chartRef,
    tooltipRef,
    tooltip,
    handleColumnEnter,
    handleColumnMove,
    handleColumnLeave,
  }
}

// ---------------------------------------------------------------------------
// Sub-components for vertical charts
// ---------------------------------------------------------------------------

interface VerticalYAxisProps {
  ticks: number[]
  axisMax: number
  drawingHeight: number
  barsHeight: number
  /** Tailwind width class, e.g. 'w-8' or 'w-10'. Default: 'w-8'. */
  width?: string
  /** Custom tick formatter. Default: String(tick). */
  formatTick?: ((tick: number) => string) | undefined
}

/**
 * Y-axis tick labels for a vertical CSS bar chart.
 * Each tick is absolutely positioned at `bottom: (tick/axisMax) * drawingHeight`.
 */
export function VerticalYAxis({
  ticks,
  axisMax,
  drawingHeight,
  barsHeight,
  width = 'w-8',
  formatTick = String,
}: VerticalYAxisProps) {
  return React.createElement(
    'div',
    {
      className: `relative mr-2 ${width} shrink-0`,
      style: { height: barsHeight },
    },
    ticks.map((tick) =>
      React.createElement(
        'span',
        {
          key: tick,
          className: 'text-muted-foreground absolute right-0 text-xs font-semibold tabular-nums',
          style: {
            bottom: `${(tick / axisMax) * drawingHeight}px`,
            transform: 'translateY(50%)',
          },
        },
        formatTick(tick)
      )
    )
  )
}

interface VerticalXAxisProps {
  labels: string[]
  /** Rotate labels -40deg for long text. */
  rotated?: boolean
  /** Custom margin-left (e.g. '3rem' or '2.5rem'). */
  marginLeft?: string
  /** Custom height for the axis container. Default: '60px' when rotated. */
  height?: string
}

/**
 * X-axis labels for a vertical CSS bar chart.
 * Supports straight (centered) and rotated (-40deg) modes.
 */
export function VerticalXAxis({ labels, rotated = false, marginLeft, height }: VerticalXAxisProps) {
  if (rotated) {
    return React.createElement(
      'div',
      {
        className: 'border-foreground/30 flex border-t',
        style: {
          ...(marginLeft ? { marginLeft } : {}),
          height: height ?? '60px',
        },
      },
      labels.map((label, i) =>
        React.createElement(
          'div',
          { key: i, className: 'relative flex-1' },
          React.createElement(
            'span',
            {
              className: 'text-muted-foreground absolute left-1/2 top-1 origin-top-left text-xs',
              style: {
                transform: 'rotate(-40deg) translateX(-50%)',
                whiteSpace: 'nowrap',
                maxWidth: '100px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            label
          )
        )
      )
    )
  }

  // Straight labels
  return React.createElement(
    'div',
    {
      className: 'border-foreground/30 flex border-t pt-1',
      style: marginLeft ? { marginLeft } : undefined,
    },
    labels.map((label, i) =>
      React.createElement(
        'div',
        { key: i, className: 'flex-1 text-center' },
        React.createElement('span', { className: 'text-muted-foreground text-sm' }, label)
      )
    )
  )
}

interface ColumnHoverOverlayProps {
  itemCount: number
  hoveredIndex: number | null
  lastIndex: number
}

/**
 * Sliding hover highlight overlay for vertical CSS bar chart columns.
 * Width is 1/itemCount of the chart, slides to the hovered column.
 */
export function ColumnHoverOverlay({ itemCount, hoveredIndex, lastIndex }: ColumnHoverOverlayProps) {
  return React.createElement('div', {
    className:
      'pointer-events-none absolute inset-y-0 left-0 z-0 rounded bg-foreground/[0.06] transition-[transform,opacity] duration-150',
    style: {
      width: `${100 / itemCount}%`,
      transform: `translateX(${(hoveredIndex ?? lastIndex) * 100}%)`,
      opacity: hoveredIndex !== null ? 1 : 0,
    },
  })
}

interface VerticalTooltipShellProps {
  visible: boolean
  x: number
  y: number
  tooltipRef: React.RefObject<HTMLDivElement | null>
  children: ReactNode
}

/**
 * Tooltip positioning/styling wrapper for vertical CSS bar charts.
 * Renders when visible with fixed positioning at (x, y).
 */
export function VerticalTooltipShell({ visible, x, y, tooltipRef, children }: VerticalTooltipShellProps) {
  if (!visible) return null
  return React.createElement(
    'div',
    {
      ref: tooltipRef,
      className: 'bg-card border-border pointer-events-none fixed z-50 rounded-lg border p-3 shadow-lg',
      style: { left: x, top: y },
    },
    children
  )
}
