import type { ReactNode } from 'react'

export interface ChartCardYAxis {
  ticks: number[]
  axisMax: number
  drawingHeight: number
  barsHeight: number
  width?: string
  formatTick?: (tick: number) => string
}

export interface ChartCardProps {
  title?: string
  height?: number
  className?: string
  yAxis?: ChartCardYAxis
  xLabels?: string[]
  xAxisRotated?: boolean
  xAxisMarginLeft?: string
  legend?: Array<{ label: string; color: string }>
  isEmpty?: boolean
  emptyMessage?: string
  children: ReactNode
}

export function ChartCard(_props: ChartCardProps): ReactNode {
  return null
}
