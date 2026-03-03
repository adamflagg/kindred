/**
 * CssVerticalGroupedBarChart - Generic pure CSS vertical grouped bar chart.
 *
 * Renders N bars side-by-side per X-axis column.
 * Uses shared utilities from cssChartUtils for layout, tooltip, and axis rendering.
 *
 * STUB: Types exported for TDD test compilation. Implementation pending.
 */

import type { ReactNode } from 'react'

export interface GroupedBarSeries {
  key: string
  label: string
  color: string
}

export interface CssVerticalGroupedBarChartProps {
  data: Array<{ name: string; [key: string]: string | number | null }>
  series: GroupedBarSeries[]
  title?: string
  height?: number
  yAxisMax?: number
  yAxisFormat?: ((tick: number) => string) | undefined
  rotateLabels?: boolean
  renderTooltip?: ((item: Record<string, unknown>, series: GroupedBarSeries[]) => ReactNode) | undefined
  onBarClick?: ((item: Record<string, unknown>, seriesKey: string) => void) | undefined
  className?: string
}

export function CssVerticalGroupedBarChart(props: CssVerticalGroupedBarChartProps) {
  // Stub: implementation pending. Access props to avoid unused-vars lint error.
  void props
  return null
}
