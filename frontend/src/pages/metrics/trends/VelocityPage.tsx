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

import { csvFilename } from '../../../components/metrics/exportFilename'
import { formatCount, formatSignedCount } from '../../../utils/numberFormat'
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
  todayWeekNumber,
  buildLegendLabels,
} from '../../../components/velocity'
import type { WeeklyDataPoint } from '../../../types/velocity'
import { DefinitionNotes, DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import {
  PRIORITY_DAY_NOTE,
  PRIORITY_DAY_NOTES,
  PRIORITY_DAY_PENDING,
  PRIORITY_DAY_PENDING_CLASS,
  isPriorityDayOffset,
  readsThroughNextDay,
} from '../../../utils/priorityDay'
import { PHASE_COLORS } from './phaseColors'
import { describeVelocityBases } from '../../../components/velocity/velocityBases'
import type { DefinitionNote } from '../../../components/camperships/kit/DefinitionNotes'
import { isQuestSession, isTeenProgram } from '../../../utils/sessionTypePredicates'
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
import { genderNote } from '../../../components/metrics/genderNotes'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'
import { DELTA_INK, deltaInk } from '../../../utils/deltaTokens'

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

function deltaColorClass(value: number | null): string {
  return deltaInk(value ?? 0, 'up-good')
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

  const { data, isLoading, error, refetch, isPlaceholderData } = useVelocity(currentYear, {
    sessionCmId: selectedSessionCmId,
    compareYears: controls.selectedPriorYears,
    sessionTypes: sessionTypesParam,
    splitByGender: controls.splitByGender,
    genderBasis: controls.genderBasis,
    duration: durationParam,
  })

  const chartData = useVelocityChartData(data, sessions, {
    metric: 'enrollment',
    splitByGender: controls.splitByGender,
    selectedPriorYears: controls.selectedPriorYears,
  })
  const { phaseLines, comparisonYear } = chartData

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

    // One comparison year for every card (#3209). The backend omits a prior year that has no
    // matching session; the label still names the most recent year the user ticked, and the
    // values stay '—'.
    const priorYear: number | null =
      comparisonYear ??
      (controls.selectedPriorYears.length ? Math.max(...controls.selectedPriorYears) : null)
    const py = data.prior_years.find((p) => p.year === comparisonYear)
    // Same registration day as the current year's latest point, not the whole prior week
    const priorAtWeek = py?.at_current_point ?? null
    const priorFinal = py?.weekly.at(-1)?.enrolled ?? null

    const delta = vsPriorSamePoint(currentEnrolled, priorAtWeek)

    const cancelledToDate = data.cancelled_to_date
    const priorCancelled = data.prior_year_cancelled_to_date.find((c) => c.year === priorYear)

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
  }, [data, comparisonYear, controls.selectedPriorYears])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading velocity data...</span>
      </div>
    )
  }

  if (error) {
    return <MetricsLoadError label="velocity" error={error} onRetry={() => void refetch()} />
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
  // #2898 answer #78: Boys / Girls on the Gender field, one line and column per identity group on identity,
  // as the response was built (never ahead of it while a new basis loads).
  const genderSeries = velocityGenderSeries(data)
  const genderBasis = data.gender_basis ?? 'field'
  const fallbackSeasons = velocityFallbackSeasons(data)

  const hasPriorYear = controls.selectedPriorYears.length > 0
  // Headers name the comparison year (#3209 row 20)
  const priorLabel = summaryCards?.priorYear != null ? String(summaryCards.priorYear) : null
  const todayDayOffset = data.today_day_offset ?? null
  // On a priority, early or open date the prior year is read through the next day (decision 45): say so.
  const priorityDayMark = readsThroughNextDay(data.current_day_offset, data.prior_day_offset) ? (
    <DefRef n={1} title={PRIORITY_DAY_NOTE} />
  ) : null
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

  // Legend totals for the combined lines, in the line's own mode (gross or net)
  const latestWeek = data.combined.weekly.at(-1)
  const legendLabels = buildLegendLabels({
    currentYear,
    currentValue: viewMode === 'gross' ? latestWeek?.gross_enrolled : latestWeek?.enrolled,
    currentWeekNumber: latestWeek?.week_number,
    isLive: todayDayOffset != null,
    priors: data.prior_years.map((py) => {
      const last = py.weekly.at(-1)
      return { year: py.year, final: viewMode === 'gross' ? last?.gross_enrolled : last?.enrolled }
    }),
  })

  // K13 (#3207): the lines can be built two ways, the count stored each night or rebuilt from
  // registration dates. Label them with a numbered note (never hover text), driven per point
  // from data_source, and only when the lines on screen do not share one basis.
  const sessionById = new Map(sessions.map((s) => [s.cm_id, s]))
  const bases = hasPriorYear
    ? describeVelocityBases({
        lines: [
          { year: currentYear, points: data.combined.daily },
          ...data.prior_years.map((py) => ({ year: py.year, points: py.daily })),
        ],
        snapshotsStart: data.snapshots_start ?? null,
        // Snapshots cover main, embedded and All-Gender sessions only
        includesRebuiltPrograms: data.by_session.some((curve) => {
          const session = curve.session_cm_id != null ? sessionById.get(curve.session_cm_id) : null
          return session != null && (isQuestSession(session) || isTeenProgram(session))
        }),
      })
    : null
  const priorityDayNotes = summaryCards && priorityDayMark ? PRIORITY_DAY_NOTES : []
  const basesNoteN = priorityDayNotes.length + 1
  const basesMark = bases ? <DefRef n={basesNoteN} /> : null
  if (bases) {
    const sup = String(basesNoteN).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)] ?? d)
    for (const year of bases.years) {
      legendLabels[String(year)] = `${legendLabels[String(year)] ?? year}${sup}`
    }
  }
  // Ruling 58: on gender identity, campers with no answer count by the Gender field; say how many (never at 0).
  const genderNoteN =
    controls.splitByGender &&
    genderBasis === 'identity' &&
    fallbackSeasons.some((season) => season.count > 0)
      ? priorityDayNotes.length + (bases ? 1 : 0) + 1
      : undefined
  const pageNotes: readonly DefinitionNote[] = [
    ...priorityDayNotes,
    ...(bases ? [{ n: basesNoteN, text: bases.text }] : []),
    ...(genderNoteN !== undefined ? [genderNote(genderNoteN, fallbackSeasons)] : []),
  ]

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
      header: controls.splitByGender ? 'Total' : 'Latest Enrolled',
      value: (session) => session.weekly.at(-1)?.enrolled ?? 0,
      accessor: (session) => {
        const lastPoint = session.weekly.at(-1)
        return formatCount(lastPoint?.enrolled ?? 0)
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
              // A session the comparison year has no match for is new, not missing data
              if (!priorSession && comparisonYear != null) {
                return <span className={MUTED_PILL_CLASS}>new</span>
              }
              // Same point last year, not last year's final (#3209 row 19)
              const vsPrior = vsPriorSamePoint(
                session.weekly.at(-1)?.enrolled,
                priorSession?.enrolled_at_current_week
              )
              if (deltaPending && vsPrior != null) {
                return <span className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</span>
              }
              return (
                <span className={deltaColorClass(vsPrior)}>
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

  // Column definitions for weekly delta table
  const deltaColumns: DeltaColumnDef[] = [
    {
      header: 'New',
      value: (week) => week.weekly_new,
      accessor: (week) => (
        <span className={DELTA_INK.good}>{formatSignedCount(week.weekly_new)}</span>
      ),
      className: 'text-right',
    },
    {
      header: 'Cancelled',
      value: (week) => week.weekly_cancelled,
      accessor: (week) => (
        <span className="text-red-600 dark:text-red-400">{formatCount(week.weekly_cancelled)}</span>
      ),
      className: 'text-right',
    },
    {
      header: 'Net Change',
      value: (week) => week.delta,
      accessor: (week) => (
        <span className={deltaColorClass(week.delta)}>{formatSignedCount(week.delta)}</span>
      ),
      className: 'text-right',
    },
    {
      header: 'Net Cumulative',
      value: (week) => week.enrolled,
      accessor: (week) => <span className="text-foreground">{formatCount(week.enrolled)}</span>,
      className: 'text-right',
    },
    {
      header: 'Gross Cumulative',
      value: (week) => week.gross_enrolled,
      accessor: (week) => (
        <span className="text-foreground">{formatCount(week.gross_enrolled)}</span>
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
              <span className={deltaColorClass(priorPoint?.delta ?? null)}>
                {priorPoint ? formatSignedCount(priorPoint.delta) : '—'}
              </span>
            ),
            className: 'text-right',
          } satisfies DeltaColumnDef,
        ]
      : []),
  ]

  return (
    <MetricsBusy busy={isPlaceholderData} what={String(currentYear)}>
      <div className="space-y-6">
        {/* Controls */}
        <div data-tour="velocity-controls" data-app-chrome>
          <VelocityControls
            priorYearOptions={controls.priorYearOptions}
            selectedPriorYears={controls.selectedPriorYears}
            splitByGender={controls.splitByGender}
            onTogglePriorYear={controls.togglePriorYear}
            onToggleGender={controls.handleGenderToggle}
            genderBasis={controls.genderBasis}
            onGenderBasisChange={controls.setGenderBasis}
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
                {formatCount(summaryCards.currentEnrolled)}
              </p>
              <p className="text-muted-foreground text-xs">camper-sessions</p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">
                {summaryCards.priorYear} at Wk {summaryCards.currentWeekNumber}
                {priorityDayMark}
                {basesMark}
              </p>
              <p className="text-foreground text-xl font-bold">
                {formatCount(summaryCards.priorAtWeek)}
              </p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">
                vs {summaryCards.priorYear}
                {basesMark}
              </p>
              <p className={`text-xl font-bold ${deltaColorClass(summaryCards.delta)}`}>
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
                {summaryCards.priorYear} Final
              </p>
              <p className="text-foreground text-xl font-bold">
                {formatCount(summaryCards.priorFinal)}
              </p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">Cancelled to Date</p>
              <p className="text-foreground text-xl font-bold">
                {formatCount(summaryCards.cancelledToDate)}
              </p>
            </div>
            <div className="card-lodge p-3">
              <p className="text-muted-foreground text-xs font-medium">
                {summaryCards.priorYear} Cancelled at Wk {summaryCards.currentWeekNumber}
                {priorityDayMark}
              </p>
              <p className="text-foreground text-xl font-bold">
                {formatCount(summaryCards.priorCancelledAtWeek)}
              </p>
            </div>
          </div>
        )}

        {pageNotes.length > 0 && <DefinitionNotes notes={pageNotes} />}

        {/* Enrollment Velocity Chart */}
        <div data-tour="velocity-chart" className="card-lodge p-4">
          <h3 className="text-foreground mb-2 text-base font-semibold">
            {VIEW_MODE_LABELS[viewMode]} Enrollment - {currentYear}
            {genderNoteN !== undefined && <DefRef n={genderNoteN} />}
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
                        backgroundColor:
                          PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))',
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
                <div data-app-chrome className="mb-3 flex flex-wrap items-center gap-3 text-sm">
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
                <div data-app-chrome className="mb-3 flex flex-wrap items-center gap-3 text-sm">
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
                  tickFormatter={(v: number) => formatCount(v)}
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
                          <p className="text-muted-foreground mb-1 text-xs">
                            {weekStart as string}
                          </p>
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
                <Legend />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
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
                    {/* Gender split delta: new and cancelled lines per gender (#78) */}
                    {genderSeries.map((series) => (
                      <Fragment key={series.key}>
                        <Line
                          type="monotone"
                          dataKey={`weekly_new_${series.key}`}
                          name={`New ${series.label} ${currentYear}`}
                          stroke={series.color}
                          strokeWidth={3}
                          dot={<PartialWeekDot />}
                          activeDot={{ r: 5 }}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey={`weekly_cancelled_${series.key}`}
                          name={`Cancelled ${series.label} ${currentYear}`}
                          stroke={series.color}
                          strokeWidth={2}
                          strokeDasharray="6 3"
                          dot={<PartialWeekDot />}
                          activeDot={{ r: 5 }}
                          connectNulls={false}
                        />
                      </Fragment>
                    ))}
                    {/* Prior year gender delta (first prior year only) */}
                    {controls.selectedPriorYears.slice(0, 1).map((year) =>
                      genderSeries.map((series) => (
                        <Fragment key={`${year}-${series.key}`}>
                          <Line
                            type="monotone"
                            dataKey={`weekly_new_${series.key}_${year}`}
                            name={`New ${series.label} ${year}`}
                            stroke={series.color}
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={false}
                            opacity={0.5}
                            connectNulls={false}
                          />
                          <Line
                            type="monotone"
                            dataKey={`weekly_cancelled_${series.key}_${year}`}
                            name={`Cancelled ${series.label} ${year}`}
                            stroke={series.color}
                            strokeWidth={1}
                            strokeDasharray="6 3"
                            dot={false}
                            opacity={0.5}
                            connectNulls={false}
                          />
                        </Fragment>
                      ))
                    )}
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
                  tickFormatter={(v: number) => formatCount(v)}
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
                <Legend
                  {...(controls.splitByGender
                    ? {}
                    : { formatter: (value: string) => legendLabels[value] ?? value })}
                />
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
                    {/* Gender split: one line per gender (#78); Another identity dashed */}
                    {genderSeries.map((series) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={
                          viewMode === 'gross'
                            ? `gross_enrolled_${series.key}`
                            : `enrolled_${series.key}`
                        }
                        name={`${series.label} ${currentYear}`}
                        stroke={series.color}
                        strokeWidth={3}
                        {...(series.dashed ? { strokeDasharray: '2 3' } : {})}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                    ))}
                    {/* Prior year gender lines (dashed) */}
                    {controls.selectedPriorYears
                      .slice(0, 1)
                      .map((year) =>
                        genderSeries.map((series) => (
                          <Line
                            key={`${year}-${series.key}`}
                            type="monotone"
                            dataKey={
                              viewMode === 'gross'
                                ? `gross_enrolled_${series.key}_${year}`
                                : `enrolled_${series.key}_${year}`
                            }
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
          {controls.splitByGender && (
            <VelocityGenderNotes
              basis={genderBasis}
              metric="enrollment"
              noteN={genderNoteN}
              seasons={fallbackSeasons}
            />
          )}
        </div>

        {/* Per-Session Breakdown */}
        {chartData.sortedBySession.length > 1 && (
          <div className="card-lodge p-4">
            <h3 className="text-foreground mb-4 text-base font-semibold">By Session</h3>
            <SessionBreakdownTable
              sortedBySession={chartData.sortedBySession}
              priorSessionMap={chartData.priorSessionMap}
              columns={sessionColumns}
              exportFile={csvFilename(currentYear, 'Trends velocity by session')}
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
            exportFile={csvFilename(currentYear, 'Trends velocity weekly')}
            phaseByWeek={phaseByWeek}
          />
        </div>
      </div>
    </MetricsBusy>
  )
}
