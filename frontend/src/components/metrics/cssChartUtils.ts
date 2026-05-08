/**
 * Shared utilities for CSS chart components.
 *
 * Extracted from CssHorizontalBarChart to avoid duplication across
 * CssStackedHorizontalBarChart, CssVerticalRetentionBarChart, and
 * other vertical/horizontal CSS charts.
 */

import {
  type MouseEvent,
  type RefObject,
  type ReactNode,
  createElement,
  Fragment,
  useState,
  useCallback,
  useRef,
} from 'react'

/** Height for straight x-axis labels (px). */
export const X_AXIS_HEIGHT_STRAIGHT = 34
/** Height for rotated x-axis labels (px). Matches the VerticalXAxis rotated container. */
export const X_AXIS_HEIGHT_ROTATED = 72

export type YAxisWidth = 'w-8' | 'w-10'

/** Derive the x-axis margin-left from the y-axis Tailwind width class. */
export function getYAxisMarginLeft(width: YAxisWidth = 'w-8'): string {
  return width === 'w-10' ? '3rem' : '2.5rem'
}

function pickNiceResidual(residual: number): number {
  if (residual <= 1.5) return 1
  if (residual <= 3) return 2
  if (residual <= 7) return 5
  return 10
}

/**
 * Calculate nice tick values for a chart axis.
 * Returns evenly spaced round numbers from 0 to at least `max`.
 */
export function getNiceTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0]
  const rawInterval = max / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)))
  const residual = rawInterval / magnitude
  const interval = pickNiceResidual(residual) * magnitude
  const ticks: number[] = []
  for (let v = 0; v <= max; v += interval) {
    const rounded = Math.round(v)
    if (ticks.length === 0 || rounded !== ticks[ticks.length - 1]) {
      ticks.push(rounded)
    }
  }
  const last = ticks[ticks.length - 1]
  // Only add another tick if the data max meaningfully exceeds the last tick (>2% overshoot).
  // Prevents wasted headroom when max barely exceeds a tick (e.g., 301 vs 300 → skip 350).
  if (last !== undefined && last < max && (max - last) / interval > 0.02) {
    const ceil = Math.ceil(max / interval) * interval
    if (ceil !== last) ticks.push(ceil)
  }
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
    return { mode: 'sparse', maxWidth: 120, gap: 0, columnPadding: 20 }
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

/**
 * Hook encapsulating tooltip state, mouse tracking, and viewport clamping.
 * Returns tooltip state, a ref for the tooltip element, and mouse handlers.
 */
export function useChartTooltip<T>() {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState<T>>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  })

  const handleMouseMove = useCallback((e: MouseEvent, item: T) => {
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
    /** Height for x-axis labels: 34 for straight labels, 72 for rotated (X_AXIS_HEIGHT_ROTATED). */
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
  const [lastIndex, setLastIndex] = useState(0)

  const handleColumnEnter = useCallback((index: number, rect: DOMRect) => {
    setHoveredIndex(index)
    setLastIndex(index)
    setHoveredColRect(rect)
  }, [])

  const handleColumnMove = useCallback(
    (e: MouseEvent, item: T) => {
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
    lastIndex,
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

interface HorizontalGridlinesProps {
  ticks: number[]
  axisMax: number
  drawingHeight: number
}

/**
 * Horizontal gridlines for vertical CSS bar charts.
 * Renders a dashed line at each tick position (except 0) spanning the full width.
 * Must be placed inside the bars container (position: relative).
 */
export function HorizontalGridlines({ ticks, axisMax, drawingHeight }: HorizontalGridlinesProps) {
  return createElement(
    Fragment,
    null,
    ticks
      .filter((tick) => tick > 0)
      .map((tick) =>
        createElement('div', {
          key: `grid-${tick}`,
          className:
            'pointer-events-none absolute left-0 right-0 z-0 border-t border-dashed border-foreground/10',
          style: {
            bottom: `${(tick / axisMax) * drawingHeight}px`,
          },
        })
      )
  )
}

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
  return createElement(
    'div',
    {
      className: `relative mr-2 ${width} shrink-0`,
      style: { height: barsHeight },
    },
    ticks.map((tick) =>
      createElement(
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
  /** Column sizing to match bar layout (sparse mode alignment). */
  columnSizing?: ColumnSizing
  /** Add 1px left padding to align with bars container border-l. */
  alignBorderLeft?: boolean
  /** Use justify-evenly instead of justify-center for sparse mode. */
  justifyEvenly?: boolean
  /** Position labels at edge-to-edge positions (for line charts). */
  edgeAligned?: boolean
  /** Right padding in px to match Recharts right margin (used with edgeAligned). */
  rightPadding?: number
}

/**
 * X-axis labels for a vertical CSS chart.
 * Supports straight (centered), rotated (-40deg), and edge-aligned (line chart) modes.
 */
export function VerticalXAxis({
  labels,
  rotated = false,
  marginLeft,
  height,
  columnSizing,
  alignBorderLeft,
  justifyEvenly,
  edgeAligned,
  rightPadding = 0,
}: VerticalXAxisProps) {
  // Edge-aligned mode: absolute-position labels at evenly-spaced points from edge to edge.
  // Used for line charts where data points span 0% to 100% of the plot area.
  if (edgeAligned && labels.length > 1) {
    const n = labels.length
    return createElement(
      'div',
      {
        className: 'border-foreground/40 border-t pt-1',
        style: { ...(marginLeft ? { marginLeft } : {}) },
      },
      createElement(
        'div',
        {
          className: 'relative',
          style: { marginRight: `${rightPadding}px`, height: '20px' },
        },
        labels.map((label, i) =>
          createElement(
            'span',
            {
              key: i,
              className: 'text-muted-foreground absolute text-sm',
              style: {
                left: `${(i / (n - 1)) * 100}%`,
                transform: 'translateX(-50%)',
              },
            },
            label
          )
        )
      )
    )
  }

  const isSparse = columnSizing?.mode === 'sparse'
  const justifyClass = isSparse ? (justifyEvenly ? 'justify-evenly' : 'justify-center') : ''
  const sparseStyle = isSparse
    ? { maxWidth: `${columnSizing.maxWidth}px`, width: '100%' }
    : undefined

  if (rotated) {
    return createElement(
      'div',
      {
        className: `border-foreground/40 flex border-t ${justifyClass}`,
        style: {
          ...(marginLeft ? { marginLeft } : {}),
          height: height ?? '72px',
          ...(columnSizing ? { gap: `${columnSizing.gap}px` } : {}),
          ...(alignBorderLeft ? { paddingLeft: '1px' } : {}),
        },
      },
      labels.map((label, i) =>
        createElement(
          'div',
          {
            key: i,
            className: `relative ${isSparse ? '' : 'flex-1'}`,
            style: sparseStyle,
          },
          // Tick mark: 6px vertical line from x-axis, centered on column
          createElement('div', {
            className: 'border-foreground/40 absolute left-1/2 top-0 border-l',
            style: { height: '6px' },
          }),
          // Label: text-end anchored near the tick (matches Recharts textAnchor="end")
          createElement(
            'span',
            {
              className: 'text-muted-foreground absolute top-[6px] text-xs',
              style: {
                right: '50%',
                transform: 'rotate(-40deg)',
                transformOrigin: 'top right',
                whiteSpace: 'nowrap',
                maxWidth: '80px',
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
  return createElement(
    'div',
    {
      className: `border-foreground/40 flex border-t pt-1 ${justifyClass}`,
      style: {
        ...(marginLeft ? { marginLeft } : {}),
        ...(columnSizing ? { gap: `${columnSizing.gap}px` } : {}),
        ...(alignBorderLeft ? { paddingLeft: '1px' } : {}),
      },
    },
    labels.map((label, i) =>
      createElement(
        'div',
        {
          key: i,
          className: `text-center ${isSparse ? '' : 'flex-1'}`,
          style: sparseStyle,
        },
        createElement('span', { className: 'text-muted-foreground text-sm' }, label)
      )
    )
  )
}

interface ColumnHoverOverlayProps {
  itemCount: number
  hoveredIndex: number | null
  lastIndex: number
  /** Gap in px between columns (matches the flex container gap). */
  gap?: number
  /** Constrain overlay height to the drawing area (px). Anchored to bottom. */
  height?: number
}

/**
 * Sliding hover highlight overlay for vertical CSS bar chart columns.
 * Accounts for inter-column gap so the overlay aligns with flex items.
 */
export function ColumnHoverOverlay({
  itemCount,
  hoveredIndex,
  lastIndex,
  gap = 0,
  height,
}: ColumnHoverOverlayProps) {
  const idx = hoveredIndex ?? lastIndex
  const verticalStyle =
    height != null ? { bottom: 0, height: `${height}px` } : { top: 0, bottom: 0 }

  if (gap === 0) {
    // Simple case: no gap, columns divide evenly
    return createElement('div', {
      className:
        'pointer-events-none absolute left-0 z-0 rounded bg-foreground/[0.06] transition-[transform,opacity] duration-150',
      style: {
        ...verticalStyle,
        width: `${100 / itemCount}%`,
        transform: `translateX(${idx * 100}%)`,
        opacity: hoveredIndex !== null ? 1 : 0,
      },
    })
  }

  // Gap-aware: column width = (100% - totalGap) / N, offset = idx/N of container + idx gaps
  const totalGap = (itemCount - 1) * gap
  const colWidthPct = 100 / itemCount
  // left = idx * (colWidth + gap) = idx/N * 100% + idx * gap - idx/N * totalGap
  // Simplified: idx/N * (100% - totalGap) + idx * gap
  const pctPart = (idx / itemCount) * 100
  const pxPart = idx * gap - (idx / itemCount) * totalGap

  return createElement('div', {
    className:
      'pointer-events-none absolute z-0 rounded bg-foreground/[0.06] transition-[left,opacity] duration-150',
    style: {
      ...verticalStyle,
      width: `calc(${colWidthPct}% - ${totalGap / itemCount}px)`,
      left: `calc(${pctPart}% + ${pxPart}px)`,
      opacity: hoveredIndex !== null ? 1 : 0,
    },
  })
}

interface VerticalTooltipShellProps {
  visible: boolean
  x: number
  y: number
  tooltipRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}

/**
 * Tooltip positioning/styling wrapper for vertical CSS bar charts.
 * Renders when visible with fixed positioning at (x, y).
 */
export function VerticalTooltipShell({
  visible,
  x,
  y,
  tooltipRef,
  children,
}: VerticalTooltipShellProps) {
  if (!visible) return null
  return createElement(
    'div',
    {
      ref: tooltipRef,
      className:
        'bg-card border-border pointer-events-none fixed z-50 rounded-lg border p-3 shadow-lg',
      style: { left: x, top: y },
    },
    children
  )
}
