/**
 * CssVerticalGroupedBarChart - Generic pure CSS vertical grouped bar chart.
 *
 * Renders N bars side-by-side per X-axis column. Uses shared utilities
 * from cssChartUtils for layout, tooltip, and axis rendering.
 */

import { useCallback, type ReactNode } from 'react'
import {
  calculateVerticalLayout,
  calculateColumnSizing,
  useVerticalColumnTooltip,
  getNiceTicks,
  VerticalYAxis,
  VerticalXAxis,
  ColumnHoverOverlay,
  VerticalTooltipShell,
} from './cssChartUtils'
import { ChartLegend } from './ChartLegend'

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

export function CssVerticalGroupedBarChart({
  data,
  series,
  title,
  height = 300,
  yAxisMax,
  yAxisFormat,
  rotateLabels,
  renderTooltip,
  onBarClick,
  className = '',
}: CssVerticalGroupedBarChartProps) {
  // Auto-rotate when >8 categories and not explicitly set
  const shouldRotate = rotateLabels ?? data.length > 8
  const xAxisHeight = shouldRotate ? 60 : 34
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height, { xAxisHeight })
  const columnSizing = calculateColumnSizing(data.length)

  const {
    hoveredIndex,
    lastIndex,
    chartRef,
    tooltipRef,
    tooltip,
    handleColumnEnter,
    handleColumnMove,
    handleColumnLeave,
  } = useVerticalColumnTooltip<Record<string, unknown>>()

  const isClickable = !!onBarClick

  const handleBarClick = useCallback(
    (item: Record<string, unknown>, seriesKey: string) => {
      if (onBarClick) onBarClick(item, seriesKey)
    },
    [onBarClick]
  )

  // Compute axis max and ticks across all series
  const dataMax =
    data.length > 0
      ? Math.max(...data.flatMap((d) => series.map((s) => (d[s.key] as number) ?? 0)))
      : 0
  const axisMax = yAxisMax ?? (dataMax > 0 ? dataMax : 1)
  const ticks = getNiceTicks(axisMax)

  // Y-axis margin-left string for x-axis alignment
  const yAxisMarginLeft = '2.5rem'

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
        {/* Chart area with Y-axis */}
        <div className="flex">
          <VerticalYAxis
            ticks={ticks}
            axisMax={axisMax}
            drawingHeight={drawingHeight}
            barsHeight={barsHeight}
            formatTick={yAxisFormat}
          />

          {/* Bars area */}
          <div
            ref={chartRef}
            className={`border-foreground/30 relative flex flex-1 items-end border-l ${columnSizing.mode === 'sparse' ? 'justify-center' : ''}`}
            style={{ height: barsHeight, gap: `${columnSizing.gap}px` }}
          >
            {data.map((item, index) => (
              <div
                key={index}
                className={`relative flex h-full flex-col items-center justify-end ${columnSizing.maxWidth ? '' : 'flex-1'} ${isClickable ? 'cursor-pointer' : ''}`}
                style={{
                  ...(columnSizing.maxWidth ? { maxWidth: `${columnSizing.maxWidth}px`, width: '100%' } : {}),
                  paddingLeft: `${columnSizing.columnPadding}px`,
                  paddingRight: `${columnSizing.columnPadding}px`,
                }}
                onMouseEnter={(e) =>
                  handleColumnEnter(index, e.currentTarget.getBoundingClientRect())
                }
                onMouseMove={(e) => handleColumnMove(e, item as Record<string, unknown>)}
                onMouseLeave={handleColumnLeave}
              >
                {/* Grouped bars side-by-side */}
                <div className="flex w-full flex-row items-end gap-px">
                  {series.map((s) => {
                    const value = (item[s.key] as number) ?? 0
                    const barHeightPx = (value / axisMax) * drawingHeight

                    return (
                      <div
                        key={s.key}
                        className="relative z-10 flex-1 rounded-t transition-all duration-300"
                        style={{
                          height: `${barHeightPx}px`,
                          minHeight: value > 0 ? '4px' : '0px',
                          backgroundColor: s.color,
                        }}
                        onClick={
                          isClickable
                            ? () => handleBarClick(item as Record<string, unknown>, s.key)
                            : undefined
                        }
                      />
                    )
                  })}
                </div>
              </div>
            ))}

            {columnSizing.mode !== 'sparse' && (
              <ColumnHoverOverlay
                itemCount={data.length}
                hoveredIndex={hoveredIndex}
                lastIndex={lastIndex}
              />
            )}
          </div>
        </div>

        {/* X-axis labels */}
        <VerticalXAxis
          labels={data.map((d) => d.name)}
          rotated={shouldRotate}
          marginLeft={yAxisMarginLeft}
        />

        {/* Tooltip */}
        {tooltip.item && (
          <VerticalTooltipShell
            visible={tooltip.visible}
            x={tooltip.x}
            y={tooltip.y}
            tooltipRef={tooltipRef}
          >
            {renderTooltip ? (
              renderTooltip(tooltip.item, series)
            ) : (
              <>
                <p className="text-foreground mb-2 font-medium">
                  {String(tooltip.item['name'] ?? '')}
                </p>
                {series.map((s) => (
                  <p key={s.key} className="text-muted-foreground text-sm">
                    <span style={{ color: s.color }}>{s.label}:</span>{' '}
                    <span className="text-foreground font-semibold">
                      {(tooltip.item?.[s.key] as number) ?? 0}
                    </span>
                  </p>
                ))}
              </>
            )}
          </VerticalTooltipShell>
        )}
      </div>

      <ChartLegend
        items={series.map((s) => ({ label: s.label, color: s.color }))}
        className="mt-1"
      />
    </div>
  )
}
