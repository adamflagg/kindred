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

import { csvFilename } from '../../../components/metrics/exportFilename'
import { formatCount, formatPercent, formatSignedCount } from '../../../utils/numberFormat'
import { useMemo } from 'react'
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
import { Loader2 } from 'lucide-react'
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
  MUTED_PILL_CLASS,
  vsPriorSamePoint,
  formatHistoryStart,
  todayWeekNumber,
  buildLegendLabels,
} from '../../../components/velocity'
import type { WeeklyDataPoint } from '../../../types/velocity'
import {
  DefinitionNotes,
  DefRef,
  type DefinitionNote,
} from '../../../components/camperships/kit/DefinitionNotes'
import {
  PRIORITY_DAY_NOTE,
  PRIORITY_DAY_NOTES,
  PRIORITY_DAY_PENDING,
  PRIORITY_DAY_PENDING_CLASS,
  isPriorityDayOffset,
  readsThroughNextDay,
} from '../../../utils/priorityDay'
import { PHASE_COLORS } from './phaseColors'
import {
  PRIOR_YEAR_COLORS,
  formatDateShort,
  priorYearDailyDateLabel,
} from '../../../utils/chartFormatters'
import PartialWeekDot from './PartialWeekDot'
import {
  sessionGenderCount,
  velocityFallbackSeasons,
  velocityGenderSeries,
} from '../../../components/velocity/velocityGenderSeries'
import { VelocityGenderNotes } from '../../../components/velocity/VelocityGenderNotes'
import { historyGapNotes } from '../../../components/velocity/velocityHistoryGap'
import { LINE, genderNote } from '../../../components/metrics/genderNotes'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'
import { deltaInk } from '../../../utils/deltaTokens'

/** Inverted delta color: more cancellations = red (bad), fewer = green (good). */
function invertedDeltaColorClass(value: number | null): string {
  return deltaInk(value ?? 0, 'up-bad')
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

  const { data, isLoading, error, refetch, isPlaceholderData } = useVelocity(currentYear, {
    sessionCmId: selectedSessionCmId,
    compareYears: controls.selectedPriorYears,
    sessionTypes: sessionTypesParam,
    splitByGender: controls.splitByGender,
    genderBasis: controls.genderBasis,
    metric: 'cancellation',
    duration: durationParam,
  })

  const chartData = useVelocityChartData(data, sessions, {
    metric: 'cancellation',
    splitByGender: controls.splitByGender,
    selectedPriorYears: controls.selectedPriorYears,
  })
  const { comparisonYear } = chartData

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

    // One comparison year for every card (#3209). The backend omits a prior year that has no
    // matching session (or no status history); the label still names the most recent year the
    // user ticked, and the values stay '—'.
    const priorYear: number | null =
      comparisonYear ??
      (controls.selectedPriorYears.length ? Math.max(...controls.selectedPriorYears) : null)
    const priorCancelledSummary = data.prior_year_cancelled_to_date.find(
      (c) => c.year === priorYear
    )

    // No fallback to the curve (#3209 row 22): a year with no status history reads '—', not 0.
    const priorAtWeek = priorCancelledSummary?.cancelled_at_current_week ?? null
    const priorFinal = priorCancelledSummary?.cancelled_final ?? null
    const delta = vsPriorSamePoint(currentCancelled, priorAtWeek)

    return {
      currentCancelled,
      currentWeekNumber: currentMaxWeek,
      priorAtWeek,
      priorFinal,
      priorYear,
      delta,
      noHistory: priorCancelledSummary?.has_cancellation_data === false,
    }
  }, [data, comparisonYear, controls.selectedPriorYears])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading cancellation data...</span>
      </div>
    )
  }

  if (error) {
    return <MetricsLoadError label="cancellation" error={error} onRetry={() => void refetch()} />
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
  // #2898 answer #78: Boys / Girls on the Gender field, one line and column per identity group on identity,
  // as the response was built (never ahead of it while a new basis loads).
  const genderSeries = velocityGenderSeries(data)
  const genderBasis = data.gender_basis ?? 'field'
  const fallbackSeasons = velocityFallbackSeasons(data)

  const hasPriorYear = controls.selectedPriorYears.length > 0
  // Headers name the comparison year (#3209 row 20)
  const priorLabel = summaryCards?.priorYear != null ? String(summaryCards.priorYear) : null
  const historyStart = formatHistoryStart(data.status_history_start)
  const todayDayOffset = data.today_day_offset ?? null
  // On a priority, early or open date the prior year is read through the next day (decision 45): say so.
  const priorityDayMark = readsThroughNextDay(data.current_day_offset, data.prior_day_offset) ? (
    <DefRef n={1} title={PRIORITY_DAY_NOTE} />
  ) : null
  const priorityDayNotes = summaryCards && hasPriorYear && priorityDayMark ? PRIORITY_DAY_NOTES : []
  // Ruling 58: on gender identity, campers with no answer count by the Gender field; say how many (never at 0).
  const genderNoteN =
    controls.splitByGender &&
    genderBasis === 'identity' &&
    fallbackSeasons.some((season) => season.count > 0)
      ? priorityDayNotes.length + 1
      : undefined
  const pageNotes: readonly DefinitionNote[] = [
    ...priorityDayNotes,
    ...(genderNoteN !== undefined ? [genderNote(genderNoteN, fallbackSeasons)] : []),
  ]
  // Gender lines come from status history; campers already cancelled when the dashboard first saw them are in the
  // total only. The server counts them per season (gender_history_gaps); numbered after the page's own notes.
  const historyGap = controls.splitByGender
    ? historyGapNotes(data.gender_history_gaps, pageNotes.length + 1)
    : { notes: [], noHistory: [] }
  // Ruling 9: only the priority date itself waits a day for this year's data.
  const deltaPending = isPriorityDayOffset(data.current_day_offset)
  const todayLine = (x: number) => (
    <ReferenceLine
      x={x}
      stroke="hsl(var(--muted-foreground))"
      strokeDasharray="2 3"
      label={{
        value: 'TODAY',
        position: 'top',
        fill: 'hsl(var(--muted-foreground))',
        fontSize: 10,
      }}
    />
  )

  // Legend totals for the combined lines: cumulative cancelled
  const latestWeek = data.combined.weekly.at(-1)
  const legendLabels = buildLegendLabels({
    currentYear,
    currentValue: latestWeek?.enrolled,
    currentWeekNumber: latestWeek?.week_number,
    isLive: todayDayOffset != null,
    priors: data.prior_years.map((py) => ({ year: py.year, final: py.weekly.at(-1)?.enrolled })),
  })
  const legendProps = controls.splitByGender
    ? {}
    : { formatter: (value: string) => legendLabels[value] ?? value }

  // Column definitions for session breakdown table (cancellation-specific)
  const sessionColumns: SessionColumnDef[] = [
    {
      header: 'Session',
      value: (session) => session.session_name ?? `Session ${String(session.session_cm_id)}`,
      accessor: (session) => session.session_name ?? `Session ${session.session_cm_id}`,
      className: 'text-left',
    },
    ...(controls.splitByGender
      ? genderSeries.map(
          (series) =>
            ({
              header: series.label,
              value: (session) =>
                sessionGenderCount(
                  session.session_cm_id ? genderBreakdownMap.get(session.session_cm_id) : undefined,
                  series
                ) ?? null,
              accessor: (session) => (
                <span style={{ color: series.color }}>
                  {formatCount(
                    sessionGenderCount(
                      session.session_cm_id
                        ? genderBreakdownMap.get(session.session_cm_id)
                        : undefined,
                      series
                    )
                  )}
                </span>
              ),
              className: 'text-right',
            }) satisfies SessionColumnDef
        )
      : []),
    {
      header: controls.splitByGender ? 'Total' : 'Total Cancelled',
      value: (session) => session.weekly.at(-1)?.enrolled ?? 0,
      accessor: (session) => {
        const lastPoint = session.weekly.at(-1)
        return (
          <span className="text-red-600 dark:text-red-400">
            {formatCount(lastPoint?.enrolled ?? 0)}
          </span>
        )
      },
      className: 'text-right',
    },
    ...(hasPriorYear
      ? [
          {
            header: `${priorLabel ?? 'Prior Yr'}${summaryCards ? ` (Wk ${summaryCards.currentWeekNumber})` : ''}`,
            value: (_session, priorSession) => priorSession?.enrolled_at_current_week ?? null,
            accessor: (_session, priorSession) => (
              <span className="text-muted-foreground">
                {formatCount(priorSession?.enrolled_at_current_week)}
              </span>
            ),
            className: 'text-right',
          } satisfies SessionColumnDef,
          {
            header: `${priorLabel ?? 'Prior Yr'} Final`,
            value: (_session, priorSession) => priorSession?.final_enrolled ?? null,
            accessor: (_session, priorSession) => (
              <span className="text-muted-foreground">
                {formatCount(priorSession?.final_enrolled)}
              </span>
            ),
            className: 'text-right',
          } satisfies SessionColumnDef,
          {
            header: priorLabel ? `vs ${priorLabel}` : 'vs Prior',
            // A pending cell reads "updates tomorrow": blank in the CSV, and it sorts with the blanks.
            value: (session, priorSession) =>
              deltaPending
                ? null
                : (vsPriorSamePoint(
                    session.weekly.at(-1)?.enrolled,
                    priorSession?.enrolled_at_current_week
                  ) ?? null),
            accessor: (session, priorSession) => {
              // A session the comparison year has no match for is new, not missing data. A year
              // with no status history has no sessions to match, so its rows read '—' (ruling 6).
              if (!priorSession && comparisonYear != null && !summaryCards?.noHistory) {
                return <span className={MUTED_PILL_CLASS}>new</span>
              }
              // Same point last year, not last year's final (#3209 row 19).
              // Inverted: positive vsPrior = more cancellations = bad
              const vsPrior = vsPriorSamePoint(
                session.weekly.at(-1)?.enrolled,
                priorSession?.enrolled_at_current_week
              )
              if (deltaPending && vsPrior != null) {
                return <span className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</span>
              }
              return (
                <span className={invertedDeltaColorClass(vsPrior)}>
                  {vsPrior != null ? formatSignedCount(vsPrior) : '—'}
                </span>
              )
            },
            className: 'text-right',
          } satisfies SessionColumnDef,
        ]
      : []),
    {
      header: 'Weeks Tracked',
      value: (session) => session.weekly.length,
      accessor: (session) => <span className="text-muted-foreground">{session.weekly.length}</span>,
      className: 'text-right',
    },
  ]

  // Column definitions for weekly delta table (cancellation-specific: simpler columns)
  const deltaColumns: DeltaColumnDef[] = [
    {
      header: 'Change',
      value: (week) => week.delta,
      accessor: (week) => (
        <span className={invertedDeltaColorClass(week.delta)}>{formatSignedCount(week.delta)}</span>
      ),
      className: 'text-right',
    },
    {
      header: 'Cumulative',
      value: (week) => week.enrolled,
      accessor: (week) => (
        <span className="text-red-600 dark:text-red-400">{formatCount(week.enrolled)}</span>
      ),
      className: 'text-right',
    },
    ...(hasPriorYear && chartData.priorWeekMap
      ? [
          {
            header: priorLabel ?? 'Prior Year',
            value: (_week: WeeklyDataPoint, priorPoint?: WeeklyDataPoint) =>
              priorPoint?.enrolled ?? null,
            accessor: (_week: WeeklyDataPoint, priorPoint?: WeeklyDataPoint) => (
              <span className="text-muted-foreground">{formatCount(priorPoint?.enrolled)}</span>
            ),
            className: 'text-right',
          } satisfies DeltaColumnDef,
          {
            header: priorLabel ? `${priorLabel} Delta` : 'Prior Delta',
            value: (_week: WeeklyDataPoint, priorPoint?: WeeklyDataPoint) =>
              priorPoint?.delta ?? null,
            accessor: (_week: WeeklyDataPoint, priorPoint?: WeeklyDataPoint) => (
              <span className="text-muted-foreground">
                {priorPoint ? formatSignedCount(priorPoint.delta) : '—'}
              </span>
            ),
            className: 'text-right',
          } satisfies DeltaColumnDef,
        ]
      : []),
    {
      header: 'Source',
      value: (week) => week.data_source,
      accessor: (week) => (
        <span className="text-muted-foreground text-xs capitalize">{week.data_source}</span>
      ),
      className: 'text-right',
    },
  ]

  // Use daily chart if available, otherwise fall back to weekly
  const useDailyChart = chartData.dailyChartData.length > 0

  return (
    <MetricsBusy busy={isPlaceholderData} what={String(currentYear)}>
      <div className="space-y-6">
        {/* Controls — no extraControls (no viewMode toggle for cancellation) */}
        <div data-tour="cancel-velocity-controls" data-app-chrome>
          <VelocityControls
            priorYearOptions={controls.priorYearOptions}
            selectedPriorYears={controls.selectedPriorYears}
            splitByGender={controls.splitByGender}
            onTogglePriorYear={controls.togglePriorYear}
            onToggleGender={controls.handleGenderToggle}
            genderBasis={controls.genderBasis}
            onGenderBasisChange={controls.setGenderBasis}
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
                {formatCount(summaryCards.currentCancelled)}
              </p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">
                {summaryCards.priorYear} at Wk {summaryCards.currentWeekNumber}
                {priorityDayMark}
              </p>
              <p className="text-foreground text-xl font-bold">
                {formatCount(summaryCards.priorAtWeek)}
              </p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">
                vs {summaryCards.priorYear}
              </p>
              <p className={`text-xl font-bold ${invertedDeltaColorClass(summaryCards.delta)}`}>
                {deltaPending && summaryCards.delta != null ? (
                  <span className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</span>
                ) : summaryCards.delta != null ? (
                  formatSignedCount(summaryCards.delta)
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">
                {summaryCards.priorYear} Final Cancelled
              </p>
              <p className="text-foreground text-xl font-bold">
                {formatCount(summaryCards.priorFinal)}
                {summaryCards.noHistory && (
                  <span className={`${MUTED_PILL_CLASS} align-middle`}>
                    {historyStart ? `no history before ${historyStart}` : 'no history'}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {pageNotes.length > 0 && <DefinitionNotes notes={pageNotes} />}

        {/* Session Swap Annotation */}
        {data.session_swap_count != null &&
          data.session_swap_count > 0 &&
          data.cancelled_to_date != null &&
          data.cancelled_to_date > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {formatCount(data.session_swap_count)} of {formatCount(data.cancelled_to_date)}{' '}
                cancellations (
                {formatPercent((data.session_swap_count / data.cancelled_to_date) * 100)}) are
                session swaps
              </span>
              <span className="text-muted-foreground">
                {' '}
                — cancelled one session but are still enrolled in another this summer
              </span>
            </div>
          )}

        {/* Cancellation Velocity Chart */}
        <div data-tour="cancel-velocity-chart" className="card-lodge p-4">
          <h3 className="text-foreground mb-2 text-base font-semibold">
            Cancellation Velocity - {currentYear}
            {genderNoteN !== undefined && <DefRef n={genderNoteN} />}
            {historyGap.notes.map((note) => (
              <DefRef key={note.n} n={note.n} />
            ))}
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
                <div data-app-chrome className="mb-3 flex flex-wrap items-center gap-3 text-sm">
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
                <div data-app-chrome className="mb-3 flex flex-wrap items-center gap-3 text-sm">
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
                  tickFormatter={(v: number) => formatCount(v)}
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
                              {entry.name}: {formatCount(Number(entry.value))}
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
                <Legend {...legendProps} />
                {todayDayOffset != null && todayLine(todayDayOffset)}

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
                    {/* One line per gender (#78); Another identity dashed */}
                    {genderSeries.map((series) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={`cancelled_${series.key}`}
                        name={`${series.label} ${currentYear}`}
                        stroke={series.color}
                        strokeWidth={3}
                        {...(series.dashed ? { strokeDasharray: '2 3' } : {})}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                    ))}
                    {controls.selectedPriorYears
                      .slice(0, 1)
                      .map((year) =>
                        genderSeries.map((series) => (
                          <Line
                            key={`${year}-${series.key}`}
                            type="monotone"
                            dataKey={`cancelled_${series.key}_${year}`}
                            name={`${series.label} ${year}`}
                            stroke={series.color}
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={false}
                            opacity={0.6}
                            connectNulls={false}
                          />
                        ))
                      )}
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
                  tickFormatter={(v: number) => formatCount(v)}
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
                              {entry.name}: {formatCount(Number(entry.value))}
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
                <Legend {...legendProps} />
                {todayDayOffset != null && todayLine(todayWeekNumber(todayDayOffset))}

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
                    {/* One line per gender (#78); Another identity dashed */}
                    {genderSeries.map((series) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={`cancelled_${series.key}`}
                        name={`${series.label} ${currentYear}`}
                        stroke={series.color}
                        strokeWidth={3}
                        {...(series.dashed ? { strokeDasharray: '2 3' } : {})}
                        dot={<PartialWeekDot />}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                    ))}
                    {controls.selectedPriorYears
                      .slice(0, 1)
                      .map((year) =>
                        genderSeries.map((series) => (
                          <Line
                            key={`${year}-${series.key}`}
                            type="monotone"
                            dataKey={`cancelled_${series.key}_${year}`}
                            name={`${series.label} ${year}`}
                            stroke={series.color}
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={false}
                            opacity={0.6}
                            connectNulls={false}
                          />
                        ))
                      )}
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
          {controls.splitByGender && (
            <VelocityGenderNotes
              basis={genderBasis}
              metric="cancellation"
              noteN={genderNoteN}
              seasons={fallbackSeasons}
            />
          )}
          {historyGap.noHistory.map((line) => (
            <p key={line} className={LINE}>
              {line}
            </p>
          ))}
          <DefinitionNotes notes={historyGap.notes} />
        </div>

        {/* Per-Session Cancellation Breakdown */}
        {chartData.sortedBySession.length > 1 && (
          <div className="card-lodge p-4">
            <h3 className="text-foreground mb-4 text-base font-semibold">
              Cancellations by Session
            </h3>
            <SessionBreakdownTable
              sortedBySession={chartData.sortedBySession}
              priorSessionMap={chartData.priorSessionMap}
              columns={sessionColumns}
              exportFile={csvFilename(currentYear, 'Trends cancellation velocity by session')}
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
            exportFile={csvFilename(currentYear, 'Trends cancellation velocity weekly')}
          />
        </div>
      </div>
    </MetricsBusy>
  )
}
