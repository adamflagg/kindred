/**
 * CssVerticalStackedBarChart - Generic pure CSS vertical stacked bar chart.
 *
 * Configurable via `segments` prop for stacked layers. Supports normal mode
 * (auto-scaled Y-axis) and percent mode (100% stacked, Y-axis 0-100%).
 * Uses shared utilities from cssChartUtils for layout, tooltip, and axes.
 */

import { useMemo, type ReactNode } from 'react'
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
  renderTooltip?:
    ((item: Record<string, unknown>, segments: VerticalStackedSegment[]) => ReactNode) | undefined
  rotateLabels?: boolean
  onBarClick?: ((item: Record<string, unknown>) => void) | undefined
  className?: string
  /** Override max column width (px). Useful when normal mode columns are too wide. */
  maxColumnWidth?: number
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
  maxColumnWidth,
}: CssVerticalStackedBarChartProps) {
  const xAxisHeight = rotateLabels ? X_AXIS_HEIGHT_ROTATED : X_AXIS_HEIGHT_STRAIGHT
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height, { xAxisHeight })
  const baseColumnSizing = calculateColumnSizing(data.length)
  // Don't apply maxColumnWidth in sparse mode — sparse columns (<=4) are
  // intentionally wide (e.g. gender composition bars).
  const columnSizing =
    maxColumnWidth && baseColumnSizing.mode !== 'sparse'
      ? {
          mode: 'sparse' as const,
          maxWidth: maxColumnWidth,
          gap: 16,
          columnPadding: baseColumnSizing.columnPadding,
        }
      : baseColumnSizing
  const halfGap = columnSizing.gap / 2

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

  // Axis calculations (memoized to avoid recalculation on hover)
  const { ticks, axisMax, formatTick } = useMemo(() => {
    if (percentMode) {
      return {
        ticks: [0, 25, 50, 75, 100],
        axisMax: 100,
        formatTick: (t: number) => `${t}%`,
      }
    }
    const maxTotal = data.length > 0 ? Math.max(...data.map((d) => d.total), 1) : 1
    const t = getNiceTicks(maxTotal)
    return {
      ticks: t,
      axisMax: t.at(-1) ?? maxTotal,
      formatTick: undefined as ((tick: number) => string) | undefined,
    }
  }, [data, percentMode])

  // Determine whether to show total labels
  const shouldShowLabel = showTotalLabel ?? (percentMode ? false : true)

  const yAxisMarginLeft = getYAxisMarginLeft()

  const legendItems = useMemo(
    () =>
      segments
        .filter((s) =>
          data.some((item) => {
            const v = item[s.key]
            return (typeof v === 'number' ? v : 0) > 0
          })
        )
        .map((s) => ({ label: s.label, color: s.color })),
    [segments, data]
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
            style={{ height: barsHeight }}
          >
            <HorizontalGridlines ticks={ticks} axisMax={axisMax} drawingHeight={drawingHeight} />

            {data.map((item, index) => {
              const barHeightPx = percentMode
                ? drawingHeight
                : (item.total / axisMax) * drawingHeight
              const label = labelFormat ? labelFormat(item) : String(item.total)

              const sparseHoverClass =
                columnSizing.mode === 'sparse'
                  ? `rounded transition-colors duration-150 ${hoveredIndex === index ? 'bg-foreground/[0.06]' : ''}`
                  : ''
              const columnClass = [
                'relative flex h-full flex-col items-center justify-end',
                columnSizing.maxWidth ? '' : 'flex-1',
                isClickable && 'cursor-pointer',
                sparseHoverClass,
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div
                  key={index}
                  className={columnClass}
                  style={{
                    ...(columnSizing.maxWidth
                      ? { maxWidth: `${columnSizing.maxWidth}px`, width: '100%' }
                      : {}),
                    paddingLeft: `${columnSizing.columnPadding + halfGap}px`,
                    paddingRight: `${columnSizing.columnPadding + halfGap}px`,
                  }}
                  onMouseEnter={(e) =>
                    handleColumnEnter(index, e.currentTarget.getBoundingClientRect())
                  }
                  onMouseMove={(e) => handleColumnMove(e, item)}
                  onMouseLeave={handleColumnLeave}
                  onClick={() => onBarClick?.(item)}
                >
                  {/* Label above bar */}
                  {shouldShowLabel && (
                    <span className="text-muted-foreground relative z-[1] mb-1 text-sm tabular-nums">
                      {label}
                    </span>
                  )}

                  {/* Stacked bar */}
                  <div
                    className="relative z-[1] flex w-full flex-col overflow-hidden rounded-t transition-all duration-300"
                    style={{
                      height: `${barHeightPx}px`,
                      minHeight: item.total > 0 ? '4px' : '0px',
                    }}
                  >
                    {segments.map((seg) => {
                      const raw = item[seg.key]
                      const value = typeof raw === 'number' ? raw : 0
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
                height={drawingHeight}
              />
            )}
          </div>
        </div>

        {/* X-axis labels */}
        <VerticalXAxis
          labels={data.map((d) => d.name)}
          rotated={rotateLabels}
          marginLeft={yAxisMarginLeft}
          columnSizing={{ ...columnSizing, gap: 0 }}
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
                  <p className="text-foreground mb-2 font-medium">
                    {typeof ttItem['tooltipLabel'] === 'string'
                      ? ttItem['tooltipLabel']
                      : String(ttItem.name)}
                  </p>
                  {segments
                    .filter((s) => {
                      const v = ttItem[s.key]
                      return (typeof v === 'number' ? v : 0) > 0
                    })
                    .map((s) => {
                      const raw = ttItem[s.key]
                      const val = typeof raw === 'number' ? raw : 0
                      const pct = ttItem.total > 0 ? ((val / ttItem.total) * 100).toFixed(0) : '0'
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
                    Total: <span className="text-foreground font-semibold">{ttItem.total}</span>
                  </p>
                </>
              )}
            </VerticalTooltipShell>
          )
        })()}
      </div>

      <ChartLegend items={legendItems} className={rotateLabels ? 'mt-3' : 'mt-1'} />
    </div>
  )
}
