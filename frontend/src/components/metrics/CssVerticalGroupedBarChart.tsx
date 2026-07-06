/**
 * CssVerticalGroupedBarChart - Generic pure CSS vertical grouped bar chart.
 *
 * Renders N bars side-by-side per X-axis column. Uses shared utilities
 * from cssChartUtils for layout, tooltip, and axis rendering.
 */

import { useMemo, useCallback, type ReactNode } from 'react'
import {
  calculateVerticalLayout,
  calculateColumnSizing,
  useVerticalColumnTooltip,
  getNiceTicks,
  getYAxisMarginLeft,
  X_AXIS_HEIGHT_STRAIGHT,
  X_AXIS_HEIGHT_ROTATED,
  VerticalYAxis,
  VerticalXAxis,
  ColumnHoverOverlay,
  HorizontalGridlines,
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
  renderTooltip?:
    ((item: Record<string, unknown>, series: GroupedBarSeries[]) => ReactNode) | undefined
  onBarClick?: ((item: Record<string, unknown>, seriesKey: string) => void) | undefined
  className?: string
  /** Override default inter-group gap (px) computed by calculateColumnSizing */
  groupGap?: number
  /** Constrain individual bar width as a percentage of the column (e.g. 75 for 75%) */
  barWidthPercent?: number
  /** Override the default maxWidth (px) for sparse-mode columns */
  maxColumnWidth?: number
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
  groupGap,
  barWidthPercent,
  maxColumnWidth,
}: CssVerticalGroupedBarChartProps) {
  // Auto-rotate when >8 categories and not explicitly set
  const shouldRotate = rotateLabels ?? data.length > 8
  const xAxisHeight = shouldRotate ? X_AXIS_HEIGHT_ROTATED : X_AXIS_HEIGHT_STRAIGHT
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height, { xAxisHeight })
  const baseColumnSizing = calculateColumnSizing(data.length)
  const columnSizing = maxColumnWidth
    ? { ...baseColumnSizing, mode: 'sparse' as const, maxWidth: maxColumnWidth }
    : baseColumnSizing
  const effectiveGap = groupGap ?? columnSizing.gap

  // Scale barWidthPercent by series count so visual density stays consistent
  const effectiveBarWidthPercent = barWidthPercent
    ? Math.min(95, barWidthPercent * Math.max(1, series.length / 4))
    : undefined

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

  // Compute axis max and ticks across all series (memoized to avoid recalculation on hover)
  const { axisMax, ticks } = useMemo(() => {
    const dataMax =
      data.length > 0
        ? Math.max(
            ...data.flatMap((d) =>
              series.map((s) => {
                const v = d[s.key]
                return typeof v === 'number' ? v : 0
              })
            )
          )
        : 0
    let max = yAxisMax ?? (dataMax > 0 ? dataMax : 1)
    const t = getNiceTicks(max)
    max = t.at(-1) ?? max
    return { axisMax: max, ticks: t }
  }, [data, series, yAxisMax])

  const yAxisMarginLeft = getYAxisMarginLeft()

  const legendItems = useMemo(
    () => series.map((s) => ({ label: s.label, color: s.color })),
    [series]
  )

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
      {title && <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>}

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
            className="border-foreground/40 relative flex flex-1 items-end border-l"
            style={{ height: barsHeight }}
          >
            <HorizontalGridlines ticks={ticks} axisMax={axisMax} drawingHeight={drawingHeight} />

            {data.map((item, index) => {
              // Absorb inter-column gap into padding so hover areas are contiguous (no dead zones)
              const halfGap = effectiveGap / 2
              const padLeft = columnSizing.columnPadding + halfGap
              const padRight = columnSizing.columnPadding + halfGap

              return (
                // Outer wrapper: always flex-1 for contiguous hover areas
                <div
                  key={index}
                  className={`flex flex-1 items-center justify-center ${isClickable ? 'cursor-pointer' : ''}`}
                  style={{ height: `${drawingHeight}px` }}
                  onMouseEnter={(e) =>
                    handleColumnEnter(index, e.currentTarget.getBoundingClientRect())
                  }
                  onMouseMove={(e) => handleColumnMove(e, item as Record<string, unknown>)}
                  onMouseLeave={handleColumnLeave}
                >
                  {/* Inner visual: constrained width, hover highlight */}
                  <div
                    className={`flex h-full flex-col items-center justify-end ${columnSizing.mode === 'sparse' ? `rounded transition-colors duration-150 ${hoveredIndex === index ? 'bg-foreground/[0.06]' : ''}` : ''}`}
                    style={{
                      width: '100%',
                      ...(columnSizing.maxWidth ? { maxWidth: `${columnSizing.maxWidth}px` } : {}),
                      paddingLeft: `${padLeft}px`,
                      paddingRight: `${padRight}px`,
                    }}
                  >
                    {/* Grouped bars side-by-side */}
                    <div className="flex w-full flex-row items-end justify-center gap-1">
                      {series.map((s) => {
                        const raw = item[s.key]
                        const value = typeof raw === 'number' ? raw : 0
                        // Intentionally skip zero-value bars so remaining bars center
                        // naturally, rather than reserving a placeholder gap.
                        if (value === 0) return null
                        const barHeightPx = (value / axisMax) * drawingHeight

                        return (
                          <div
                            key={s.key}
                            className="relative z-[1] transition-all duration-300"
                            style={{
                              width: `${100 / series.length}%`,
                              height: `${barHeightPx}px`,
                              minHeight: '4px',
                              backgroundColor: s.color,
                              borderRadius: '3px 3px 0 0',
                              ...(effectiveBarWidthPercent
                                ? { maxWidth: `${effectiveBarWidthPercent}%` }
                                : {}),
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
                </div>
              )
            })}

            {columnSizing.mode !== 'sparse' && (
              <ColumnHoverOverlay
                itemCount={data.length}
                hoveredIndex={hoveredIndex}
                lastIndex={lastIndex}
                height={drawingHeight}
              />
            )}
          </div>
        </div>

        {/* X-axis labels */}
        <VerticalXAxis
          labels={data.map((d) => d.name)}
          rotated={shouldRotate}
          marginLeft={yAxisMarginLeft}
          columnSizing={{ ...columnSizing, gap: 0, maxWidth: null, mode: 'normal' as const }}
          alignBorderLeft
        />

        {/* Tooltip */}
        {(() => {
          const ttItem = tooltip.item
          if (!ttItem) return null
          return (
            <VerticalTooltipShell
              visible={tooltip.visible}
              x={tooltip.x}
              y={tooltip.y}
              tooltipRef={tooltipRef}
            >
              {renderTooltip ? (
                renderTooltip(ttItem, series)
              ) : (
                <>
                  <p className="text-foreground mb-2 font-medium">{String(ttItem['name'] ?? '')}</p>
                  {series
                    .filter((s) => {
                      const v = ttItem[s.key]
                      return (typeof v === 'number' ? v : 0) > 0
                    })
                    .map((s) => {
                      const v = ttItem[s.key]
                      return (
                        <p key={s.key} className="text-muted-foreground text-sm">
                          <span style={{ color: s.color }}>{s.label}:</span>{' '}
                          <span className="text-foreground font-semibold">
                            {typeof v === 'number' ? v : 0}
                          </span>
                        </p>
                      )
                    })}
                </>
              )}
            </VerticalTooltipShell>
          )
        })()}
      </div>

      <ChartLegend items={legendItems} className="mt-1" />
    </div>
  )
}
