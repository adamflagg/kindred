/**
 * TrendLineChart - Multi-year line chart for historical trends visualization.
 * Uses ChartCard for standardized layout (Y-axis, X-axis, legend) while
 * Recharts handles only the SVG content (lines, dots, grid).
 */

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
import { useMemo } from 'react'
import type { YearMetrics } from '../../types/metrics'
import { ChartCard } from './ChartCard'
import { getNiceTicks, calculateVerticalLayout } from './cssChartUtils'
import { formatLabelListValue, formatLabelListPercent } from '../../utils/chartFormatters'

const COLORS = {
  total: 'hsl(160, 100%, 35%)', // Primary green
  new: 'hsl(200, 70%, 50%)', // Blue
  returning: 'hsl(42, 92%, 50%)', // Gold
  male: 'hsl(200, 70%, 50%)', // Blue
  female: 'hsl(350, 70%, 50%)', // Red/Pink
  cancelled: 'hsl(0, 70%, 50%)', // Red
  cancellation_rate: 'hsl(0, 70%, 50%)', // Red
}

interface TrendLineChartProps {
  data: YearMetrics[]
  title: string
  metric: 'total' | 'new_vs_returning' | 'gender' | 'cancellation_rate'
  height?: number
  className?: string
}

export function TrendLineChart({
  data,
  title,
  metric,
  height = 300,
  className = '',
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
          const maleData = yearData.by_gender.find((g) => g.gender === 'M')
          const femaleData = yearData.by_gender.find((g) => g.gender === 'F')
          return {
            ...base,
            male: maleData?.count ?? 0,
            female: femaleData?.count ?? 0,
          }
        }

        return {
          ...base,
          cancelled: yearData.total_cancelled ?? 0,
          cancellation_rate: yearData.cancellation_rate ?? 0,
        }
      }),
    [data, metric]
  )

  // Compute ticks and layout for ChartCard
  const { barsHeight, drawingHeight } = calculateVerticalLayout(height)

  const { ticks, axisMax } = useMemo(() => {
    const allValues = chartData.flatMap((d) =>
      Object.entries(d)
        .filter(([k]) => k !== 'year')
        .map(([, v]) => Number(v) || 0)
    )
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1
    const t =
      metric === 'cancellation_rate'
        ? getNiceTicks(Math.max(Math.ceil(dataMax / 5) * 5, 5))
        : getNiceTicks(dataMax)
    return { ticks: t, axisMax: t[t.length - 1] ?? dataMax }
  }, [chartData, metric])

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
            ? [
                { label: 'Male', color: COLORS.male },
                { label: 'Female', color: COLORS.female },
              ]
            : [{ label: 'Cancellation Rate', color: COLORS.cancellation_rate }],
    [metric]
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
              {entry.name}: <span className="font-semibold">{entry.value.toLocaleString()}</span>
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
    >
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

          {metric === 'gender' && (
            <>
              <Line
                type="monotone"
                dataKey="male"
                name="Male"
                stroke={COLORS.male}
                strokeWidth={2}
                strokeLinecap="round"
                dot={{ fill: COLORS.male, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="male"
                  position="top"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={formatLabelListValue}
                />
              </Line>
              <Line
                type="monotone"
                dataKey="female"
                name="Female"
                stroke={COLORS.female}
                strokeWidth={2}
                strokeLinecap="round"
                dot={{ fill: COLORS.female, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList
                  dataKey="female"
                  position="bottom"
                  className="text-xs"
                  fill="hsl(var(--muted-foreground))"
                  formatter={formatLabelListValue}
                />
              </Line>
            </>
          )}

          {metric === 'cancellation_rate' && (
            <Line
              type="monotone"
              dataKey="cancellation_rate"
              name="Cancellation Rate %"
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
