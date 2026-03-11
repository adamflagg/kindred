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
import { PhaseBadge } from './PhaseBadge'

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

function formatDeltaValue(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function deltaColorClass(value: number | null): string {
  if (value != null && value > 0) return 'text-green-600 dark:text-green-400'
  if (value != null && value < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
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

/** Compute the calendar date for a prior year at a given week offset from its season start. */
function priorYearDateLabel(
  seasonStarts: Record<number, string> | undefined,
  year: number,
  weekNum: number
): string | null {
  const seasonStart = seasonStarts?.[year]
  if (!seasonStart) return null
  const d = new Date(seasonStart + 'T00:00:00')
  d.setDate(d.getDate() + weekNum * 7)
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

/** Format a date string (YYYY-MM-DD) to short display. */
function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function VelocityPage() {
  const { selectedSessionCmId, sessionTypesParam, sessions, durationParam } = useMetricsSession()
  const { currentYear, availableYears } = useCurrentYear()
  const [selectedPriorYears, setSelectedPriorYears] = useState<number[]>([])
  const [splitByGender, setSplitByGender] = useState(false)
  const [viewMode, setViewMode] = useState<VelocityViewMode>('net')
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
    duration: durationParam,
  })

  // Build unified chart data aligned by week_number
  const weeklyChartData = useMemo(() => {
    if (!data?.combined?.weekly?.length) return []

    // Build week_number -> data maps for current year
    const currentMap = new Map(data.combined.weekly.map((d) => [d.week_number, d]))

    // Build week_number -> data maps for each prior year
    const priorMaps = data.prior_years.map(
      (py) => new Map(py.weekly.map((d) => [d.week_number, d]))
    )

    // Build gender maps
    const mCurve = data.by_gender?.find((c) => c.gender === 'M')
    const fCurve = data.by_gender?.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.weekly.map((d) => [d.week_number, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.weekly.map((d) => [d.week_number, d])) : new Map()

    // Build prior year gender maps
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

    // Collect all week_numbers across all years and gender curves
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

      // Fill label from prior year if current year doesn't have it
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
        enrolled: current?.enrolled ?? null,
        delta: current?.delta ?? null,
        gross_enrolled: current?.gross_enrolled ?? null,
        weekly_new: current?.weekly_new ?? null,
        weekly_cancelled: current?.weekly_cancelled != null ? -current.weekly_cancelled : null,
        is_partial: current?.is_partial ?? false,
        days_in_week: current?.days_in_week ?? 7,
      }

      // Prior year combined lines
      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(wn)
        row[`enrolled_${py.year}`] = pyPoint?.enrolled ?? null
        row[`gross_enrolled_${py.year}`] = pyPoint?.gross_enrolled ?? null
        row[`weekly_new_${py.year}`] = pyPoint?.weekly_new ?? null
        row[`weekly_cancelled_${py.year}`] =
          pyPoint?.weekly_cancelled != null ? -pyPoint.weekly_cancelled : null
      })

      // Gender lines
      if (splitByGender) {
        row['enrolled_boys'] = mMap.get(wn)?.enrolled ?? null
        row['enrolled_girls'] = fMap.get(wn)?.enrolled ?? null
        row['gross_enrolled_boys'] = mMap.get(wn)?.gross_enrolled ?? null
        row['gross_enrolled_girls'] = fMap.get(wn)?.gross_enrolled ?? null
        // Gender delta keys for Weekly Delta view
        row['weekly_new_boys'] = mMap.get(wn)?.weekly_new ?? null
        row['weekly_new_girls'] = fMap.get(wn)?.weekly_new ?? null
        row['weekly_cancelled_boys'] =
          mMap.get(wn)?.weekly_cancelled != null ? -mMap.get(wn)!.weekly_cancelled : null
        row['weekly_cancelled_girls'] =
          fMap.get(wn)?.weekly_cancelled != null ? -fMap.get(wn)!.weekly_cancelled : null

        for (const { year, map } of priorMGenderMaps) {
          row[`enrolled_boys_${year}`] = map.get(wn)?.enrolled ?? null
          row[`gross_enrolled_boys_${year}`] = map.get(wn)?.gross_enrolled ?? null
          row[`weekly_new_boys_${year}`] = map.get(wn)?.weekly_new ?? null
          row[`weekly_cancelled_boys_${year}`] =
            map.get(wn)?.weekly_cancelled != null ? -map.get(wn)!.weekly_cancelled : null
        }
        for (const { year, map } of priorFGenderMaps) {
          row[`enrolled_girls_${year}`] = map.get(wn)?.enrolled ?? null
          row[`gross_enrolled_girls_${year}`] = map.get(wn)?.gross_enrolled ?? null
          row[`weekly_new_girls_${year}`] = map.get(wn)?.weekly_new ?? null
          row[`weekly_cancelled_girls_${year}`] =
            map.get(wn)?.weekly_cancelled != null ? -map.get(wn)!.weekly_cancelled : null
        }
      }

      return row
    })
  }, [data, splitByGender])

  // Build daily chart data for cumulative (gross/net) views, aligned by day_offset
  const dailyChartData = useMemo(() => {
    if (!data?.daily?.length) return []

    // Build day_offset -> data map for current year
    const currentMap = new Map(data.daily.map((d) => [d.day_offset, d]))

    // Build day_offset -> data maps for each prior year
    const priorMaps = data.prior_years.map((py) => new Map(py.daily.map((d) => [d.day_offset, d])))

    // Build gender maps from by_gender daily data
    const mCurve = data.by_gender?.find((c) => c.gender === 'M')
    const fCurve = data.by_gender?.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.daily.map((d) => [d.day_offset, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.daily.map((d) => [d.day_offset, d])) : new Map()

    // Build prior year gender daily maps
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

    // Collect all day_offsets across all years
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
        enrolled: current?.enrolled ?? null,
        gross_enrolled: current?.gross_enrolled ?? null,
      }

      // Prior year combined lines
      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(dayOffset)
        row[`enrolled_${py.year}`] = pyPoint?.enrolled ?? null
        row[`gross_enrolled_${py.year}`] = pyPoint?.gross_enrolled ?? null
      })

      // Gender lines
      if (splitByGender) {
        row['enrolled_boys'] = mMap.get(dayOffset)?.enrolled ?? null
        row['enrolled_girls'] = fMap.get(dayOffset)?.enrolled ?? null
        row['gross_enrolled_boys'] = mMap.get(dayOffset)?.gross_enrolled ?? null
        row['gross_enrolled_girls'] = fMap.get(dayOffset)?.gross_enrolled ?? null

        for (const { year, map } of priorMGenderMaps) {
          row[`enrolled_boys_${year}`] = map.get(dayOffset)?.enrolled ?? null
          row[`gross_enrolled_boys_${year}`] = map.get(dayOffset)?.gross_enrolled ?? null
        }
        for (const { year, map } of priorFGenderMaps) {
          row[`enrolled_girls_${year}`] = map.get(dayOffset)?.enrolled ?? null
          row[`gross_enrolled_girls_${year}`] = map.get(dayOffset)?.gross_enrolled ?? null
        }
      }

      return row
    })
  }, [data, splitByGender])

  // Sort by-session table using camp-then-quest ordering
  // Must be before early returns to satisfy React hooks rules
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

  // Build week_number -> label lookup for XAxis tick formatting
  const weekLabelMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const pt of weeklyChartData) {
      const wn = pt['week_number'] as number
      const label = pt['label'] as string
      if (label) map.set(wn, label)
    }
    return map
  }, [weeklyChartData])

  // Build day_offset -> date label map for daily x-axis tick formatting
  // Only show ticks every 7 days to avoid overcrowding
  const dailyTickFormatter = useMemo(() => {
    if (!data?.season_start) return (_offset: number) => ''
    const seasonStart = new Date(data.season_start + 'T00:00:00')
    return (offset: number) => {
      const d = new Date(seasonStart)
      d.setDate(d.getDate() + offset)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }, [data?.season_start])

  // Phase lines with week_number for X-axis positioning
  const phaseLines = useMemo(() => {
    if (!data?.phase_markers) return []
    return data.phase_markers
      .filter((marker) => marker.week_number != null)
      .map((marker) => ({
        ...marker,
        weekNumber: marker.week_number,
      }))
  }, [data?.phase_markers])

  // Phase day offsets for ReferenceArea bands on daily cumulative charts
  const phaseDayOffsets = useMemo(() => {
    if (!data?.phase_markers || !data?.season_start) return []
    const seasonStart = new Date(data.season_start + 'T00:00:00').getTime()
    return data.phase_markers.map((marker) => ({
      phase: marker.phase,
      label: marker.label,
      dayOffset: Math.floor(
        (new Date(marker.date + 'T00:00:00').getTime() - seasonStart) / 86400000
      ),
    }))
  }, [data?.phase_markers, data?.season_start])

  // Weekly milestone indices in dailyChartData for zoom dropdown (every 7th day)
  const dailyZoomMilestones = useMemo(() => {
    if (!dailyChartData.length) return []
    const milestones: Array<{ index: number; label: string }> = []
    dailyChartData.forEach((pt, i) => {
      const offset = pt['day_offset'] as number
      if (offset % 7 === 0) {
        const weekNum = offset / 7
        const dateStr = pt['date'] as string
        const dateLabel = dateStr ? formatDateShort(dateStr) : ''
        milestones.push({ index: i, label: `Wk ${weekNum}${dateLabel ? ` - ${dateLabel}` : ''}` })
      }
    })
    // Always include the last point if not already a milestone
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

  // Map week_number -> PhaseMarker for table badge lookup
  const phaseByWeek = useMemo(() => {
    const map = new Map<number, (typeof phaseLines)[0]>()
    for (const phase of phaseLines) {
      map.set(phase.weekNumber, phase)
    }
    return map
  }, [phaseLines])

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

  // Build prior year week map for delta table
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
        const pyLast = py.weekly[py.weekly.length - 1]
        priorFinal = pyLast?.enrolled ?? null
      }
    }

    const delta = priorAtWeek != null ? currentEnrolled - priorAtWeek : null

    const cancelledToDate = data.cancelled_to_date
    const priorCancelled =
      data.prior_year_cancelled_to_date?.length > 0 ? data.prior_year_cancelled_to_date[0] : null

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

  const togglePriorYear = (year: number) => {
    if (splitByGender) {
      // When gender split is on, only allow 1 prior year
      setSelectedPriorYears((prev) => (prev.includes(year) ? [] : [year]))
    } else {
      setSelectedPriorYears((prev) =>
        prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
      )
    }
  }

  const handleGenderToggle = (enabled: boolean) => {
    setSplitByGender(enabled)
    // When enabling gender, limit prior years to max 1
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
      {/* Controls: Prior year checkboxes + Gender toggle */}
      <div className="card-lodge p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Prior year checkboxes */}
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

          <div className="flex items-center gap-4">
            {/* View mode toggle */}
            <div className="border-border flex overflow-hidden rounded-lg border">
              {(['gross', 'net', 'delta'] as VelocityViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setViewMode(mode)
                    setZoomRange(null)
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

            {/* Gender split toggle */}
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
      <div className="card-lodge p-4">
        <h3 className="text-foreground mb-2 text-base font-semibold">
          {VIEW_MODE_LABELS[viewMode]} Enrollment - {currentYear}
        </h3>

        {/* Phase marker legend */}
        {phaseLines.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4 text-xs">
            {phaseLines.map((phase) => (
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
        {selectedPriorYears.length > 0 && (
          <p className="text-muted-foreground mb-3 text-xs italic">
            X-axis dates are for {currentYear}. Hover for prior year dates.
          </p>
        )}

        {/* Zoom range selectors */}
        {viewMode === 'delta'
          ? weeklyChartData.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="text-muted-foreground text-xs font-medium">Zoom:</label>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={zoomRange?.[0] ?? 0}
                  onChange={(e) => {
                    const start = Number(e.target.value)
                    const end = zoomRange?.[1] ?? weeklyChartData.length - 1
                    setZoomRange([start, Math.max(start, end)])
                  }}
                >
                  {weeklyChartData.map((pt, i) => (
                    <option key={i} value={i}>
                      Wk {pt['week_number']} - {pt['label']}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">to</span>
                <select
                  className="border-border bg-card text-foreground rounded border px-2 py-1 text-xs"
                  value={zoomRange?.[1] ?? weeklyChartData.length - 1}
                  onChange={(e) => {
                    const end = Number(e.target.value)
                    const start = zoomRange?.[0] ?? 0
                    setZoomRange([Math.min(start, end), end])
                  }}
                >
                  {weeklyChartData.map((pt, i) => (
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
            )
          : dailyZoomMilestones.length > 0 && (
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
            )}

        <ResponsiveContainer width="100%" height={380}>
          {viewMode === 'delta' ? (
            <LineChart data={weeklyChartData} margin={{ top: 20, right: 30, left: 20, bottom: 35 }}>
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
                  value: Y_AXIS_LABELS[viewMode],
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
                  const row = weeklyChartData.find((d) => d['week_number'] === label)
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
                        const yearMatch = entry.name?.match(/\b(\d{4})\b/)
                        const priorDate =
                          yearMatch && label != null
                            ? priorYearDateLabel(
                                data?.prior_year_season_starts,
                                Number(yearMatch[1]),
                                label as number
                              )
                            : null
                        return (
                          <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
                            {entry.name}: {Math.abs(Number(entry.value)).toLocaleString()}
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
                {...(zoomRange ? { startIndex: zoomRange[0], endIndex: zoomRange[1] } : {})}
                tickFormatter={(wn: number) => weekLabelMap.get(wn) ?? `Wk${wn}`}
              />

              {/* Phase marker vertical lines */}
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
                  {selectedPriorYears.slice(0, 1).map((year) => (
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
            <LineChart data={dailyChartData} margin={{ top: 20, right: 30, left: 20, bottom: 35 }}>
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
                  return dailyTickFormatter(offset)
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
                  if (!active || !payload?.length) return null
                  const validPayload = payload.filter((entry) => entry.value != null)
                  if (!validPayload.length) return null
                  const dayOffset = label as number
                  const row = dailyChartData.find((d) => d['day_offset'] === dayOffset)
                  const dateStr = row?.['date'] as string
                  const weekNum = Math.floor(dayOffset / 7)
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

              {/* Brush for zoom/scrub */}
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
                  {selectedPriorYears.slice(0, 1).map((year) => (
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
      {sortedBySession.length > 1 && (
        <div className="card-lodge p-4">
          <h3 className="text-foreground mb-4 text-base font-semibold">By Session</h3>
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
                    {splitByGender ? 'Total' : 'Latest Enrolled'}
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
                  const currentEnrolled = lastPoint?.enrolled ?? 0

                  // Prior year session lookup
                  const canonical = session.session_name
                    ? resolveSessionAlias(session.session_name)
                    : null
                  const priorSession = canonical ? priorSessionMap.get(canonical) : null

                  const vsPrior =
                    priorSession != null ? currentEnrolled - priorSession.final_enrolled : null

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
                      <td className="text-foreground px-4 py-3 text-right">
                        {currentEnrolled.toLocaleString()}
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
                            <span className={deltaColorClass(vsPrior)}>
                              {vsPrior != null ? formatDeltaValue(vsPrior) : '-'}
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
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">New</th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Cancelled
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Net Change
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Net Cumulative
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Gross Cumulative
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
                      {(() => {
                        const marker = phaseByWeek.get(week.week_number)
                        return marker ? (
                          <PhaseBadge phase={marker.phase} label={marker.label} />
                        ) : null
                      })()}
                      {week.is_partial && (
                        <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">
                          ({week.days_in_week}/7 days)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">
                      {week.weekly_new > 0 ? `+${week.weekly_new}` : week.weekly_new}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                      {week.weekly_cancelled > 0 ? `-${week.weekly_cancelled}` : 0}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={deltaColorClass(week.delta)}>
                        {formatDeltaValue(week.delta)}
                      </span>
                    </td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {week.enrolled.toLocaleString()}
                    </td>
                    <td className="text-foreground px-4 py-3 text-right">
                      {week.gross_enrolled.toLocaleString()}
                    </td>
                    {hasPriorYear && priorWeekMap && (
                      <>
                        <td className="text-muted-foreground px-4 py-3 text-right">
                          {priorPoint?.enrolled?.toLocaleString() ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={deltaColorClass(priorPoint?.delta ?? null)}>
                            {priorPoint ? formatDeltaValue(priorPoint.delta) : '-'}
                          </span>
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
