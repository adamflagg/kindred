/**
 * CssVerticalStackedBarChart - Generic pure CSS vertical stacked bar chart.
 *
 * Configurable via `segments` prop for stacked layers. Supports normal mode
 * (auto-scaled Y-axis) and percent mode (100% stacked, Y-axis 0-100%).
 * Uses shared utilities from cssChartUtils for layout, tooltip, and axes.
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

export interface VerticalStackedSegment {
  key: string
  label: string
  color: string
}

interface DataItem {
  name: string
  total: number
  [key: string]: string | number | null
}

interface CssVerticalStackedBarChartProps {
  data: DataItem[]
  segments: VerticalStackedSegment[]
  title?: string
  height?: number
  percentMode?: boolean
  showTotalLabel?: boolean
  labelFormat?: ((item: Record<string, unknown>) => string) | undefined
  renderTooltip?: ((item: Record<string, unknown>, segments: VerticalStackedSegment[]) => ReactNode) | undefined
  rotateLabels?: boolean
  onBarClick?: ((item: Record<string, unknown>) => void) | undefined
  className?: string
}

export function CssVerticalStackedBarChart({
  data,
  segments,
  title,
  height = 300,
  percentMode = false,
  showTotalLabel,
  labelFormat,
  renderTooltip,
  rotateLabels = false,
  onBarClick,
  className = '',
}: CssVerticalStackedBarChartProps) {
  const xAxisHeight = rotateLabels ? 60 : 34
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
  } = useVerticalColumnTooltip<DataItem>()

  const isClickable = !!onBarClick

  const handleClick = useCallback(
    (item: DataItem) => {
      if (onBarClick) onBarClick(item)
    },
    [onBarClick]
  )

  // Axis calculations
  const maxTotal = data.length > 0 ? Math.max(...data.map((d) => d.total), 1) : 1

  let ticks: number[]
  let axisMax: number
  let formatTick: ((tick: number) => string) | undefined

  if (percentMode) {
    axisMax = 100
    ticks = [0, 25, 50, 75, 100]
    formatTick = (t: number) => `${t}%`
  } else {
    ticks = getNiceTicks(maxTotal)
    axisMax = ticks[ticks.length - 1] ?? maxTotal
    formatTick = undefined
  }

  // Determine whether to show total labels
  const shouldShowLabel = showTotalLabel ?? (percentMode ? false : true)

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
            formatTick={formatTick}
          />

          {/* Bars area */}
          <div
            ref={chartRef}
            className={`border-foreground/40 relative flex flex-1 items-end border-l ${columnSizing.mode === 'sparse' ? 'justify-center' : ''}`}
            style={{ height: barsHeight, gap: `${columnSizing.gap}px` }}
          >
            {data.map((item, index) => {
              const barHeightPx = percentMode
                ? drawingHeight
                : (item.total / axisMax) * drawingHeight
              const label = labelFormat ? labelFormat(item) : String(item.total)

              return (
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
                  onMouseMove={(e) => handleColumnMove(e, item)}
                  onMouseLeave={handleColumnLeave}
                  onClick={() => isClickable && handleClick(item)}
                >
                  {/* Label above bar */}
                  {shouldShowLabel && (
                    <span className="text-muted-foreground relative z-10 mb-1 text-sm tabular-nums">
                      {label}
                    </span>
                  )}

                  {/* Stacked bar */}
                  <div
                    className="relative z-10 flex w-full flex-col overflow-hidden rounded-t transition-all duration-300"
                    style={{
                      height: `${barHeightPx}px`,
                      minHeight: item.total > 0 ? '4px' : '0px',
                    }}
                  >
                    {segments.map((seg) => {
                      const value = (item[seg.key] as number) ?? 0
                      if (value <= 0) return null
                      return (
                        <div
                          key={seg.key}
                          className="w-full transition-all duration-300"
                          style={{
                            flex: value,
                            backgroundColor: seg.color,
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}

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
          rotated={rotateLabels}
          marginLeft={yAxisMarginLeft}
          columnSizing={columnSizing}
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
                renderTooltip(ttItem, segments)
              ) : (
                <>
                  <p className="text-foreground mb-2 font-medium">{ttItem.name}</p>
                  {segments
                    .filter((s) => ((ttItem[s.key] as number) ?? 0) > 0)
                    .map((s) => {
                      const val = (ttItem[s.key] as number) ?? 0
                      const pct =
                        ttItem.total > 0 ? ((val / ttItem.total) * 100).toFixed(0) : '0'
                      return (
                        <p key={s.key} className="text-muted-foreground text-sm">
                          <span style={{ color: s.color }}>{s.label}:</span>{' '}
                          <span className="text-foreground font-semibold">
                            {val} ({pct}%)
                          </span>
                        </p>
                      )
                    })}
                  <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-sm">
                    Total:{' '}
                    <span className="text-foreground font-semibold">{ttItem.total}</span>
                  </p>
                </>
              )}
            </VerticalTooltipShell>
          )
        })()}
      </div>

      <ChartLegend
        items={segments
          .filter((s) => data.some((item) => ((item[s.key] as number) ?? 0) > 0))
          .map((s) => ({ label: s.label, color: s.color }))}
        className="mt-1"
      />
    </div>
  )
}
