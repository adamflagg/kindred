/**
 * RetentionRateLine - Line chart showing retention rate trend over multiple years.
 *
 * Displays overall retention rate trajectory across year transitions.
 * Uses ChartCard for standardized HTML-rendered axes with Recharts SVG content.
 */

import type { ReactNode } from 'react'
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
import type { RetentionTrendYear } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { formatCount, formatPercent } from '../../utils/numberFormat'
import { calculateVerticalLayout } from './cssChartUtils'
import { retentionLineData, type ChartDataItem } from './retentionLineData'
import { DefinitionNotes, DefRef } from '../camperships/kit/DefinitionNotes'
import { PRIORITY_DAY_NOTE } from '../../utils/priorityDay'

interface RetentionRateLineProps {
  data: RetentionTrendYear[]
  title?: string
  headerRight?: ReactNode
  height?: number
  className?: string
  /**
   * While the newest season is live (#3207 PR 11, ruling #89): a dashed line holds each year at
   * the same day of its own registration, with its numbered note. Absent once registration is over.
   */
  samePoint?: { asOf: string; noteN: number; throughNextDay: boolean } | undefined
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const FINAL_STROKE = 'hsl(160, 100%, 35%)'
const SAME_POINT_STROKE = 'hsl(var(--muted-foreground))'

/**
 * A point's rate label, set above its dot when its line is the higher of the two at that year and
 * below when it is the lower, so the finals' and the same-day line's labels never sit on each other.
 */
function PointLabel(props: {
  x?: number | string | undefined
  y?: number | string | undefined
  index?: number | undefined
  rows: ChartDataItem[]
  series: 'final' | 'samePoint'
}) {
  const { index, rows, series } = props
  const x = Number(props.x)
  const y = Number(props.y)
  const row = index === undefined ? undefined : rows[index]
  const value = row ? (series === 'final' ? row.retentionRate : row.samePoint) : null
  if (!row || value === null || Number.isNaN(x) || Number.isNaN(y)) return null
  const other = series === 'final' ? row.samePoint : row.retentionRate
  const above = other === null || value >= other
  return (
    <text
      x={x}
      y={above ? y - 10 : y + 18}
      textAnchor="middle"
      className="text-xs"
      fill="hsl(var(--muted-foreground))"
    >
      {formatPercent(value)}
    </text>
  )
}

export function RetentionRateLine({
  data,
  title = 'Retention Rate Trend',
  headerRight,
  height = 250,
  className = '',
  samePoint,
}: RetentionRateLineProps) {
  const chartData = retentionLineData(data, samePoint !== undefined)
  const day = samePoint ? MONTH_DAY.format(new Date(`${samePoint.asOf}T00:00:00Z`)) : ''

  const { barsHeight, drawingHeight } = calculateVerticalLayout(height)
  const ticks = [0, 20, 40, 60, 80, 100]
  const axisMax = 100

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: ChartDataItem }>
  }) => {
    if (active && payload?.length && payload[0]) {
      const item = payload[0].payload
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground mb-1 font-medium">{item.transition}</p>
          {item.retentionRate !== null && (
            <p className="text-muted-foreground text-sm">
              {samePoint ? 'Final: ' : 'Retention Rate: '}
              <span className="text-primary font-semibold">
                {formatPercent(item.retentionRate)}
              </span>
            </p>
          )}
          {item.samePoint !== null && (
            <p className="text-muted-foreground text-sm">
              At {day} of its registration:{' '}
              <span className="text-foreground font-semibold">{formatPercent(item.samePoint)}</span>
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            Returned: {formatCount(item.returnedCount)} of {formatCount(item.baseCount)}
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <ChartCard
      isEmpty={data.length === 0}
      title={title}
      headerRight={headerRight}
      className={className}
      yAxis={{ ticks, axisMax, drawingHeight, barsHeight, formatTick: (v) => `${v}%` }}
      xLabels={chartData.map((d) => d.name)}
      xAxisEdgeAligned
      xAxisRightPadding={20}
      footer={
        samePoint ? (
          <>
            <div className="text-muted-foreground mt-2 flex flex-wrap justify-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4" style={{ background: FINAL_STROKE }} />
                <span>Final, end of each season</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="border-muted-foreground inline-block w-4 border-t-2 border-dashed" />
                <span>
                  dashed: each year at {day} of its own registration
                  <DefRef n={samePoint.noteN} />
                </span>
              </span>
            </div>
            <DefinitionNotes
              notes={[
                {
                  n: samePoint.noteN,
                  text: `Each year as it stood at ${day} of its own registration: registered by then and not cancelled by then. ${String(Math.max(...data.map((y) => y.to_year)))} is today's count.${samePoint.throughNextDay ? ` ${PRIORITY_DAY_NOTE}` : ''}`,
                },
              ]}
            />
          </>
        ) : undefined
      }
    >
      <ResponsiveContainer width="100%" height={barsHeight}>
        <LineChart
          data={chartData}
          margin={{ top: 16, right: 20, left: 0, bottom: 0 }}
          style={{ overflow: 'visible' }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis hide height={0} dataKey="name" />
          <YAxis hide width={0} domain={[0, 100]} ticks={ticks} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="retentionRate"
            stroke={FINAL_STROKE}
            strokeWidth={3}
            dot={{ fill: FINAL_STROKE, r: 6 }}
            activeDot={{ r: 8 }}
          >
            {samePoint ? (
              <LabelList
                dataKey="retentionRate"
                content={(props) => <PointLabel {...props} rows={chartData} series="final" />}
              />
            ) : (
              <LabelList
                dataKey="retentionRate"
                position="top"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
                formatter={(value) => (value == null ? '' : formatPercent(Number(value)))}
              />
            )}
          </Line>
          {samePoint && (
            <Line
              type="monotone"
              dataKey="samePoint"
              stroke={SAME_POINT_STROKE}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ fill: 'hsl(var(--card))', stroke: SAME_POINT_STROKE, strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="samePoint"
                content={(props) => <PointLabel {...props} rows={chartData} series="samePoint" />}
              />
            </Line>
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
