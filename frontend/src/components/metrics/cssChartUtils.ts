/**
 * Shared utilities for CSS chart components.
 *
 * Extracted from CssHorizontalBarChart to avoid duplication across
 * CssRetentionBarChart and CssStackedHorizontalBarChart.
 */

import { useState, useCallback, useRef } from 'react'

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

/**
 * Calculate bar sizing for horizontal CSS bar charts.
 * Shared across CssHorizontalBarChart, CssStackedHorizontalBarChart, and CssRetentionBarChart.
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
