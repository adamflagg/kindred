/**
 * VelocityPage - Registration velocity curves with week-over-week enrollment data.
 *
 * Shows:
 * - Cumulative enrollment line chart (current year + optional prior year overlays)
 * - Vertical phase markers for priority/early/open registration dates
 * - Week-over-week delta table
 */

import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Loader2, AlertCircle } from 'lucide-react'
import { useVelocity } from '../../../hooks/useVelocity'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import type { WeeklyDataPoint } from '../../../types/velocity'

const PRIOR_YEAR_COLORS = ['hsl(220, 60%, 65%)', 'hsl(280, 50%, 60%)', 'hsl(35, 70%, 55%)']

const PHASE_COLORS: Record<string, string> = {
  priority: 'hsl(270, 60%, 55%)',
  early: 'hsl(200, 70%, 50%)',
  open: 'hsl(140, 60%, 40%)',
}

export default function VelocityPage() {
  const { selectedSessionCmId, sessionTypesParam } = useMetricsSession()
  const { currentYear, availableYears } = useCurrentYear()
  const [selectedPriorYears, setSelectedPriorYears] = useState<number[]>([])

  const priorYearOptions = useMemo(
    () => availableYears.filter((y) => y < currentYear).sort((a, b) => b - a),
    [availableYears, currentYear]
  )

  const { data, isLoading, error } = useVelocity(currentYear, {
    sessionCmId: selectedSessionCmId,
    compareYears: selectedPriorYears,
    sessionTypes: sessionTypesParam,
  })

  // Build unified chart data with all years aligned by week index
  const chartData = useMemo(() => {
    if (!data?.combined?.weekly?.length) return []

    const maxWeeks = Math.max(
      data.combined.weekly.length,
      ...data.prior_years.map((py) => py.weekly.length)
    )

    return Array.from({ length: maxWeeks }, (_, i) => {
      const current = data.combined.weekly[i]
      const row: Record<string, string | number> = {
        week_label: current?.week_label ?? `Week ${i + 1}`,
        week_start: current?.week_start ?? '',
        enrolled: current?.enrolled ?? 0,
        waitlisted: current?.waitlisted ?? 0,
        delta: current?.delta ?? 0,
      }

      data.prior_years.forEach((py) => {
        const pyWeek = py.weekly[i]
        row[`enrolled_${py.year}`] = pyWeek?.enrolled ?? 0
      })

      return row
    })
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading velocity data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load velocity data: {error.message}</span>
      </div>
    )
  }

  if (!data || data.combined.weekly.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No velocity data available. Enrollment snapshots or attendee dates are needed.
      </div>
    )
  }

  const togglePriorYear = (year: number) => {
    setSelectedPriorYears((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
    )
  }

  // Find phase marker x-axis positions (match to nearest week_start)
  const phaseLines = data.phase_markers
    .map((marker) => {
      const weekIdx = data.combined.weekly.findIndex((w) => w.week_start >= marker.date)
      if (weekIdx < 0) return null
      const week = data.combined.weekly[weekIdx]
      if (!week) return null
      return { ...marker, weekLabel: week.week_label }
    })
    .filter(Boolean)

  return (
    <div className="space-y-6">
      {/* Year Overlay Checkboxes */}
      {priorYearOptions.length > 0 && (
        <div className="card-lodge p-4">
          <h3 className="text-foreground mb-2 text-sm font-medium">Compare with prior years</h3>
          <div className="flex flex-wrap gap-3">
            {priorYearOptions.slice(0, 4).map((year) => (
              <label key={year} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedPriorYears.includes(year)}
                  onChange={() => togglePriorYear(year)}
                  className="accent-primary h-4 w-4 rounded"
                />
                <span className="text-foreground">{year}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Enrollment Velocity Chart */}
      <div className="card-lodge p-4">
        <h3 className="text-foreground mb-4 text-base font-semibold">
          Enrollment Velocity - {currentYear}
        </h3>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="week_label"
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              interval="preserveStartEnd"
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              label={{
                value: 'Cumulative Enrolled',
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
              }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
                    <p className="text-foreground mb-1 font-medium">{label}</p>
                    {payload.map((entry) => (
                      <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
                        {entry.name}: {Number(entry.value).toLocaleString()}
                      </p>
                    ))}
                  </div>
                )
              }}
            />
            <Legend />

            {/* Phase marker vertical lines */}
            {phaseLines.map(
              (phase) =>
                phase && (
                  <ReferenceLine
                    key={phase.phase}
                    x={phase.weekLabel}
                    stroke={PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))'}
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    label={{
                      value: phase.label,
                      position: 'top',
                      style: {
                        fill: PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))',
                        fontSize: 11,
                      },
                    }}
                  />
                )
            )}

            {/* Current year line */}
            <Line
              type="monotone"
              dataKey="enrolled"
              name={String(currentYear)}
              stroke="hsl(160, 100%, 35%)"
              strokeWidth={3}
              dot={{ fill: 'hsl(160, 100%, 35%)', r: 4 }}
              activeDot={{ r: 6 }}
            />

            {/* Prior year lines */}
            {data.prior_years.map((py, i) => (
              <Line
                key={py.year}
                type="monotone"
                dataKey={`enrolled_${py.year}`}
                name={String(py.year)}
                stroke={PRIOR_YEAR_COLORS[i % PRIOR_YEAR_COLORS.length] ?? 'hsl(220, 60%, 65%)'}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                opacity={0.7}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-Session Breakdown */}
      {data.by_session.length > 1 && (
        <div className="card-lodge p-4">
          <h3 className="text-foreground mb-4 text-base font-semibold">By Session</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/30 border-b">
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">Session</th>
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    Latest Enrolled
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    Weeks Tracked
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.by_session.map((session) => {
                  const lastWeek = session.weekly[session.weekly.length - 1]
                  return (
                    <tr
                      key={session.session_cm_id}
                      className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                    >
                      <td className="text-foreground px-4 py-3 font-medium">
                        {session.session_name ?? `Session ${session.session_cm_id}`}
                      </td>
                      <td className="text-foreground px-4 py-3 text-right">
                        {lastWeek?.enrolled?.toLocaleString() ?? 0}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right">
                        {session.weekly.length}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Week-over-Week Delta Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">
            Week-over-Week Enrollment Changes
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Week</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  New Enrolled
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Delta</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Cumulative
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.combined.weekly.map((week: WeeklyDataPoint) => (
                <tr
                  key={week.week_start}
                  className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                >
                  <td className="text-foreground px-4 py-3 font-medium">{week.week_label}</td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {week.delta > 0 ? `+${week.delta}` : week.delta}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        week.delta > 0
                          ? 'text-green-600 dark:text-green-400'
                          : week.delta < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                      }
                    >
                      {week.delta > 0 ? `+${week.delta}` : week.delta}
                    </span>
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {week.enrolled.toLocaleString()}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-right text-xs capitalize">
                    {week.data_source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
