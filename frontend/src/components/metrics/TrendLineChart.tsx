/**
 * TrendLineChart - Multi-year line chart for historical trends visualization.
 * Uses ChartCard for standardized layout (Y-axis, X-axis, legend) while
 * Recharts handles only the SVG content (lines, dots, grid).
 */

import { formatCount, formatPercent } from '../../utils/numberFormat'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import { useMemo, type ReactNode } from 'react'
import type { YearMetrics } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { getNiceTicks, calculateVerticalLayout, computeCoverageBands } from './cssChartUtils'
import { formatLabelListValue, formatLabelListPercent } from '../../utils/chartFormatters'
import {
  GENDER_IDENTITY_GROUPS,
  genderDisplayName,
  genderHatched,
  genderIdentityColor,
} from '../camperships/kit/genderIdentity'
import { groupCounts } from './genderNotes'

const COLORS = {
  total: 'hsl(160, 100%, 35%)', // Primary green
  new: 'hsl(200, 70%, 50%)', // Blue
  returning: 'hsl(42, 92%, 50%)', // Gold
  cancelled: 'hsl(0, 70%, 50%)', // Red
  cancellation_rate: 'hsl(0, 70%, 50%)', // Red
}

interface TrendLineChartProps {
  data: YearMetrics[]
  title: string
  metric: 'total' | 'new_vs_returning' | 'gender' | 'cancellation_rate'
  height?: number
  className?: string
  /** Under the legend: visible note lines (#2898's Gender field count). */
  footer?: ReactNode
}

/** A year's gender identity counts folded into the five groups (#75 a). */
function genderGroups(yearData: YearMetrics): Record<string, number> {
  return groupCounts(Object.fromEntries(yearData.by_gender.map((g) => [g.gender, g.count])))
}

export function TrendLineChart({
  data,
  title,
  metric,
  height = 300,
  className = '',
  footer,
}: TrendLineChartProps) {
  // Transform data based on metric type
  const chartData = useMemo(
    () =>
      data.map((yearData) => {
        const base = { year: yearData.year }

        if (metric === 'total') {
          return { ...base, total: yearData.total_enrolled }
        }

        if (metric === 'new_vs_returning') {
          return {
            ...base,
            new: yearData.new_vs_returning.new_count,
            returning: yearData.new_vs_returning.returning_count,
          }
        }

        if (metric === 'gender') {
          return { ...base, ...genderGroups(yearData) }
        }

        return {
          ...base,
          cancelled: yearData.total_cancelled ?? 0,
          // null = nobody enrolled that year: no rate, so no point on the line (a gap, not 0 or 100)
          cancellation_rate:
            yearData.cancellation_rate === null ? null : (yearData.cancellation_rate ?? 0),
        }
      }),
    [data, metric]
  )

  // #2443 -- greyed band(s) behind years whose cancellation count was not
  // measured (the cancelled-attendee fetch failed), scoped to the
  // cancellation-rate metric (the only one with a coverage concept --
  // enrollment/gender/new-vs-returning are always measured).
  const coverageBands = useMemo(
    () =>
      metric === 'cancellation_rate'
        ? computeCoverageBands(data.map((d) => d.has_cancellation_data !== false))
        : [],
    [data, metric]
  )

  // Compute ticks and layout for ChartCard
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height)

  const { ticks, axisMax } = useMemo(() => {
    // The % axis is sized by the plotted rate only: the row also carries the cancelled COUNT.
    const allValues = chartData.flatMap((d) =>
      Object.entries(d)
        .filter(
          ([k]) => k !== 'year' && (metric !== 'cancellation_rate' || k === 'cancellation_rate')
        )
        .map(([, v]) => Number(v) || 0)
    )
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1
    const t =
      metric === 'cancellation_rate'
        ? getNiceTicks(Math.max(Math.ceil(dataMax / 5) * 5, 5))
        : getNiceTicks(dataMax)
    return { ticks: t, axisMax: t.at(-1) ?? dataMax }
  }, [chartData, metric])

  // #2898: one line per gender identity group any year counts, in the fixed order
  const genderLines = useMemo(
    () =>
      metric === 'gender'
        ? GENDER_IDENTITY_GROUPS.filter((group) =>
            chartData.some((d) => Number((d as Record<string, number>)[group] ?? 0) > 0)
          )
        : [],
    [chartData, metric]
  )

  // Compute legend items based on metric
  const legendItems = useMemo(
    () =>
      metric === 'total'
        ? [{ label: 'Total Enrolled', color: COLORS.total }]
        : metric === 'new_vs_returning'
          ? [
              { label: 'New Campers', color: COLORS.new },
              { label: 'Returning Campers', color: COLORS.returning },
            ]
          : metric === 'gender'
            ? genderLines.map((group) => ({
                label: genderDisplayName(group),
                color: genderIdentityColor(group),
                ...(genderHatched(group) ? { hatch: true } : {}),
              }))
            : [{ label: 'Cancellation Rate', color: COLORS.cancellation_rate }],
    [metric, genderLines]
  )

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: Array<{ name: string; value: number; color: string }>
    label?: string
  }) => {
    if (active && payload?.length) {
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground mb-2 font-medium">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}:{' '}
              <span className="font-semibold">
                {metric === 'cancellation_rate'
                  ? formatPercent(entry.value)
                  : formatCount(entry.value)}
              </span>
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <ChartCard
      title={title}
      className={className}
      isEmpty={data.length === 0}
      yAxis={{
        ticks,
        axisMax,
        drawingHeight,
        barsHeight,
        ...(metric === 'cancellation_rate' && { formatTick: (v: number) => `${v}%` }),
      }}
      xLabels={chartData.map((d) => String(d.year))}
      xAxisEdgeAligned
      xAxisRightPadding={20}
      {...(legendItems.length > 1 && { legend: legendItems })}
      footer={footer}
    >
      {coverageBands.length > 0 && (
        // Reduced-width box mirrors the recharts LineChart margin (right: 20,
        // matching xAxisRightPadding above) and VerticalXAxis's own inner div
        // (cssChartUtils.ts, edgeAligned branch), so percentages inside it
        // land on the same pixels as the year labels below the chart.
        <div className="pointer-events-none absolute inset-0" style={{ right: '20px' }}>
          {coverageBands.map((band, i) => (
            <div
              key={i}
              data-testid="coverage-band"
              className="bg-muted-foreground/10 absolute inset-y-0"
              style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%` }}
            />
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={barsHeight}>
        <LineChart
          data={chartData}
          margin={{ top: 16, right: 20, left: 0, bottom: 0 }}
          style={{ overflow: 'visible' }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis hide height={0} dataKey="year" />
          <YAxis hide width={0} domain={[0, axisMax]} ticks={ticks} />
          <Tooltip content={<CustomTooltip />} />

          {metric === 'total' && (
            <Line
              type="monotone"
              dataKey="total"
              name="Total Enrolled"
              stroke={COLORS.total}
              strokeWidth={2}
              strokeLinecap="round"
              dot={{ fill: COLORS.total, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            >
              <LabelList
                dataKey="total"
                position="top"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
                formatter={formatLabelListValue}
              />
            </Line>
          )}

          {metric === 'new_vs_returning' && (
            <>
              <Line
                type="monotone"
                dataKey="new"
                name="New Campers"
                stroke={COLORS.new}
                strokeWidth={2}
                strokeLinecap="round"
                dot={{ fill: COLORS.new, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="new"
                  position="top"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={formatLabelListValue}
                />
              </Line>
              <Line
                type="monotone"
                dataKey="returning"
                name="Returning Campers"
                stroke={COLORS.returning}
                strokeWidth={2}
                strokeLinecap="round"
                dot={{ fill: COLORS.returning, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="returning"
                  position="bottom"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={formatLabelListValue}
                />
              </Line>
            </>
          )}

          {genderLines.map((group, i) => {
            const color = genderIdentityColor(group)
            return (
              <Line
                key={group}
                type="monotone"
                dataKey={group}
                name={genderDisplayName(group)}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                {...(genderHatched(group) ? { strokeDasharray: '5 3' } : {})}
                dot={{ fill: color, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                {/* The first two groups drawn, in the fixed order, carry their values, as Male and Female did. */}
                {i < 2 && (
                  <LabelList
                    dataKey={group}
                    position={i === 0 ? 'top' : 'bottom'}
                    className="text-xs"
                    fill="hsl(var(--muted-foreground))"
                    formatter={formatLabelListValue}
                  />
                )}
              </Line>
            )
          })}

          {metric === 'cancellation_rate' && (
            <Line
              type="monotone"
              dataKey="cancellation_rate"
              name="Cancellation Rate"
              stroke={COLORS.cancellation_rate}
              strokeWidth={2}
              strokeLinecap="round"
              dot={{ fill: COLORS.cancellation_rate, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
            >
              <LabelList
                dataKey="cancellation_rate"
                position="top"
                className="text-xs"
                fill="hsl(var(--muted-foreground))"
                formatter={formatLabelListPercent}
              />
            </Line>
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
