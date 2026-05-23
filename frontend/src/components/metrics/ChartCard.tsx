import type { ReactNode } from 'react'
import { VerticalYAxis, VerticalXAxis } from './cssChartUtils'
import { ChartLegend } from './ChartLegend'

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
  headerRight?: ReactNode
  height?: number
  className?: string
  yAxis?: ChartCardYAxis
  xLabels?: string[]
  xAxisRotated?: boolean
  xAxisMarginLeft?: string
  xAxisEdgeAligned?: boolean
  xAxisRightPadding?: number
  legend?: Array<{ label: string; color: string }>
  isEmpty?: boolean
  emptyMessage?: string
  children: ReactNode
}

export function ChartCard({
  title,
  headerRight,
  className = '',
  yAxis,
  xLabels,
  xAxisRotated,
  xAxisMarginLeft,
  xAxisEdgeAligned,
  xAxisRightPadding,
  legend,
  isEmpty,
  emptyMessage = 'No data available',
  children,
}: ChartCardProps) {
  if (isEmpty) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        {(title || headerRight) && (
          <div className="mb-2 flex items-center justify-between gap-2">
            {title && <h3 className="text-foreground text-base font-semibold">{title}</h3>}
            {headerRight}
          </div>
        )}
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          {emptyMessage}
        </div>
      </div>
    )
  }

  const yAxisMargin = xAxisMarginLeft ?? (yAxis?.width === 'w-10' ? '3rem' : '2.5rem')

  return (
    <div className={`card-lodge flex flex-col px-4 pt-4 pb-4 ${className}`}>
      {(title || headerRight) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h3 className="text-foreground text-base font-semibold">{title}</h3>}
          {headerRight}
        </div>
      )}

      <div className="relative flex-1">
        {yAxis ? (
          <>
            <div className="flex">
              <VerticalYAxis
                ticks={yAxis.ticks}
                axisMax={yAxis.axisMax}
                drawingHeight={yAxis.drawingHeight}
                barsHeight={yAxis.barsHeight}
                width={yAxis.width ?? 'w-8'}
                formatTick={yAxis.formatTick}
              />
              <div
                className={`border-foreground/40 relative flex-1 border-l ${xAxisEdgeAligned ? 'overflow-visible' : ''}`}
                style={{ height: yAxis.barsHeight }}
              >
                {children}
              </div>
            </div>
            {xLabels && (
              <VerticalXAxis
                labels={xLabels}
                {...(xAxisRotated !== undefined && { rotated: xAxisRotated })}
                marginLeft={yAxisMargin}
                {...(xAxisEdgeAligned && { edgeAligned: true })}
                {...(xAxisRightPadding !== undefined && { rightPadding: xAxisRightPadding })}
              />
            )}
          </>
        ) : (
          children
        )}
      </div>

      {legend && legend.length > 0 && <ChartLegend items={legend} className="mt-3" />}
    </div>
  )
}
