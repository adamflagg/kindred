/**
 * CssVerticalBarChart - Generic pure CSS vertical column chart.
 *
 * Single bar per column with configurable colors, labels, tooltips, and Y-axis.
 * Uses shared utilities from cssChartUtils for layout, tooltip, and axis rendering.
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
  HorizontalGridlines,
  VerticalTooltipShell,
} from './cssChartUtils'

export interface CssVerticalBarItem {
  name: string
  value: number
  id?: string | number
  [key: string]: unknown // extra fields for tooltip access
}

interface CssVerticalBarChartProps {
  data: CssVerticalBarItem[]
  title?: string
  height?: number
  yAxisWidth?: string
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
}: CssVerticalBarChartProps) {
  const xAxisHeight = rotateLabels ? 80 : 34
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

  const handleClick = useCallback(
    (item: CssVerticalBarItem) => {
      if (onBarClick) onBarClick(item)
    },
    [onBarClick]
  )

  // Compute axis max and ticks
  const dataMax = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 0
  let axisMax = yAxisMax ?? (dataMax > 0 ? dataMax : 1)
  const ticks = yAxisTicks ?? getNiceTicks(axisMax)
  axisMax = ticks[ticks.length - 1] ?? axisMax

  // Y-axis margin-left string for x-axis alignment
  const yAxisMarginLeft = yAxisWidth === 'w-10' ? '3rem' : '2.5rem'

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
              const label = labelFormat ? labelFormat(item) : String(item.value)

              return (
                <div
                  key={index}
                  className={`relative flex h-full flex-col items-center justify-end ${columnSizing.maxWidth ? '' : 'flex-1'} ${isClickable ? 'cursor-pointer' : ''} ${columnSizing.mode === 'sparse' ? `rounded transition-colors duration-150 ${hoveredIndex === index ? 'bg-foreground/[0.06]' : ''}` : ''}`}
                  style={{
                    ...(columnSizing.maxWidth ? { maxWidth: `${columnSizing.maxWidth}px`, width: '100%' } : {}),
                    paddingLeft: `${columnSizing.columnPadding + halfGap}px`,
                    paddingRight: `${columnSizing.columnPadding + halfGap}px`,
                  }}
                  onMouseEnter={(e) => handleColumnEnter(index, e.currentTarget.getBoundingClientRect())}
                  onMouseMove={(e) => handleColumnMove(e, item)}
                  onMouseLeave={handleColumnLeave}
                  onClick={() => isClickable && handleClick(item)}
                >
                  {/* Label above bar */}
                  <span className="text-muted-foreground relative z-[1] mb-1 text-xs tabular-nums">
                    {label}
                  </span>

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
    </div>
  )
}
