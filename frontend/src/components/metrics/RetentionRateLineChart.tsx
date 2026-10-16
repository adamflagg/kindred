/**
 * RetentionRateLineChart - Line/dot chart for retention rates across numeric categories.
 *
 * Best for ordered numeric categories (grade, summers at camp, first summer year)
 * where the x-axis progression matters. Data is always sorted by name (natural order).
 * Uses ChartCard for standardized HTML-rendered axes with Recharts SVG content.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from 'recharts'
import { sortRetentionBarData } from '../../utils/retentionTransforms'
import type { RetentionRateBarItem } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { formatCount, formatPercent } from '../../utils/numberFormat'
import { calculateVerticalLayout } from './cssChartUtils'
import {
  changeArrow,
  formatSignedPointsBare,
  isSmallBase,
  pointsBetween,
  type RetentionCompareView,
} from '../../utils/retentionCompare'
import { DELTA_INK, deltaInk } from '../../utils/deltaTokens'
import { PRIORITY_DAY_PENDING } from '../../utils/priorityDay'
import { RetentionCompareHeader, RetentionCompareLegend } from './RetentionChange'
import { describeRowChange } from '../../utils/retentionCompare'

interface RetentionRateLineChartProps {
  data: RetentionRateBarItem[]
  title: string
  height?: number
  tooltipLabelPrefix?: string
  onDotClick?: (item: RetentionRateBarItem) => void
  /**
   * Compare with last year (#3207 PR 11): each item carries `priorRate`; last year draws as a grey
   * dashed line and each point's change sits under its rate.
   */
  compare?: RetentionCompareView | undefined
}

interface ChartItem {
  name: string
  rate: number
  baseCount: number
  returnedCount: number
  id?: string | number | undefined
  /** Last year's rate, in percent; null where last year had no such row. */
  prior: number | null
}

const PRIOR_STROKE = 'hsl(var(--muted-foreground))'

/** The change under a point's rate, as on the bar charts' faces: "▲ +2.2", a small row muted "+6.1 · 18". */
function changeLabel(
  item: ChartItem,
  compare: RetentionCompareView
): { text: string; ink: string } | null {
  const points = pointsBetween(item.rate / 100, item.prior === null ? null : item.prior / 100)
  if (points === null) return null
  if (compare.pending) return { text: PRIORITY_DAY_PENDING, ink: DELTA_INK.neutral }
  if (isSmallBase(item.baseCount)) {
    return {
      text: `${formatSignedPointsBare(points)} · ${formatCount(item.baseCount)}`,
      ink: DELTA_INK.neutral,
    }
  }
  return {
    text: `${changeArrow(points)}${formatSignedPointsBare(points)}`,
    ink: deltaInk(points, 'up-good'),
  }
}

export function RetentionRateLineChart({
  data,
  title,
  height = 250,
  tooltipLabelPrefix,
  onDotClick,
  compare,
}: RetentionRateLineChartProps) {
  // Always sort by name for line charts (x-axis must be ordered)
  const sorted = sortRetentionBarData(data, 'name')

  const chartData: ChartItem[] = sorted.map((d) => ({
    name: d.name,
    rate: d.retentionRate * 100,
    baseCount: d.baseCount,
    returnedCount: d.returnedCount,
    id: d.id,
    prior: d.priorRate == null ? null : d.priorRate * 100,
  }))

  // Compute layout for ChartCard
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height)
  const ticks = [0, 20, 40, 60, 80, 100]
  const axisMax = 100

  // Handle activeDot click: map chart item back to original RetentionRateBarItem
  const handleDotClick = onDotClick
    ? (dotProps: Record<string, unknown>) => {
        const payload = dotProps['payload'] as ChartItem | undefined
        if (!payload) return
        const original = sorted.find((d) => d.name === payload.name)
        if (original) onDotClick(original)
      }
    : undefined

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: ChartItem }>
  }) => {
    if (active && payload?.length && payload[0]) {
      const item = payload[0].payload
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground font-medium">
            {tooltipLabelPrefix ? `${tooltipLabelPrefix}${item.name}` : item.name}
          </p>
          <p className="text-muted-foreground text-sm">
            Retention:{' '}
            <span className="text-primary font-semibold">{formatPercent(item.rate)}</span>
          </p>
          <p className="text-muted-foreground text-sm">
            {formatCount(item.returnedCount)} of {formatCount(item.baseCount)} returned
          </p>
          {compare && (
            <p className="text-muted-foreground text-sm">
              {describeRowChange(
                item.rate / 100,
                item.prior === null ? null : item.prior / 100,
                compare
              )}
            </p>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <ChartCard
      title={title}
      isEmpty={data.length === 0}
      yAxis={{
        ticks,
        axisMax,
        drawingHeight,
        barsHeight,
        formatTick: (v: number) => `${v}%`,
      }}
      xLabels={chartData.map((d) => d.name)}
      xAxisEdgeAligned
      xAxisRightPadding={20}
      {...(compare
        ? {
            headerRight: (
              <span className="ml-auto">
                <RetentionCompareHeader compare={compare} />
              </span>
            ),
            footer: <RetentionCompareLegend compare={compare} kind="line" />,
          }
        : {})}
    >
      <ResponsiveContainer width="100%" height={barsHeight}>
        <LineChart<ChartItem>
          data={chartData}
          margin={{ top: compare ? 30 : 16, right: 20, left: 0, bottom: 0 }}
          style={{ overflow: 'visible' }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis hide height={0} dataKey="name" />
          <YAxis hide width={0} domain={[0, 100]} ticks={ticks} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          {compare && (
            <Line<ChartItem>
              type="monotone"
              dataKey="prior"
              stroke={PRIOR_STROKE}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={{ r: 3, fill: 'hsl(var(--card))', stroke: PRIOR_STROKE, strokeWidth: 1.5 }}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          <Line<ChartItem>
            type="monotone"
            dataKey="rate"
            stroke="hsl(160, 100%, 35%)"
            strokeWidth={2.5}
            strokeLinecap="round"
            dot={{ fill: 'hsl(160, 100%, 35%)', r: 5 }}
            activeDot={
              handleDotClick
                ? { r: 7, onClick: handleDotClick, style: { cursor: 'pointer' } }
                : { r: 7 }
            }
          >
            <LabelList
              dataKey="rate"
              position="top"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
              formatter={(value) => formatPercent(Number(value))}
              {...(compare ? { offset: 18 } : {})}
            />
            {compare && (
              <LabelList
                dataKey="rate"
                content={(props) => {
                  const { x, y, index } = props as { x?: number; y?: number; index?: number }
                  const item = index === undefined ? undefined : chartData[index]
                  const label = item ? changeLabel(item, compare) : null
                  if (!label || x === undefined || y === undefined) return null
                  return (
                    <text
                      x={x}
                      y={y - 8}
                      textAnchor="middle"
                      fontSize={10.5}
                      className={label.ink}
                      fill="currentColor"
                    >
                      {label.text}
                    </text>
                  )
                }}
              />
            )}
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
