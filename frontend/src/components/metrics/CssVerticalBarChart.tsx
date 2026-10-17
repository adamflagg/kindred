/**
 * CssVerticalBarChart - Generic pure CSS vertical column chart.
 *
 * Single bar per column with configurable colors, labels, tooltips, and Y-axis.
 * Uses shared utilities from cssChartUtils for layout, tooltip, and axis rendering.
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
import type { YAxisWidth } from './cssChartUtils'
import { formatCount } from '../../utils/numberFormat'

export interface CssVerticalBarItem {
  name: string
  value: number
  /** Shorter text for the x-axis only; `name` stays the item's name everywhere else (P-20). */
  axisLabel?: string
  id?: string | number
  [key: string]: unknown // extra fields for tooltip access
}

interface CssVerticalBarChartProps {
  data: CssVerticalBarItem[]
  title?: string
  height?: number
  yAxisWidth?: YAxisWidth
  yAxisFormat?: ((tick: number) => string) | undefined
  yAxisMax?: number
  yAxisTicks?: number[]
  labelFormat?: ((item: CssVerticalBarItem) => string) | undefined
  colorFn?: ((item: CssVerticalBarItem) => string) | undefined
  rotateLabels?: boolean
  renderTooltip?: ((item: CssVerticalBarItem) => ReactNode) | undefined
  onBarClick?: ((item: CssVerticalBarItem) => void) | undefined
  /** Bar width as percentage of column (1-100). Default: 100 (full width). */
  barWidthPercent?: number | undefined
  className?: string
  /** A line inside the card, below the bars (the age chart's camper count). */
  footer?: ReactNode
  /** Beside the title, right-aligned (Retention's "Change vs same point last year¹"). */
  headerRight?: ReactNode
  /** A second, smaller line under each bar's label (Retention's change, #3207 PR 11). */
  renderSubLabel?: ((item: CssVerticalBarItem) => ReactNode) | undefined
  /** A value on the bar's axis to mark with a thin line across the bar (last year's rate), or null. */
  markerValue?: ((item: CssVerticalBarItem) => number | null) | undefined
}

const DEFAULT_COLOR = 'hsl(200, 70%, 50%)'

export function CssVerticalBarChart({
  data,
  title,
  height = 300,
  yAxisWidth = 'w-8',
  yAxisFormat,
  yAxisMax,
  yAxisTicks,
  labelFormat,
  colorFn,
  rotateLabels = false,
  renderTooltip,
  onBarClick,
  barWidthPercent,
  className = '',
  footer,
  headerRight,
  renderSubLabel,
  markerValue,
}: CssVerticalBarChartProps) {
  const xAxisHeight = rotateLabels ? X_AXIS_HEIGHT_ROTATED : X_AXIS_HEIGHT_STRAIGHT
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height, { xAxisHeight })
  const columnSizing = calculateColumnSizing(data.length)
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
  } = useVerticalColumnTooltip<CssVerticalBarItem>()

  const isClickable = !!onBarClick

  // Compute axis max and ticks (memoized to avoid recalculation on hover)
  const { axisMax, ticks } = useMemo(() => {
    const dataMax = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 0
    let max = yAxisMax ?? (dataMax > 0 ? dataMax : 1)
    const t = yAxisTicks ?? getNiceTicks(max)
    max = t.at(-1) ?? max
    return { axisMax: max, ticks: t }
  }, [data, yAxisMax, yAxisTicks])

  const yAxisMarginLeft = getYAxisMarginLeft(yAxisWidth)

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
      {title &&
        (headerRight ? (
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="text-foreground text-base font-semibold">{title}</h3>
            <span className="ml-auto">{headerRight}</span>
          </div>
        ) : (
          <h3 className="text-foreground mb-2 text-base font-semibold">{title}</h3>
        ))}

      <div className="relative flex-1">
        {/* Chart area with Y-axis */}
        <div className="flex">
          <VerticalYAxis
            ticks={ticks}
            axisMax={axisMax}
            drawingHeight={drawingHeight}
            barsHeight={barsHeight}
            width={yAxisWidth}
            formatTick={yAxisFormat}
          />

          {/* Bars area */}
          <div
            ref={chartRef}
            className={`border-foreground/40 relative flex flex-1 items-end border-l ${columnSizing.mode === 'sparse' ? 'justify-center' : ''}`}
            style={{ height: barsHeight }}
          >
            <HorizontalGridlines ticks={ticks} axisMax={axisMax} drawingHeight={drawingHeight} />

            {data.map((item, index) => {
              const barHeightPx = (item.value / axisMax) * drawingHeight
              const label = labelFormat ? labelFormat(item) : formatCount(item.value)
              const marker = markerValue ? markerValue(item) : null
              const markerPx = marker === null ? null : (marker / axisMax) * drawingHeight

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

              const columnStyle: React.CSSProperties = {
                ...(columnSizing.maxWidth
                  ? { maxWidth: `${columnSizing.maxWidth}px`, width: '100%' }
                  : {}),
                paddingLeft: `${columnSizing.columnPadding + halfGap}px`,
                paddingRight: `${columnSizing.columnPadding + halfGap}px`,
              }
              const columnContent = (
                <>
                  {/* Label above bar */}
                  <span className="text-muted-foreground relative z-[1] mb-1 text-xs tabular-nums">
                    {label}
                    {renderSubLabel && (
                      <span className="block text-center text-[10.5px] leading-3 whitespace-nowrap">
                        {renderSubLabel(item)}
                      </span>
                    )}
                  </span>

                  {/* Last year's mark: a thin line across the bar's column at its value */}
                  {markerPx !== null && (
                    <div
                      data-prior-tick
                      className="bg-foreground pointer-events-none absolute z-[2] h-0.5"
                      style={{
                        bottom: `${markerPx}px`,
                        left: `${columnSizing.columnPadding + halfGap}px`,
                        right: `${columnSizing.columnPadding + halfGap}px`,
                      }}
                    />
                  )}

                  {/* Bar */}
                  <div
                    className={`relative z-[1] rounded-t transition-all duration-300 ${barWidthPercent ? '' : 'w-full'}`}
                    style={{
                      height: `${barHeightPx}px`,
                      minHeight: item.value > 0 ? '4px' : '0px',
                      backgroundColor: colorFn ? colorFn(item) : DEFAULT_COLOR,
                      ...(barWidthPercent ? { width: `${barWidthPercent}%` } : {}),
                    }}
                  />
                </>
              )

              // A clickable column becomes a real <button> so it's
              // keyboard-operable and gets a discoverable accessible name —
              // bolting role="button"/tabIndex/onKeyDown onto a <div> is
              // exactly what this house style avoids (kindred#2094).
              // Non-clickable columns stay plain <div>s.
              return isClickable ? (
                <button
                  key={index}
                  type="button"
                  className={`${columnClass} text-left`}
                  style={columnStyle}
                  onMouseEnter={(e) =>
                    handleColumnEnter(index, e.currentTarget.getBoundingClientRect())
                  }
                  onMouseMove={(e) => handleColumnMove(e, item)}
                  onMouseLeave={handleColumnLeave}
                  onClick={() => onBarClick(item)}
                >
                  {columnContent}
                </button>
              ) : (
                <div
                  key={index}
                  className={columnClass}
                  style={columnStyle}
                  onMouseEnter={(e) =>
                    handleColumnEnter(index, e.currentTarget.getBoundingClientRect())
                  }
                  onMouseMove={(e) => handleColumnMove(e, item)}
                  onMouseLeave={handleColumnLeave}
                >
                  {columnContent}
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
          labels={data.map((d) => d.axisLabel ?? d.name)}
          rotated={rotateLabels}
          marginLeft={yAxisMarginLeft}
          columnSizing={{ ...columnSizing, gap: 0 }}
        />

        {/* Tooltip */}
        {renderTooltip && tooltip.item && (
          <VerticalTooltipShell
            visible={tooltip.visible}
            x={tooltip.x}
            y={tooltip.y}
            tooltipRef={tooltipRef}
          >
            {renderTooltip(tooltip.item)}
          </VerticalTooltipShell>
        )}
      </div>
      {footer}
    </div>
  )
}
