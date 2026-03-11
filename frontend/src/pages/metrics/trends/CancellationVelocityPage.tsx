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
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import type { WeeklyDataPoint } from '../../../types/velocity'
import { resolveSessionAlias } from '../../../utils/sessionAliases'
import {
  sortSessionDataByCampThenQuest,
  buildSessionDateLookup,
  buildSessionTypeLookup,
} from '../../../utils/sessionUtils'
import { PHASE_COLORS } from './phaseColors'

const PRIOR_YEAR_COLORS = [
  'hsl(220, 60%, 65%)',
  'hsl(280, 50%, 60%)',
  'hsl(35, 70%, 55%)',
  'hsl(340, 55%, 60%)',
  'hsl(180, 50%, 45%)',
]

const GENDER_COLORS = {
  boys: 'hsl(210, 70%, 55%)',
  girls: 'hsl(340, 65%, 55%)',
}

/** Custom dot renderer that shows a hollow dashed circle on partial week data points. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PartialWeekDot(props: any) {
  const { cx, cy, payload, stroke } = props
  if (!payload?.is_partial) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="white"
      stroke={stroke}
      strokeWidth={2}
      strokeDasharray="3 3"
    />
  )
}

/** Format a date string (YYYY-MM-DD) to short display. */
function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Compute the calendar date for a prior year at a given day offset from its season start. */
function priorYearDailyDateLabel(
  seasonStarts: Record<number, string> | undefined,
  year: number,
  dayOffset: number
): string | null {
  const seasonStart = seasonStarts?.[year]
  if (!seasonStart) return null
  const d = new Date(seasonStart + 'T00:00:00')
  d.setDate(d.getDate() + dayOffset)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CancellationVelocityPage() {
  const { selectedSessionCmId, sessionTypesParam, sessions, durationParam } = useMetricsSession()
  const { currentYear, availableYears } = useCurrentYear()
  const [selectedPriorYears, setSelectedPriorYears] = useState<number[]>([])
  const [splitByGender, setSplitByGender] = useState(false)
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null)

  const priorYearOptions = useMemo(
    () => availableYears.filter((y) => y < currentYear).sort((a, b) => b - a),
    [availableYears, currentYear]
  )

  const { data, isLoading, error } = useVelocity(currentYear, {
    sessionCmId: selectedSessionCmId,
    compareYears: selectedPriorYears,
    sessionTypes: sessionTypesParam,
    splitByGender,
    metric: 'cancellation',
    duration: durationParam,
  })

  // Build unified chart data aligned by week_number
  const chartData = useMemo(() => {
    if (!data?.combined?.weekly?.length) return []

    const currentMap = new Map(data.combined.weekly.map((d) => [d.week_number, d]))

    const priorMaps = data.prior_years.map(
      (py) => new Map(py.weekly.map((d) => [d.week_number, d]))
    )

    const mCurve = data.by_gender?.find((c) => c.gender === 'M')
    const fCurve = data.by_gender?.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.weekly.map((d) => [d.week_number, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.weekly.map((d) => [d.week_number, d])) : new Map()

    const priorMGender = data.prior_year_by_gender?.filter((c) => c.gender === 'M') ?? []
    const priorFGender = data.prior_year_by_gender?.filter((c) => c.gender === 'F') ?? []
    const priorMGenderMaps = priorMGender.map((c) => ({
      year: c.year,
      map: new Map(c.weekly.map((d) => [d.week_number, d])),
    }))
    const priorFGenderMaps = priorFGender.map((c) => ({
      year: c.year,
      map: new Map(c.weekly.map((d) => [d.week_number, d])),
    }))

    const allWeekNumbers = new Set<number>()
    for (const wn of currentMap.keys()) allWeekNumbers.add(wn)
    for (const pm of priorMaps) {
      for (const wn of pm.keys()) allWeekNumbers.add(wn)
    }
    for (const wn of mMap.keys()) allWeekNumbers.add(wn)
    for (const wn of fMap.keys()) allWeekNumbers.add(wn)
    for (const { map } of priorMGenderMaps) {
      for (const wn of map.keys()) allWeekNumbers.add(wn)
    }
    for (const { map } of priorFGenderMaps) {
      for (const wn of map.keys()) allWeekNumbers.add(wn)
    }

    const sorted = [...allWeekNumbers].sort((a, b) => a - b)

    return sorted.map((wn) => {
      const current = currentMap.get(wn)
      let weekLabel = current?.week_label ?? ''

      if (!weekLabel) {
        for (const pm of priorMaps) {
          const pd = pm.get(wn)
          if (pd?.week_label) {
            weekLabel = pd.week_label
            break
          }
        }
      }
      if (!weekLabel) weekLabel = `Wk ${wn}`

      const row: Record<string, string | number | boolean | null> = {
        week_number: wn,
        label: weekLabel,
        week_start: current?.week_start ?? '',
        cancelled: current?.enrolled ?? null, // enrolled field repurposed for cancelled count
        delta: current?.delta ?? null,
        is_partial: current?.is_partial ?? false,
        days_in_week: current?.days_in_week ?? 7,
      }

      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(wn)
        row[`cancelled_${py.year}`] = pyPoint?.enrolled ?? null
      })

      if (splitByGender) {
        row['cancelled_boys'] = mMap.get(wn)?.enrolled ?? null
        row['cancelled_girls'] = fMap.get(wn)?.enrolled ?? null

        for (const { year, map } of priorMGenderMaps) {
          row[`cancelled_boys_${year}`] = map.get(wn)?.enrolled ?? null
        }
        for (const { year, map } of priorFGenderMaps) {
          row[`cancelled_girls_${year}`] = map.get(wn)?.enrolled ?? null
        }
      }

      return row
    })
  }, [data, splitByGender])

  const sortedBySession = useMemo(() => {
    if (!data?.by_session?.length || !sessions.length) return data?.by_session ?? []

    const dateLookup = buildSessionDateLookup(sessions)
    const typeLookup = buildSessionTypeLookup(sessions)

    const withNames = data.by_session
      .filter((s) => s.session_name != null)
      .map((s) => ({
        ...s,
        session_name: s.session_name as string,
      }))

    return sortSessionDataByCampThenQuest(withNames, dateLookup, typeLookup)
  }, [data?.by_session, sessions])

  const weekLabelMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const pt of chartData) {
      const wn = pt['week_number'] as number
      const label = pt['label'] as string
      if (label) map.set(wn, label)
    }
    return map
  }, [chartData])

  const phaseLines = useMemo(() => {
    if (!data?.phase_markers) return []
    return data.phase_markers
      .filter((marker) => marker.week_number != null)
      .map((marker) => ({
        ...marker,
        weekNumber: marker.week_number,
      }))
  }, [data?.phase_markers])

  // Build daily chart data aligned by day_offset (used for cumulative chart when available)
  const dailyChartData = useMemo(() => {
    if (!data?.daily?.length) return []

    const currentMap = new Map(data.daily.map((d) => [d.day_offset, d]))

    const priorMaps = data.prior_years.map((py) => new Map(py.daily.map((d) => [d.day_offset, d])))

    const mCurve = data.by_gender?.find((c) => c.gender === 'M')
    const fCurve = data.by_gender?.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.daily.map((d) => [d.day_offset, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.daily.map((d) => [d.day_offset, d])) : new Map()

    const priorMGender = data.prior_year_by_gender?.filter((c) => c.gender === 'M') ?? []
    const priorFGender = data.prior_year_by_gender?.filter((c) => c.gender === 'F') ?? []
    const priorMGenderMaps = priorMGender.map((c) => ({
      year: c.year,
      map: new Map(c.daily.map((d) => [d.day_offset, d])),
    }))
    const priorFGenderMaps = priorFGender.map((c) => ({
      year: c.year,
      map: new Map(c.daily.map((d) => [d.day_offset, d])),
    }))

    const allDayOffsets = new Set<number>()
    for (const offset of currentMap.keys()) allDayOffsets.add(offset)
    for (const pm of priorMaps) {
      for (const offset of pm.keys()) allDayOffsets.add(offset)
    }
    for (const offset of mMap.keys()) allDayOffsets.add(offset)
    for (const offset of fMap.keys()) allDayOffsets.add(offset)
    for (const { map } of priorMGenderMaps) {
      for (const offset of map.keys()) allDayOffsets.add(offset)
    }
    for (const { map } of priorFGenderMaps) {
      for (const offset of map.keys()) allDayOffsets.add(offset)
    }

    const sorted = [...allDayOffsets].sort((a, b) => a - b)

    return sorted.map((dayOffset) => {
      const current = currentMap.get(dayOffset)

      const row: Record<string, string | number | boolean | null> = {
        day_offset: dayOffset,
        date: current?.date ?? '',
        cancelled: current?.enrolled ?? null,
      }

      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(dayOffset)
        row[`cancelled_${py.year}`] = pyPoint?.enrolled ?? null
      })

      if (splitByGender) {
        row['cancelled_boys'] = mMap.get(dayOffset)?.enrolled_boys ?? null
        row['cancelled_girls'] = fMap.get(dayOffset)?.enrolled_girls ?? null

        for (const { year, map } of priorMGenderMaps) {
          row[`cancelled_boys_${year}`] = map.get(dayOffset)?.enrolled_boys ?? null
        }
        for (const { year, map } of priorFGenderMaps) {
          row[`cancelled_girls_${year}`] = map.get(dayOffset)?.enrolled_girls ?? null
        }
      }

      return row
    })
  }, [data, splitByGender])

  // Daily tick formatter: show date labels every 7 days
  const dailyTickFormatter = useMemo(() => {
    if (!data?.season_start) return (_offset: number) => ''
    const seasonStart = new Date(data.season_start + 'T00:00:00')
    return (offset: number) => {
      const d = new Date(seasonStart)
      d.setDate(d.getDate() + offset)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }, [data?.season_start])

  // Phase day offsets for ReferenceArea bands on daily chart
  const phaseDayOffsets = useMemo(() => {
    if (!data?.phase_markers || !data?.season_start) return []
    const sp = data.season_start.split('-')
    const seasonStartUtc = Date.UTC(Number(sp[0]), Number(sp[1]) - 1, Number(sp[2]))
    return data.phase_markers.map((marker) => {
      const mp = marker.date.split('-')
      return {
        phase: marker.phase,
        label: marker.label,
        dayOffset: Math.floor(
          (Date.UTC(Number(mp[0]), Number(mp[1]) - 1, Number(mp[2])) - seasonStartUtc) / 86400000
        ),
      }
    })
  }, [data?.phase_markers, data?.season_start])

  // Weekly milestone indices in dailyChartData for zoom dropdown (every 7th day)
  const dailyZoomMilestones = useMemo(() => {
    if (!dailyChartData.length) return []
    const milestones: Array<{ index: number; label: string }> = []
    dailyChartData.forEach((pt, i) => {
      const offset = pt['day_offset'] as number
      if (offset % 7 === 0) {
        const weekNum = Math.floor(offset / 7) + 1
        const dateStr = pt['date'] as string
        const dateLabel = dateStr ? formatDateShort(dateStr) : ''
        milestones.push({ index: i, label: `Wk ${weekNum}${dateLabel ? ` - ${dateLabel}` : ''}` })
      }
    })
    const lastIdx = dailyChartData.length - 1
    const lastMilestone = milestones[milestones.length - 1]
    if (!lastMilestone || lastMilestone.index !== lastIdx) {
      const lastPt = dailyChartData[lastIdx]
      if (lastPt) {
        const dateStr = lastPt['date'] as string
        const dateLabel = dateStr ? formatDateShort(dateStr) : ''
        milestones.push({ index: lastIdx, label: `Latest${dateLabel ? ` - ${dateLabel}` : ''}` })
      }
    }
    return milestones
  }, [dailyChartData])

  // Build prior year session summary map keyed by canonical session name
  const priorSessionMap = useMemo(() => {
    const map = new Map<
      string,
      { enrolled_at_current_week: number | null; final_enrolled: number; year: number }
    >()
    for (const summary of data?.prior_year_session_summaries ?? []) {
      if (summary.session_name) {
        const canonical = resolveSessionAlias(summary.session_name)
        map.set(canonical, {
          enrolled_at_current_week: summary.enrolled_at_current_week,
          final_enrolled: summary.final_enrolled,
          year: summary.year,
        })
      }
    }
    return map
  }, [data?.prior_year_session_summaries])

  // Prior year week map for delta table
  const priorWeekMap = useMemo(() => {
    if (!data?.prior_years?.length) return null
    const py = data.prior_years[0]
    if (!py) return null
    return new Map(py.weekly.map((d) => [d.week_number, d]))
  }, [data?.prior_years])

  // Summary card values
  const summaryCards = useMemo(() => {
    if (!data) return null
    const currentWeekly = data.combined.weekly
    if (!currentWeekly.length) return null

    const currentLatest = currentWeekly[currentWeekly.length - 1]
    if (!currentLatest) return null
    const currentCancelled = currentLatest.enrolled // repurposed for cancellation count

    let priorAtWeek: number | null = null
    let priorFinal: number | null = null
    let priorYear: number | null = null

    // Use backend cancelled_at_current_week when available (more accurate with fallback)
    const priorCancelledSummary =
      data.prior_year_cancelled_to_date?.length > 0 ? data.prior_year_cancelled_to_date[0] : null

    if (data.prior_years.length > 0) {
      const py = data.prior_years[0]
      if (py) {
        priorYear = py.year
        priorAtWeek = priorCancelledSummary?.cancelled_at_current_week ?? null
        // Fallback to manual week lookup if backend didn't provide it
        if (priorAtWeek == null) {
          const pyMap = new Map(py.weekly.map((d) => [d.week_number, d]))
          priorAtWeek = pyMap.get(currentLatest.week_number)?.enrolled ?? null
        }
        priorFinal = priorCancelledSummary?.cancelled_final ?? null
        if (priorFinal == null) {
          const pyLast = py.weekly[py.weekly.length - 1]
          priorFinal = pyLast?.enrolled ?? null
        }
      }
    }

    // Inverted delta: positive = more cancellations = bad
    const delta = priorAtWeek != null ? currentCancelled - priorAtWeek : null

    return {
      currentCancelled,
      currentWeekNumber: currentLatest.week_number,
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

  const togglePriorYear = (year: number) => {
    if (splitByGender) {
      setSelectedPriorYears((prev) => (prev.includes(year) ? [] : [year]))
    } else {
      setSelectedPriorYears((prev) =>
        prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
      )
    }
  }

  const handleGenderToggle = (enabled: boolean) => {
    setSplitByGender(enabled)
    if (enabled && selectedPriorYears.length > 1) {
      setSelectedPriorYears(selectedPriorYears.slice(0, 1))
    }
  }

  // Build gender breakdown lookup for session table
  const genderBreakdownMap = new Map(
    (data.session_gender_breakdown ?? []).map((b) => [b.session_cm_id, b])
  )

  const hasPriorYear = selectedPriorYears.length > 0

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="card-lodge p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {priorYearOptions.length > 0 && (
            <div>
              <h3 className="text-foreground mb-2 text-sm font-medium">Compare with prior years</h3>
              <div className="flex flex-wrap gap-3">
                {priorYearOptions.slice(0, 5).map((year) => {
                  const disabled =
                    splitByGender &&
                    !selectedPriorYears.includes(year) &&
                    selectedPriorYears.length >= 1
                  return (
                    <label
                      key={year}
                      className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPriorYears.includes(year)}
                        onChange={() => togglePriorYear(year)}
                        disabled={disabled}
                        className="accent-primary h-4 w-4 rounded"
                      />
                      <span className="text-foreground">{year}</span>
                    </label>
                  )
                })}
              </div>
              {splitByGender && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Limited to 1 prior year when gender split is on
                </p>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={splitByGender}
              onChange={(e) => handleGenderToggle(e.target.checked)}
              className="accent-primary h-4 w-4 rounded"
            />
            <span className="text-foreground">Split by gender</span>
          </label>
        </div>
      </div>

      {/* Summary Cards */}
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
            <p
              className={`text-xl font-bold ${
                summaryCards.delta != null && summaryCards.delta > 0
                  ? 'text-red-600 dark:text-red-400'
                  : summaryCards.delta != null && summaryCards.delta < 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-foreground'
              }`}
            >
              {summaryCards.delta != null
                ? `${summaryCards.delta > 0 ? '+' : ''}${summaryCards.delta}`
                : '-'}
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
      <div className="card-lodge p-4">
        <h3 className="text-foreground mb-2 text-base font-semibold">
          Cancellation Velocity - {currentYear}
        </h3>

        {phaseLines.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4 text-xs">
            {phaseLines.map((phase) => (
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
        {selectedPriorYears.length > 0 && (
          <p className="text-muted-foreground mb-3 text-xs italic">
            X-axis dates are for {currentYear}. Hover for prior year dates.
          </p>
        )}

        {/* Zoom range selectors */}
        {dailyChartData.length > 0
          ? dailyZoomMilestones.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="text-muted-foreground text-xs font-medium">Zoom:</label>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={zoomRange?.[0] ?? 0}
                  onChange={(e) => {
                    const start = Number(e.target.value)
                    const end = zoomRange?.[1] ?? dailyChartData.length - 1
                    setZoomRange([start, Math.max(start, end)])
                  }}
                >
                  {dailyZoomMilestones.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">to</span>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={zoomRange?.[1] ?? dailyChartData.length - 1}
                  onChange={(e) => {
                    const end = Number(e.target.value)
                    const start = zoomRange?.[0] ?? 0
                    setZoomRange([Math.min(start, end), end])
                  }}
                >
                  {dailyZoomMilestones.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {zoomRange && (
                  <button
                    className="text-primary hover:text-primary/80 text-xs underline"
                    onClick={() => setZoomRange(null)}
                  >
                    Reset
                  </button>
                )}
              </div>
            )
          : chartData.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="text-muted-foreground text-xs font-medium">Zoom:</label>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={zoomRange?.[0] ?? 0}
                  onChange={(e) => {
                    const start = Number(e.target.value)
                    const end = zoomRange?.[1] ?? chartData.length - 1
                    setZoomRange([start, Math.max(start, end)])
                  }}
                >
                  {chartData.map((pt, i) => (
                    <option key={i} value={i}>
                      Wk {pt['week_number']} - {pt['label']}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">to</span>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={zoomRange?.[1] ?? chartData.length - 1}
                  onChange={(e) => {
                    const end = Number(e.target.value)
                    const start = zoomRange?.[0] ?? 0
                    setZoomRange([Math.min(start, end), end])
                  }}
                >
                  {chartData.map((pt, i) => (
                    <option key={i} value={i}>
                      Wk {pt['week_number']} - {pt['label']}
                    </option>
                  ))}
                </select>
                {zoomRange && (
                  <button
                    className="text-primary hover:text-primary/80 text-xs underline"
                    onClick={() => setZoomRange(null)}
                  >
                    Reset
                  </button>
                )}
              </div>
            )}

        <ResponsiveContainer width="100%" height={380}>
          {dailyChartData.length > 0 ? (
            <LineChart data={dailyChartData} margin={{ top: 20, right: 30, left: 20, bottom: 35 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="day_offset"
                type="number"
                domain={['dataMin', 'dataMax']}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(offset: number) => {
                  if (offset % 7 !== 0) return ''
                  return dailyTickFormatter(offset)
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
                  if (!active || !payload?.length) return null
                  const validPayload = payload.filter((entry) => entry.value != null)
                  if (!validPayload.length) return null
                  const dayOffset = label as number
                  const row = dailyChartData.find((d) => d['day_offset'] === dayOffset)
                  const dateStr = row?.['date'] as string
                  const weekNum = Math.floor(dayOffset / 7) + 1
                  const dateLabel = dateStr
                    ? formatDateShort(dateStr)
                    : dailyTickFormatter(dayOffset)
                  return (
                    <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
                      <p className="text-foreground mb-1 font-medium">{dateLabel}</p>
                      <p className="text-muted-foreground mb-1 text-xs">
                        Day {dayOffset} (Week {weekNum})
                      </p>
                      {validPayload.map((entry) => {
                        const yearMatch = entry.name?.match(/\b(\d{4})\b/)
                        const priorDate = yearMatch
                          ? priorYearDailyDateLabel(
                              data?.prior_year_season_starts,
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

              <Brush
                dataKey="day_offset"
                height={20}
                stroke="hsl(var(--primary))"
                {...(zoomRange ? { startIndex: zoomRange[0], endIndex: zoomRange[1] } : {})}
                tickFormatter={(offset: number) => dailyTickFormatter(offset)}
              />

              {/* Phase marker bands (ReferenceArea) */}
              {phaseDayOffsets.map((phase) => (
                <ReferenceArea
                  key={phase.phase}
                  x1={phase.dayOffset}
                  x2={phase.dayOffset + 1}
                  fill={PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))'}
                  fillOpacity={0.15}
                  strokeOpacity={0}
                />
              ))}

              {splitByGender ? (
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
                  {selectedPriorYears.slice(0, 1).map((year) => (
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
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 35 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="week_number"
                type="number"
                domain={['dataMin', 'dataMax']}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(wn: number) => weekLabelMap.get(wn) ?? `Wk${wn}`}
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
                  if (!active || !payload?.length) return null
                  const validPayload = payload.filter((entry) => entry.value != null)
                  if (!validPayload.length) return null
                  const displayLabel = weekLabelMap.get(label as number) ?? `Week ${label}`
                  const row = chartData.find((d) => d['week_number'] === label)
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
                      {validPayload.map((entry) => (
                        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
                          {entry.name}: {Number(entry.value).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend />

              <Brush
                dataKey="week_number"
                height={20}
                stroke="hsl(var(--primary))"
                {...(zoomRange ? { startIndex: zoomRange[0], endIndex: zoomRange[1] } : {})}
                tickFormatter={(wn: number) => weekLabelMap.get(wn) ?? `Wk${wn}`}
              />

              {phaseLines.map((phase) => (
                <ReferenceLine
                  key={phase.phase}
                  x={phase.weekNumber}
                  stroke={PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))'}
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              ))}

              {splitByGender ? (
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
                  {selectedPriorYears.slice(0, 1).map((year) => (
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
      {sortedBySession.length > 1 && (
        <div className="card-lodge p-4">
          <h3 className="text-foreground mb-4 text-base font-semibold">Cancellations by Session</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/30 border-b">
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">Session</th>
                  {splitByGender && (
                    <>
                      <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                        Boys
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                        Girls
                      </th>
                    </>
                  )}
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    {splitByGender ? 'Total' : 'Total Cancelled'}
                  </th>
                  {hasPriorYear && (
                    <>
                      <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                        Prior Yr{summaryCards ? ` (Wk ${summaryCards.currentWeekNumber})` : ''}
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                        Prior Yr Final
                      </th>
                      <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                        vs Prior
                      </th>
                    </>
                  )}
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    Weeks Tracked
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedBySession.map((session) => {
                  const lastPoint = session.weekly[session.weekly.length - 1]
                  const genderData = session.session_cm_id
                    ? genderBreakdownMap.get(session.session_cm_id)
                    : undefined
                  const currentCancelled = lastPoint?.enrolled ?? 0

                  // Prior year session lookup
                  const canonical = session.session_name
                    ? resolveSessionAlias(session.session_name)
                    : null
                  const priorSession = canonical ? priorSessionMap.get(canonical) : null

                  // Inverted: positive vsPrior = more cancellations = bad
                  const vsPrior =
                    priorSession != null ? currentCancelled - priorSession.final_enrolled : null

                  return (
                    <tr
                      key={session.session_cm_id}
                      className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                    >
                      <td className="text-foreground px-4 py-3 font-medium">
                        {session.session_name ?? `Session ${session.session_cm_id}`}
                      </td>
                      {splitByGender && (
                        <>
                          <td
                            className="px-4 py-3 text-right"
                            style={{ color: GENDER_COLORS.boys }}
                          >
                            {genderData?.boys_enrolled?.toLocaleString() ?? '-'}
                          </td>
                          <td
                            className="px-4 py-3 text-right"
                            style={{ color: GENDER_COLORS.girls }}
                          >
                            {genderData?.girls_enrolled?.toLocaleString() ?? '-'}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                        {currentCancelled.toLocaleString()}
                      </td>
                      {hasPriorYear && (
                        <>
                          <td className="text-muted-foreground px-4 py-3 text-right">
                            {priorSession?.enrolled_at_current_week?.toLocaleString() ?? '-'}
                          </td>
                          <td className="text-muted-foreground px-4 py-3 text-right">
                            {priorSession?.final_enrolled?.toLocaleString() ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={
                                vsPrior != null && vsPrior > 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : vsPrior != null && vsPrior < 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-muted-foreground'
                              }
                            >
                              {vsPrior != null ? `${vsPrior > 0 ? '+' : ''}${vsPrior}` : '-'}
                            </span>
                          </td>
                        </>
                      )}
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

      {/* Week-over-Week Cancellation Delta Table */}
      <div className="card-lodge overflow-hidden">
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">
            Week-over-Week Cancellation Changes
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/30 border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">Week</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Change</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Cumulative
                </th>
                {hasPriorYear && priorWeekMap && (
                  <>
                    <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                      Prior Year
                    </th>
                    <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                      Prior Delta
                    </th>
                  </>
                )}
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.combined.weekly.map((week: WeeklyDataPoint) => {
                const priorPoint = priorWeekMap?.get(week.week_number)
                return (
                  <tr
                    key={week.week_start}
                    className={`border-border hover:bg-muted/20 border-b transition-colors last:border-0 ${week.is_partial ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
                  >
                    <td className="text-foreground px-4 py-3 font-medium">
                      {week.week_label}
                      {week.is_partial && (
                        <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">
                          ({week.days_in_week}/7 days)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          week.delta > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                        }
                      >
                        {week.delta > 0 ? `+${week.delta}` : week.delta}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                      {week.enrolled.toLocaleString()}
                    </td>
                    {hasPriorYear && priorWeekMap && (
                      <>
                        <td className="text-muted-foreground px-4 py-3 text-right">
                          {priorPoint?.enrolled?.toLocaleString() ?? '-'}
                        </td>
                        <td className="text-muted-foreground px-4 py-3 text-right">
                          {priorPoint
                            ? priorPoint.delta > 0
                              ? `+${priorPoint.delta}`
                              : priorPoint.delta
                            : '-'}
                        </td>
                      </>
                    )}
                    <td className="text-muted-foreground px-4 py-3 text-right text-xs capitalize">
                      {week.data_source}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
