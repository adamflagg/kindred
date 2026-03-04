import React from 'react'

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

export function CssLineChart<T extends Record<string, unknown>>(_props: CssLineChartProps<T>): React.ReactNode {
  return null // stub — tests should fail at assertion level
}
