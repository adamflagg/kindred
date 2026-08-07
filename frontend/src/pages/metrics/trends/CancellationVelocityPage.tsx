/**
 * CancellationVelocityPage - Cancellation velocity curves with week-over-week data.
 *
 * Mirrors VelocityPage structure but with cancellation-specific theming:
 * - Red/coral color scheme for current year line
 * - Y-axis label: "Cumulative Cancelled"
 * - Same controls: prior year checkboxes, gender split, Brush zoom
 * - Per-session cancellation breakdown + week-over-week delta tables
 * - Summary cards: cancelled to date, prior year comparison, delta
 * - Inverted color semantics: more cancellations = red (bad), fewer = green (good)
 * - Daily cumulative chart (from data.daily) with day_offset x-axis
 * - Phase marker bands (ReferenceArea) on daily chart; falls back to weekly on no daily data
 */

import { Fragment, useMemo } from 'react'
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

/** Inverted delta color: more cancellations = red (bad), fewer = green (good). */
function invertedDeltaColorClass(value: number | null): string {
  if (value != null && value > 0) return 'text-red-600 dark:text-red-400'
  if (value != null && value < 0) return 'text-green-600 dark:text-green-400'
  return 'text-muted-foreground'
}

function formatDeltaValue(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
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

export default function CancellationVelocityPage() {
  const { selectedSessionCmId, sessionTypesParam, sessions, durationParam } = useMetricsSession()
  const { currentYear, availableYears } = useCurrentYear()
  const controls = useVelocityControls(availableYears, currentYear)

  const { data, isLoading, error } = useVelocity(currentYear, {
    sessionCmId: selectedSessionCmId,
    compareYears: controls.selectedPriorYears,
    sessionTypes: sessionTypesParam,
    splitByGender: controls.splitByGender,
    metric: 'cancellation',
    duration: durationParam,
  })

  const chartData = useVelocityChartData(data, sessions, {
    metric: 'cancellation',
    splitByGender: controls.splitByGender,
    selectedPriorYears: controls.selectedPriorYears,
  })

  // Separate zoom state per chart to avoid cross-contamination (#510)
  const weeklyZoom = useChartZoom(chartData.weeklyChartData.length)
  const dailyZoom = useChartZoom(chartData.dailyChartData.length)

  // Summary card values (cancellation-specific: 4 cards, inverted colors)
  const summaryCards = useMemo(() => {
    if (!data) return null
    const currentWeekly = data.combined.weekly
    if (!currentWeekly.length) return null

    const currentLatest = currentWeekly.at(-1)
    if (!currentLatest) return null
    const currentMaxWeek = currentLatest.week_number
    const currentCancelled = currentLatest.enrolled // repurposed as cancelled count

    let priorAtWeek: number | null = null
    let priorFinal: number | null = null
    let priorYear: number | null = null

    // Use backend cancelled_at_current_week when available (more accurate with fallback)
    const priorCancelledSummary =
      data.prior_year_cancelled_to_date.length > 0 ? data.prior_year_cancelled_to_date[0] : null

    if (data.prior_years.length > 0) {
      const py = data.prior_years[0]
      if (py) {
        priorYear = py.year
        priorAtWeek = priorCancelledSummary?.cancelled_at_current_week ?? null
        // Fallback to manual week lookup if backend didn't provide it
        if (priorAtWeek == null) {
          const pyMap = new Map(py.weekly.map((d) => [d.week_number, d]))
          priorAtWeek = pyMap.get(currentMaxWeek)?.enrolled ?? null
        }
        priorFinal = priorCancelledSummary?.cancelled_final ?? null
        if (priorFinal == null) {
          const pyLast = py.weekly.at(-1)
          priorFinal = pyLast?.enrolled ?? null
        }
      }
    }

    const delta = priorAtWeek != null ? currentCancelled - priorAtWeek : null

    return {
      currentCancelled,
      currentWeekNumber: currentMaxWeek,
      priorAtWeek,
      priorFinal,
      priorYear,
      delta,
    }
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading cancellation data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load cancellation data: {error.message}</span>
      </div>
    )
  }

  if (!data || data.combined.weekly.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No cancellation velocity data available. Status history or enrollment snapshots are needed.
      </div>
    )
  }

  // Build gender breakdown lookup for session table
  const genderBreakdownMap = new Map(data.session_gender_breakdown.map((b) => [b.session_cm_id, b]))

  const hasPriorYear = controls.selectedPriorYears.length > 0

  // Column definitions for session breakdown table (cancellation-specific)
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
      header: controls.splitByGender ? 'Total' : 'Total Cancelled',
      accessor: (session) => {
        const lastPoint = session.weekly.at(-1)
        return (
          <span className="text-red-600 dark:text-red-400">
            {(lastPoint?.enrolled ?? 0).toLocaleString()}
          </span>
        )
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
              const currentCancelled = lastPoint?.enrolled ?? 0
              // Inverted: positive vsPrior = more cancellations = bad
              const vsPrior =
                priorSession != null ? currentCancelled - priorSession.final_enrolled : null
              return (
                <span className={invertedDeltaColorClass(vsPrior)}>
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

  // Column definitions for weekly delta table (cancellation-specific: simpler columns)
  const deltaColumns: DeltaColumnDef[] = [
    {
      header: 'Change',
      accessor: (week) => (
        <span className={invertedDeltaColorClass(week.delta)}>
          {week.delta > 0 ? `+${week.delta}` : week.delta}
        </span>
      ),
      className: 'text-right',
    },
    {
      header: 'Cumulative',
      accessor: (week) => (
        <span className="text-red-600 dark:text-red-400">{week.enrolled.toLocaleString()}</span>
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
              <span className="text-muted-foreground">
                {priorPoint
                  ? priorPoint.delta > 0
                    ? `+${priorPoint.delta}`
                    : priorPoint.delta
                  : '-'}
              </span>
            ),
            className: 'text-right',
          } satisfies DeltaColumnDef,
        ]
      : []),
    {
      header: 'Source',
      accessor: (week) => (
        <span className="text-muted-foreground text-xs capitalize">{week.data_source}</span>
      ),
      className: 'text-right',
    },
  ]

  // Use daily chart if available, otherwise fall back to weekly
  const useDailyChart = chartData.dailyChartData.length > 0

  return (
    <div className="space-y-6">
      {/* Controls — no extraControls (no viewMode toggle for cancellation) */}
      <div data-tour="cancel-velocity-controls">
        <VelocityControls
          priorYearOptions={controls.priorYearOptions}
          selectedPriorYears={controls.selectedPriorYears}
          splitByGender={controls.splitByGender}
          onTogglePriorYear={controls.togglePriorYear}
          onToggleGender={controls.handleGenderToggle}
        />
      </div>

      {/* Summary Cards (4 cards, inverted colors) */}
      {summaryCards && hasPriorYear && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">
              Cancelled ({currentYear}, Wk {summaryCards.currentWeekNumber})
            </p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">
              {summaryCards.currentCancelled.toLocaleString()}
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
            <p className={`text-xl font-bold ${invertedDeltaColorClass(summaryCards.delta)}`}>
              {summaryCards.delta != null ? formatDeltaValue(summaryCards.delta) : '-'}
            </p>
          </div>
          <div className="card-lodge p-3">
            <p className="text-muted-foreground text-xs font-medium">
              {summaryCards.priorYear} Final Cancelled
            </p>
            <p className="text-foreground text-xl font-bold">
              {summaryCards.priorFinal?.toLocaleString() ?? '-'}
            </p>
          </div>
        </div>
      )}

      {/* Session Swap Annotation */}
      {data.session_swap_count != null &&
        data.session_swap_count > 0 &&
        data.cancelled_to_date != null &&
        data.cancelled_to_date > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            <span className="font-medium text-amber-800 dark:text-amber-300">
              {data.session_swap_count} of {data.cancelled_to_date} cancellations (
              {Math.round((data.session_swap_count / data.cancelled_to_date) * 100)}%) are session
              swaps
            </span>
            <span className="text-muted-foreground">
              {' '}
              — cancelled one session and enrolled in another within the same day
            </span>
          </div>
        )}

      {/* Cancellation Velocity Chart */}
      <div data-tour="cancel-velocity-chart" className="card-lodge p-4">
        <h3 className="text-foreground mb-2 text-base font-semibold">
          Cancellation Velocity - {currentYear}
        </h3>

        {/* Phase marker legend */}
        {chartData.phaseLines.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4 text-xs">
            {chartData.phaseLines.map((phase) => (
              <div key={phase.phase} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-5 rounded-sm"
                  style={{
                    backgroundColor: PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))',
                    opacity: 0.25,
                  }}
                />
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
        {useDailyChart
          ? chartData.dailyZoomMilestones.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label
                  htmlFor="cancellation-daily-zoom-start"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Zoom:
                </label>
                <select
                  id="cancellation-daily-zoom-start"
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
            )
          : chartData.weeklyChartData.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label
                  htmlFor="cancellation-weekly-zoom-start"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Zoom:
                </label>
                <select
                  id="cancellation-weekly-zoom-start"
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
            )}

        <ResponsiveContainer width="100%" height={380}>
          {useDailyChart ? (
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
                  value: 'Cumulative Cancelled',
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
                        Day {dayOffset} (Week {weekNum})
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
                  <Line
                    type="monotone"
                    dataKey="cancelled_boys"
                    name={`Boys ${currentYear}`}
                    stroke={GENDER_COLORS.boys}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cancelled_girls"
                    name={`Girls ${currentYear}`}
                    stroke={GENDER_COLORS.girls}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  {controls.selectedPriorYears.slice(0, 1).map((year) => (
                    <Fragment key={year}>
                      <Line
                        type="monotone"
                        dataKey={`cancelled_boys_${year}`}
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
                        dataKey={`cancelled_girls_${year}`}
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
                  <Line
                    type="monotone"
                    dataKey="cancelled"
                    name={String(currentYear)}
                    stroke="hsl(0, 75%, 50%)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  {data.prior_years.map((py, i) => (
                    <Line
                      key={py.year}
                      type="monotone"
                      dataKey={`cancelled_${py.year}`}
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
          ) : (
            /* Fallback to weekly chart when daily data is not yet populated */
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
                  value: 'Cumulative Cancelled',
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
                  const isPartial = row?.['is_partial'] as boolean
                  const daysInWeek = row?.['days_in_week'] as number
                  return (
                    <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
                      <p className="text-foreground mb-1 font-medium">{displayLabel}</p>
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

              {/* Phase marker vertical lines (weekly fallback) */}
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
                  <Line
                    type="monotone"
                    dataKey="cancelled_boys"
                    name={`Boys ${currentYear}`}
                    stroke={GENDER_COLORS.boys}
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cancelled_girls"
                    name={`Girls ${currentYear}`}
                    stroke={GENDER_COLORS.girls}
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  {controls.selectedPriorYears.slice(0, 1).map((year) => (
                    <Fragment key={year}>
                      <Line
                        type="monotone"
                        dataKey={`cancelled_boys_${year}`}
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
                        dataKey={`cancelled_girls_${year}`}
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
                  <Line
                    type="monotone"
                    dataKey="cancelled"
                    name={String(currentYear)}
                    stroke="hsl(0, 75%, 50%)"
                    strokeWidth={3}
                    dot={<PartialWeekDot />}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  {data.prior_years.map((py, i) => (
                    <Line
                      key={py.year}
                      type="monotone"
                      dataKey={`cancelled_${py.year}`}
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

      {/* Per-Session Cancellation Breakdown */}
      {chartData.sortedBySession.length > 1 && (
        <div className="card-lodge p-4">
          <h3 className="text-foreground mb-4 text-base font-semibold">Cancellations by Session</h3>
          <SessionBreakdownTable
            sortedBySession={chartData.sortedBySession}
            priorSessionMap={chartData.priorSessionMap}
            columns={sessionColumns}
          />
        </div>
      )}

      {/* Week-over-Week Cancellation Delta Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">
            Week-over-Week Cancellation Changes
          </h3>
        </div>
        <WeeklyDeltaTable
          weeks={data.combined.weekly}
          priorWeekMap={chartData.priorWeekMap}
          columns={deltaColumns}
        />
      </div>
    </div>
  )
}
