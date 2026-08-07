/**
 * VelocityPage - Registration velocity curves with week-over-week enrollment data.
 *
 * Shows:
 * - Cumulative enrollment line chart (current year + optional prior year overlays)
 * - Optional gender split (boys/girls lines instead of combined)
 * - Brush zoom/scrub for inspecting specific time periods
 * - Week-range dropdown selectors synced with brush
 * - Vertical phase markers for priority/early/open registration dates
 * - Color-coded phase marker legend below chart title
 * - Summary comparison cards (current vs prior year enrollment + cancellations)
 * - Per-session breakdown table with prior-year comparison columns
 * - Week-over-week delta table with prior-year columns
 */

import { Fragment, useMemo, useState } from 'react'
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
  ReferenceArea,
  Brush,
} from 'recharts'
import { Loader2, AlertCircle } from 'lucide-react'
import { useVelocity } from '../../../hooks/useVelocity'
import { useChartZoom } from '../../../hooks/useChartZoom'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useVelocityControls } from '../../../hooks/useVelocityControls'
import { useVelocityChartData } from '../../../hooks/useVelocityChartData'
import type { SessionColumnDef, DeltaColumnDef } from '../../../components/velocity'
import {
  VelocityControls,
  SessionBreakdownTable,
  WeeklyDeltaTable,
} from '../../../components/velocity'
import type { WeeklyDataPoint } from '../../../types/velocity'
import { PHASE_COLORS } from './phaseColors'
import {
  PRIOR_YEAR_COLORS,
  GENDER_COLORS,
  formatDateShort,
  priorYearDailyDateLabel,
} from '../../../utils/chartFormatters'
import PartialWeekDot from './PartialWeekDot'

type VelocityViewMode = 'gross' | 'net' | 'delta'

const VIEW_MODE_LABELS: Record<VelocityViewMode, string> = {
  gross: 'Gross Cumulative',
  net: 'Net Cumulative',
  delta: 'Weekly Delta',
}

const Y_AXIS_LABELS: Record<VelocityViewMode, string> = {
  gross: 'Gross Enrollment',
  net: 'Net Enrollment',
  delta: 'Weekly Change',
}

function formatDeltaValue(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function deltaColorClass(value: number | null): string {
  if (value != null && value > 0) return 'text-green-600 dark:text-green-400'
  if (value != null && value < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

/** Compute the calendar date for a prior year at a given week offset from its season start. */
function priorYearDateLabel(
  seasonStarts: Record<number, string> | undefined,
  year: number,
  weekNum: number
): string | null {
  const seasonStart = seasonStarts?.[year]
  if (!seasonStart) return null
  const d = new Date(seasonStart + 'T00:00:00')
  d.setDate(d.getDate() + (weekNum - 1) * 7)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function VelocityPage() {
  const { selectedSessionCmId, sessionTypesParam, sessions, durationParam } = useMetricsSession()
  const { currentYear, availableYears } = useCurrentYear()
  const controls = useVelocityControls(availableYears, currentYear)
  const [viewMode, setViewMode] = useState<VelocityViewMode>('net')

  const { data, isLoading, error } = useVelocity(currentYear, {
    sessionCmId: selectedSessionCmId,
    compareYears: controls.selectedPriorYears,
    sessionTypes: sessionTypesParam,
    splitByGender: controls.splitByGender,
    duration: durationParam,
  })

  const chartData = useVelocityChartData(data, sessions, {
    metric: 'enrollment',
    splitByGender: controls.splitByGender,
    selectedPriorYears: controls.selectedPriorYears,
  })
  const { phaseLines } = chartData

  // Separate zoom state per chart to avoid cross-contamination (#510)
  const weeklyZoom = useChartZoom(chartData.weeklyChartData.length)
  const dailyZoom = useChartZoom(chartData.dailyChartData.length)

  // Map week_number -> PhaseMarker for table badge lookup (page-specific)
  const phaseByWeek = useMemo(() => {
    const map = new Map<number, (typeof phaseLines)[0]>()
    for (const phase of phaseLines) {
      map.set(phase.weekNumber, phase)
    }
    return map
  }, [phaseLines])

  // Summary card values
  const summaryCards = useMemo(() => {
    if (!data) return null
    const currentWeekly = data.combined.weekly
    if (!currentWeekly.length) return null

    const currentLatest = currentWeekly.at(-1)
    if (!currentLatest) return null
    const currentMaxWeek = currentLatest.week_number
    const currentEnrolled = currentLatest.enrolled

    let priorAtWeek: number | null = null
    let priorFinal: number | null = null
    let priorYear: number | null = null

    if (data.prior_years.length > 0) {
      const py = data.prior_years[0]
      if (py) {
        priorYear = py.year
        const pyMap = new Map(py.weekly.map((d) => [d.week_number, d]))
        priorAtWeek = pyMap.get(currentMaxWeek)?.enrolled ?? null
        const pyLast = py.weekly.at(-1)
        priorFinal = pyLast?.enrolled ?? null
      }
    }

    const delta = priorAtWeek != null ? currentEnrolled - priorAtWeek : null

    const cancelledToDate = data.cancelled_to_date
    const priorCancelled =
      data.prior_year_cancelled_to_date.length > 0 ? data.prior_year_cancelled_to_date[0] : null

    return {
      currentEnrolled,
      currentWeekNumber: currentMaxWeek,
      priorAtWeek,
      priorFinal,
      priorYear,
      delta,
      cancelledToDate,
      priorCancelledAtWeek: priorCancelled?.cancelled_at_current_week ?? null,
      priorCancelledFinal: priorCancelled?.cancelled_final ?? null,
    }
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

  // Build gender breakdown lookup for session table
  const genderBreakdownMap = new Map(data.session_gender_breakdown.map((b) => [b.session_cm_id, b]))

  const hasPriorYear = controls.selectedPriorYears.length > 0

  // View mode toggle (passed as extraControls to VelocityControls)
  const viewModeToggle = (
    <div className="border-border flex overflow-hidden rounded-lg border">
      {(['gross', 'net', 'delta'] as VelocityViewMode[]).map((mode) => (
        <button
          key={mode}
          data-tour={`velocity-mode-${mode}`}
          onClick={() => {
            setViewMode(mode)
            weeklyZoom.resetZoom()
            dailyZoom.resetZoom()
          }}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === mode
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:bg-muted/50'
          }`}
        >
          {VIEW_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  )

  // Column definitions for session breakdown table
  const sessionColumns: SessionColumnDef[] = [
    {
      header: 'Session',
      accessor: (session) => session.session_name ?? `Session ${session.session_cm_id}`,
      className: 'text-left',
    },
    ...(controls.splitByGender
      ? [
          {
            header: 'Boys',
            accessor: (session) => {
              const genderData = session.session_cm_id
                ? genderBreakdownMap.get(session.session_cm_id)
                : undefined
              return (
                <span style={{ color: GENDER_COLORS.boys }}>
                  {genderData?.boys_enrolled.toLocaleString() ?? '-'}
                </span>
              )
            },
            className: 'text-right',
          } satisfies SessionColumnDef,
          {
            header: 'Girls',
            accessor: (session) => {
              const genderData = session.session_cm_id
                ? genderBreakdownMap.get(session.session_cm_id)
                : undefined
              return (
                <span style={{ color: GENDER_COLORS.girls }}>
                  {genderData?.girls_enrolled.toLocaleString() ?? '-'}
                </span>
              )
            },
            className: 'text-right',
          } satisfies SessionColumnDef,
        ]
      : []),
    {
      header: controls.splitByGender ? 'Total' : 'Latest Enrolled',
      accessor: (session) => {
        const lastPoint = session.weekly.at(-1)
        return (lastPoint?.enrolled ?? 0).toLocaleString()
      },
      className: 'text-right',
    },
    ...(hasPriorYear
      ? [
          {
            header: `Prior Yr${summaryCards ? ` (Wk ${summaryCards.currentWeekNumber})` : ''}`,
            accessor: (_session, priorSession) => (
              <span className="text-muted-foreground">
                {priorSession?.enrolled_at_current_week?.toLocaleString() ?? '-'}
              </span>
            ),
            className: 'text-right',
          } satisfies SessionColumnDef,
          {
            header: 'Prior Yr Final',
            accessor: (_session, priorSession) => (
              <span className="text-muted-foreground">
                {priorSession?.final_enrolled.toLocaleString() ?? '-'}
              </span>
            ),
            className: 'text-right',
          } satisfies SessionColumnDef,
          {
            header: 'vs Prior',
            accessor: (session, priorSession) => {
              const lastPoint = session.weekly.at(-1)
              const currentEnrolled = lastPoint?.enrolled ?? 0
              const vsPrior =
                priorSession != null ? currentEnrolled - priorSession.final_enrolled : null
              return (
                <span className={deltaColorClass(vsPrior)}>
                  {vsPrior != null ? formatDeltaValue(vsPrior) : '-'}
                </span>
              )
            },
            className: 'text-right',
          } satisfies SessionColumnDef,
        ]
      : []),
    {
      header: 'Weeks Tracked',
      accessor: (session) => <span className="text-muted-foreground">{session.weekly.length}</span>,
      className: 'text-right',
    },
  ]

  // Column definitions for weekly delta table
  const deltaColumns: DeltaColumnDef[] = [
    {
      header: 'New',
      accessor: (week) => (
        <span className="text-green-600 dark:text-green-400">
          {week.weekly_new > 0 ? `+${week.weekly_new}` : week.weekly_new}
        </span>
      ),
      className: 'text-right',
    },
    {
      header: 'Cancelled',
      accessor: (week) => (
        <span className="text-red-600 dark:text-red-400">{week.weekly_cancelled ?? 0}</span>
      ),
      className: 'text-right',
    },
    {
      header: 'Net Change',
      accessor: (week) => (
        <span className={deltaColorClass(week.delta)}>{formatDeltaValue(week.delta)}</span>
      ),
      className: 'text-right',
    },
    {
      header: 'Net Cumulative',
      accessor: (week) => <span className="text-foreground">{week.enrolled.toLocaleString()}</span>,
      className: 'text-right',
    },
    {
      header: 'Gross Cumulative',
      accessor: (week) => (
        <span className="text-foreground">{week.gross_enrolled.toLocaleString()}</span>
      ),
      className: 'text-right',
    },
    ...(hasPriorYear && chartData.priorWeekMap
      ? [
          {
            header: 'Prior Year',
            accessor: (_week: WeeklyDataPoint, priorPoint?: WeeklyDataPoint) => (
              <span className="text-muted-foreground">
                {priorPoint?.enrolled.toLocaleString() ?? '-'}
              </span>
            ),
            className: 'text-right',
          } satisfies DeltaColumnDef,
          {
            header: 'Prior Delta',
            accessor: (_week: WeeklyDataPoint, priorPoint?: WeeklyDataPoint) => (
              <span className={deltaColorClass(priorPoint?.delta ?? null)}>
                {priorPoint ? formatDeltaValue(priorPoint.delta) : '-'}
              </span>
            ),
            className: 'text-right',
          } satisfies DeltaColumnDef,
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div data-tour="velocity-controls">
        <VelocityControls
          priorYearOptions={controls.priorYearOptions}
          selectedPriorYears={controls.selectedPriorYears}
          splitByGender={controls.splitByGender}
          onTogglePriorYear={controls.togglePriorYear}
          onToggleGender={controls.handleGenderToggle}
          extraControls={viewModeToggle}
        />
      </div>

      {/* Summary Comparison Cards */}
      {summaryCards && hasPriorYear && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">
              Enrolled ({currentYear}, Wk {summaryCards.currentWeekNumber})
            </p>
            <p className="text-foreground text-xl font-bold">
              {summaryCards.currentEnrolled.toLocaleString()}
            </p>
          </div>
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">
              {summaryCards.priorYear} at Wk {summaryCards.currentWeekNumber}
            </p>
            <p className="text-foreground text-xl font-bold">
              {summaryCards.priorAtWeek?.toLocaleString() ?? '-'}
            </p>
          </div>
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">vs {summaryCards.priorYear}</p>
            <p className={`text-xl font-bold ${deltaColorClass(summaryCards.delta)}`}>
              {summaryCards.delta != null ? formatDeltaValue(summaryCards.delta) : '-'}
            </p>
          </div>
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">
              {summaryCards.priorYear} Final
            </p>
            <p className="text-foreground text-xl font-bold">
              {summaryCards.priorFinal?.toLocaleString() ?? '-'}
            </p>
          </div>
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">Cancelled to Date</p>
            <p className="text-foreground text-xl font-bold">
              {summaryCards.cancelledToDate?.toLocaleString() ?? '-'}
            </p>
          </div>
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">
              {summaryCards.priorYear} Cancelled at Wk {summaryCards.currentWeekNumber}
            </p>
            <p className="text-foreground text-xl font-bold">
              {summaryCards.priorCancelledAtWeek?.toLocaleString() ?? '-'}
            </p>
          </div>
        </div>
      )}

      {/* Enrollment Velocity Chart */}
      <div data-tour="velocity-chart" className="card-lodge p-4">
        <h3 className="text-foreground mb-2 text-base font-semibold">
          {VIEW_MODE_LABELS[viewMode]} Enrollment - {currentYear}
        </h3>

        {/* Phase marker legend */}
        {chartData.phaseLines.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4 text-xs">
            {chartData.phaseLines.map((phase) => (
              <div key={phase.phase} className="flex items-center gap-1.5">
                {viewMode === 'delta' ? (
                  <span
                    className="inline-block w-5 border-t-2 border-dashed"
                    style={{
                      borderColor: PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))',
                    }}
                  />
                ) : (
                  <span
                    className="inline-block h-3 w-5 rounded-sm"
                    style={{
                      backgroundColor: PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))',
                      opacity: 0.25,
                    }}
                  />
                )}
                <span className="text-muted-foreground">{phase.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* X-axis date context note when comparing years */}
        {controls.selectedPriorYears.length > 0 && (
          <p className="text-muted-foreground mb-3 text-xs italic">
            X-axis dates are for {currentYear}. Hover for prior year dates.
          </p>
        )}

        {/* Zoom range selectors */}
        {viewMode === 'delta'
          ? chartData.weeklyChartData.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label
                  htmlFor="velocity-weekly-zoom-start"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Zoom:
                </label>
                <select
                  id="velocity-weekly-zoom-start"
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={weeklyZoom.zoomRange?.[0] ?? 0}
                  onChange={(e) => {
                    const start = Number(e.target.value)
                    const end = weeklyZoom.zoomRange?.[1] ?? chartData.weeklyChartData.length - 1
                    weeklyZoom.setZoomRange([start, Math.max(start, end)])
                  }}
                >
                  {chartData.weeklyChartData.map((pt, i) => (
                    <option key={i} value={i}>
                      Wk {pt['week_number']} - {pt['label']}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">to</span>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={weeklyZoom.zoomRange?.[1] ?? chartData.weeklyChartData.length - 1}
                  onChange={(e) => {
                    const end = Number(e.target.value)
                    const start = weeklyZoom.zoomRange?.[0] ?? 0
                    weeklyZoom.setZoomRange([Math.min(start, end), end])
                  }}
                >
                  {chartData.weeklyChartData.map((pt, i) => (
                    <option key={i} value={i}>
                      Wk {pt['week_number']} - {pt['label']}
                    </option>
                  ))}
                </select>
                {weeklyZoom.isZoomedIn && (
                  <button
                    className="text-primary hover:text-primary/80 text-xs underline"
                    onClick={weeklyZoom.resetZoom}
                  >
                    Reset
                  </button>
                )}
              </div>
            )
          : chartData.dailyZoomMilestones.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label
                  htmlFor="velocity-daily-zoom-start"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Zoom:
                </label>
                <select
                  id="velocity-daily-zoom-start"
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={dailyZoom.zoomRange?.[0] ?? 0}
                  onChange={(e) => {
                    const start = Number(e.target.value)
                    const end = dailyZoom.zoomRange?.[1] ?? chartData.dailyChartData.length - 1
                    dailyZoom.setZoomRange([start, Math.max(start, end)])
                  }}
                >
                  {chartData.dailyZoomMilestones.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">to</span>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={dailyZoom.zoomRange?.[1] ?? chartData.dailyChartData.length - 1}
                  onChange={(e) => {
                    const end = Number(e.target.value)
                    const start = dailyZoom.zoomRange?.[0] ?? 0
                    dailyZoom.setZoomRange([Math.min(start, end), end])
                  }}
                >
                  {chartData.dailyZoomMilestones.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {dailyZoom.isZoomedIn && (
                  <button
                    className="text-primary hover:text-primary/80 text-xs underline"
                    onClick={dailyZoom.resetZoom}
                  >
                    Reset
                  </button>
                )}
              </div>
            )}

        <ResponsiveContainer width="100%" height={380} key={`velocity-chart-${currentYear}`}>
          {viewMode === 'delta' ? (
            <LineChart
              data={chartData.weeklyChartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 35 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="week_number"
                type="number"
                domain={['dataMin', 'dataMax']}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(wn: number) => chartData.weekLabelMap.get(wn) ?? `Wk${wn}`}
                interval="preserveStartEnd"
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                label={{
                  value: Y_AXIS_LABELS[viewMode],
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
                }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload.length) return null
                  const validPayload = payload.filter((entry) => entry.value != null)
                  if (!validPayload.length) return null
                  const displayLabel =
                    chartData.weekLabelMap.get(label as number) ?? `Week ${label}`
                  const row = chartData.weeklyChartData.find((d) => d['week_number'] === label)
                  const weekStart = row?.['week_start']
                  const isPartial = row?.['is_partial'] as boolean
                  const daysInWeek = row?.['days_in_week'] as number
                  return (
                    <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
                      <p className="text-foreground mb-1 font-medium">{displayLabel}</p>
                      {weekStart && (
                        <p className="text-muted-foreground mb-1 text-xs">{weekStart as string}</p>
                      )}
                      {isPartial && (
                        <p className="mb-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          Partial week ({daysInWeek}/7 days)
                        </p>
                      )}
                      {validPayload.map((entry) => {
                        const yearMatch = String(entry.name ?? '').match(/\b(\d{4})\b/)
                        const priorDate =
                          yearMatch && label != null
                            ? priorYearDateLabel(
                                data.prior_year_season_starts,
                                Number(yearMatch[1]),
                                label as number
                              )
                            : null
                        return (
                          <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
                            {entry.name}: {Number(entry.value).toLocaleString()}
                            {priorDate && (
                              <span className="text-muted-foreground ml-1 text-xs">
                                ({priorDate})
                              </span>
                            )}
                          </p>
                        )
                      })}
                    </div>
                  )
                }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />

              {/* Brush for zoom/scrub */}
              <Brush
                dataKey="week_number"
                height={20}
                stroke="hsl(var(--primary))"
                onChange={weeklyZoom.handleBrushChange}
                {...(weeklyZoom.zoomRange
                  ? {
                      startIndex: Math.min(
                        weeklyZoom.zoomRange[0],
                        Math.max(0, chartData.weeklyChartData.length - 1)
                      ),
                      endIndex: Math.min(
                        weeklyZoom.zoomRange[1],
                        Math.max(0, chartData.weeklyChartData.length - 1)
                      ),
                    }
                  : {})}
                tickFormatter={(wn: number) => chartData.weekLabelMap.get(wn) ?? `Wk${wn}`}
              />

              {/* Phase marker vertical lines */}
              {chartData.phaseLines.map((phase) => (
                <ReferenceLine
                  key={phase.phase}
                  x={phase.weekNumber}
                  stroke={PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))'}
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              ))}

              {controls.splitByGender ? (
                <>
                  {/* Gender split delta: boys + girls new/cancelled lines */}
                  <Line
                    type="monotone"
                    dataKey="weekly_new_boys"
                    name={`New Boys ${currentYear}`}
                    stroke={GENDER_COLORS.boys}
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="weekly_new_girls"
                    name={`New Girls ${currentYear}`}
                    stroke={GENDER_COLORS.girls}
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="weekly_cancelled_boys"
                    name={`Cancelled Boys ${currentYear}`}
                    stroke={GENDER_COLORS.boys}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="weekly_cancelled_girls"
                    name={`Cancelled Girls ${currentYear}`}
                    stroke={GENDER_COLORS.girls}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  {/* Prior year gender delta (first prior year only) */}
                  {controls.selectedPriorYears.slice(0, 1).map((year) => (
                    <Fragment key={year}>
                      <Line
                        type="monotone"
                        dataKey={`weekly_new_boys_${year}`}
                        name={`New Boys ${year}`}
                        stroke={GENDER_COLORS.boys}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        opacity={0.5}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={`weekly_new_girls_${year}`}
                        name={`New Girls ${year}`}
                        stroke={GENDER_COLORS.girls}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        opacity={0.5}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={`weekly_cancelled_boys_${year}`}
                        name={`Cancelled Boys ${year}`}
                        stroke={GENDER_COLORS.boys}
                        strokeWidth={1}
                        strokeDasharray="6 3"
                        dot={false}
                        opacity={0.5}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={`weekly_cancelled_girls_${year}`}
                        name={`Cancelled Girls ${year}`}
                        stroke={GENDER_COLORS.girls}
                        strokeWidth={1}
                        strokeDasharray="6 3"
                        dot={false}
                        opacity={0.5}
                        connectNulls={false}
                      />
                    </Fragment>
                  ))}
                </>
              ) : (
                <>
                  {/* Current year lines */}
                  <Line
                    type="monotone"
                    dataKey="weekly_new"
                    name={`New ${currentYear}`}
                    stroke="hsl(150, 60%, 45%)"
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="weekly_cancelled"
                    name={`Cancelled ${currentYear}`}
                    stroke="hsl(0, 65%, 55%)"
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />

                  {/* Prior year lines (dashed) */}
                  {data.prior_years.map((py) => (
                    <Fragment key={py.year}>
                      <Line
                        type="monotone"
                        dataKey={`weekly_new_${py.year}`}
                        name={`New ${py.year}`}
                        stroke="hsl(150, 40%, 65%)"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        opacity={0.7}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={`weekly_cancelled_${py.year}`}
                        name={`Cancelled ${py.year}`}
                        stroke="hsl(0, 40%, 70%)"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        opacity={0.7}
                        connectNulls={false}
                      />
                    </Fragment>
                  ))}
                </>
              )}
            </LineChart>
          ) : (
            <LineChart
              data={chartData.dailyChartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 35 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="day_offset"
                type="number"
                domain={['dataMin', 'dataMax']}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(offset: number) => {
                  // Show date labels every 7 days
                  if (offset % 7 !== 0) return ''
                  return chartData.dailyTickFormatter(offset)
                }}
                interval={0}
                minTickGap={40}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                label={{
                  value: Y_AXIS_LABELS[viewMode],
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
                }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload.length) return null
                  const validPayload = payload.filter((entry) => entry.value != null)
                  if (!validPayload.length) return null
                  const dayOffset = label as number
                  const row = chartData.dailyChartData.find((d) => d['day_offset'] === dayOffset)
                  const dateStr = row?.['date'] as string
                  const weekNum = Math.floor(dayOffset / 7) + 1
                  const dateLabel = dateStr
                    ? formatDateShort(dateStr)
                    : chartData.dailyTickFormatter(dayOffset)
                  return (
                    <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
                      <p className="text-foreground mb-1 font-medium">{dateLabel}</p>
                      <p className="text-muted-foreground mb-1 text-xs">
                        Day {dayOffset + 1} (Week {weekNum})
                      </p>
                      {validPayload.map((entry) => {
                        const yearMatch = String(entry.name ?? '').match(/\b(\d{4})\b/)
                        const priorDate = yearMatch
                          ? priorYearDailyDateLabel(
                              data.prior_year_season_starts,
                              Number(yearMatch[1]),
                              dayOffset
                            )
                          : null
                        return (
                          <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
                            {entry.name}: {Number(entry.value).toLocaleString()}
                            {priorDate && (
                              <span className="text-muted-foreground ml-1 text-xs">
                                ({priorDate})
                              </span>
                            )}
                          </p>
                        )
                      })}
                    </div>
                  )
                }}
              />
              <Legend />

              {/* Brush for zoom/scrub */}
              <Brush
                dataKey="day_offset"
                height={20}
                stroke="hsl(var(--primary))"
                onChange={dailyZoom.handleBrushChange}
                {...(dailyZoom.zoomRange
                  ? {
                      startIndex: Math.min(
                        dailyZoom.zoomRange[0],
                        Math.max(0, chartData.dailyChartData.length - 1)
                      ),
                      endIndex: Math.min(
                        dailyZoom.zoomRange[1],
                        Math.max(0, chartData.dailyChartData.length - 1)
                      ),
                    }
                  : {})}
                tickFormatter={(offset: number) => chartData.dailyTickFormatter(offset)}
              />

              {/* Phase marker bands (ReferenceArea) */}
              {chartData.phaseDayOffsets.map((phase) => (
                <ReferenceArea
                  key={phase.phase}
                  x1={phase.dayOffset}
                  x2={phase.dayOffset + 1}
                  fill={PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))'}
                  fillOpacity={0.15}
                  strokeOpacity={0}
                />
              ))}

              {controls.splitByGender ? (
                <>
                  {/* Gender split: boys + girls lines */}
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'gross' ? 'gross_enrolled_boys' : 'enrolled_boys'}
                    name={`Boys ${currentYear}`}
                    stroke={GENDER_COLORS.boys}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'gross' ? 'gross_enrolled_girls' : 'enrolled_girls'}
                    name={`Girls ${currentYear}`}
                    stroke={GENDER_COLORS.girls}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  {/* Prior year gender lines (dashed) */}
                  {controls.selectedPriorYears.slice(0, 1).map((year) => (
                    <Fragment key={year}>
                      <Line
                        type="monotone"
                        dataKey={
                          viewMode === 'gross'
                            ? `gross_enrolled_boys_${year}`
                            : `enrolled_boys_${year}`
                        }
                        name={`Boys ${year}`}
                        stroke={GENDER_COLORS.boys}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        opacity={0.6}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={
                          viewMode === 'gross'
                            ? `gross_enrolled_girls_${year}`
                            : `enrolled_girls_${year}`
                        }
                        name={`Girls ${year}`}
                        stroke={GENDER_COLORS.girls}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        opacity={0.6}
                        connectNulls={false}
                      />
                    </Fragment>
                  ))}
                </>
              ) : (
                <>
                  {/* Combined: single enrollment line */}
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'gross' ? 'gross_enrolled' : 'enrolled'}
                    name={String(currentYear)}
                    stroke="hsl(160, 100%, 35%)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  {/* Prior year lines */}
                  {data.prior_years.map((py, i) => (
                    <Line
                      key={py.year}
                      type="monotone"
                      dataKey={
                        viewMode === 'gross' ? `gross_enrolled_${py.year}` : `enrolled_${py.year}`
                      }
                      name={String(py.year)}
                      stroke={
                        PRIOR_YEAR_COLORS[i % PRIOR_YEAR_COLORS.length] ?? 'hsl(220, 60%, 65%)'
                      }
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      opacity={0.7}
                      connectNulls={false}
                    />
                  ))}
                </>
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Per-Session Breakdown */}
      {chartData.sortedBySession.length > 1 && (
        <div className="card-lodge p-4">
          <h3 className="text-foreground mb-4 text-base font-semibold">By Session</h3>
          <SessionBreakdownTable
            sortedBySession={chartData.sortedBySession}
            priorSessionMap={chartData.priorSessionMap}
            columns={sessionColumns}
          />
        </div>
      )}

      {/* Week-over-Week Delta Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">
            Week-over-Week Enrollment Changes
          </h3>
        </div>
        <WeeklyDeltaTable
          weeks={data.combined.weekly}
          priorWeekMap={chartData.priorWeekMap}
          columns={deltaColumns}
          phaseByWeek={phaseByWeek}
        />
      </div>
    </div>
  )
}
