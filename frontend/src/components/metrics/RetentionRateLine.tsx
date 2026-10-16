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

interface ChartDataItem {
  name: string
  transition: string
  /** The final rate; null for the live year, which is not drawn on the finals line (#89). */
  retentionRate: number | null
  /** The rate at the same registration day, percent; the live year's is today's. */
  samePoint: number | null
  baseCount: number
  returnedCount: number
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const FINAL_STROKE = 'hsl(160, 100%, 35%)'
const SAME_POINT_STROKE = 'hsl(var(--muted-foreground))'

/**
 * Points labelled by the year campers returned into (a ruled call, #3207 PR 11; it read the base
 * year before). While live, the newest is "so far" and sits on the dashed line only.
 */
export function retentionLineData(data: RetentionTrendYear[], live: boolean): ChartDataItem[] {
  const newest = Math.max(0, ...data.map((y) => y.to_year))
  return data.map((year) => {
    const isLive = live && year.to_year === newest
    return {
      name: isLive ? `${year.to_year} so far` : year.to_year.toString(),
      transition: `${year.from_year} → ${year.to_year}`,
      retentionRate: isLive ? null : year.retention_rate * 100,
      samePoint: live && year.same_point_rate != null ? year.same_point_rate * 100 : null,
      baseCount: year.base_count,
      returnedCount: year.returned_count,
    }
  })
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
            <LabelList
              dataKey="retentionRate"
              position="top"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
              formatter={(value) => (value == null ? '' : formatPercent(Number(value)))}
            />
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
                position="bottom"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
                formatter={(value) => (value == null ? '' : formatPercent(Number(value)))}
              />
            </Line>
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
