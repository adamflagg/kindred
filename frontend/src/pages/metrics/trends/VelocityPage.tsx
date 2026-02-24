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

const PHASE_COLORS: Record<string, string> = {
  priority: 'hsl(270, 60%, 55%)',
  early: 'hsl(200, 70%, 50%)',
  open: 'hsl(140, 60%, 40%)',
}

export default function VelocityPage() {
  const { selectedSessionCmId, sessionTypesParam, sessions } = useMetricsSession()
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
  })

  // Build unified chart data aligned by week_number
  const chartData = useMemo(() => {
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

      const row: Record<string, string | number | null> = {
        week_number: wn,
        label: weekLabel,
        week_start: current?.week_start ?? '',
        enrolled: current?.enrolled ?? null,
        waitlisted: current?.waitlisted ?? null,
        delta: current?.delta ?? null,
      }

      // Prior year combined lines
      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(wn)
        row[`enrolled_${py.year}`] = pyPoint?.enrolled ?? null
      })

      // Gender lines
      if (splitByGender) {
        row['enrolled_boys'] = mMap.get(wn)?.enrolled ?? null
        row['enrolled_girls'] = fMap.get(wn)?.enrolled ?? null

        for (const { year, map } of priorMGenderMaps) {
          row[`enrolled_boys_${year}`] = map.get(wn)?.enrolled ?? null
        }
        for (const { year, map } of priorFGenderMaps) {
          row[`enrolled_girls_${year}`] = map.get(wn)?.enrolled ?? null
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
    for (const pt of chartData) {
      const wn = pt['week_number'] as number
      const label = pt['label'] as string
      if (label) map.set(wn, label)
    }
    return map
  }, [chartData])

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
      data.prior_year_cancelled_to_date?.length > 0
        ? data.prior_year_cancelled_to_date[0]
        : null

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
            <p
              className={`text-xl font-bold ${
                summaryCards.delta != null && summaryCards.delta > 0
                  ? 'text-green-600 dark:text-green-400'
                  : summaryCards.delta != null && summaryCards.delta < 0
                    ? 'text-red-600 dark:text-red-400'
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
          Enrollment Velocity - {currentYear}
        </h3>

        {/* Phase marker legend */}
        {phaseLines.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4 text-xs">
            {phaseLines.map((phase) => (
              <div key={phase.phase} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-5 border-t-2 border-dashed"
                  style={{
                    borderColor: PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))',
                  }}
                />
                <span className="text-muted-foreground">{phase.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Week-range selectors */}
        {chartData.length > 0 && (
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
                value: 'Cumulative Enrolled',
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
                return (
                  <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
                    <p className="text-foreground mb-1 font-medium">{displayLabel}</p>
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

            {/* Brush for zoom/scrub */}
            <Brush
              dataKey="week_number"
              height={20}
              stroke="hsl(var(--primary))"
              {...(zoomRange ? { startIndex: zoomRange[0], endIndex: zoomRange[1] } : {})}
              tickFormatter={(wn: number) => weekLabelMap.get(wn) ?? `Wk${wn}`}
            />

            {/* Phase marker vertical lines (no inline labels) */}
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
                {/* Gender split: boys + girls lines */}
                <Line
                  type="monotone"
                  dataKey="enrolled_boys"
                  name={`Boys ${currentYear}`}
                  stroke={GENDER_COLORS.boys}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="enrolled_girls"
                  name={`Girls ${currentYear}`}
                  stroke={GENDER_COLORS.girls}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
                {/* Prior year gender lines (dashed) */}
                {selectedPriorYears.slice(0, 1).map((year) => (
                  <>
                    <Line
                      key={`boys_${year}`}
                      type="monotone"
                      dataKey={`enrolled_boys_${year}`}
                      name={`Boys ${year}`}
                      stroke={GENDER_COLORS.boys}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      opacity={0.6}
                      connectNulls={false}
                    />
                    <Line
                      key={`girls_${year}`}
                      type="monotone"
                      dataKey={`enrolled_girls_${year}`}
                      name={`Girls ${year}`}
                      stroke={GENDER_COLORS.girls}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      opacity={0.6}
                      connectNulls={false}
                    />
                  </>
                ))}
              </>
            ) : (
              <>
                {/* Combined: single enrollment line */}
                <Line
                  type="monotone"
                  dataKey="enrolled"
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
                    dataKey={`enrolled_${py.year}`}
                    name={String(py.year)}
                    stroke={PRIOR_YEAR_COLORS[i % PRIOR_YEAR_COLORS.length] ?? 'hsl(220, 60%, 65%)'}
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
                            <span
                              className={
                                vsPrior != null && vsPrior > 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : vsPrior != null && vsPrior < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-muted-foreground'
                              }
                            >
                              {vsPrior != null
                                ? `${vsPrior > 0 ? '+' : ''}${vsPrior}`
                                : '-'}
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
                    className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                  >
                    <td className="text-foreground px-4 py-3 font-medium">{week.week_label}</td>
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
                    {hasPriorYear && priorWeekMap && (
                      <>
                        <td className="text-muted-foreground px-4 py-3 text-right">
                          {priorPoint?.enrolled?.toLocaleString() ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={
                              priorPoint && priorPoint.delta > 0
                                ? 'text-green-600 dark:text-green-400'
                                : priorPoint && priorPoint.delta < 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-muted-foreground'
                            }
                          >
                            {priorPoint
                              ? priorPoint.delta > 0
                                ? `+${priorPoint.delta}`
                                : priorPoint.delta
                              : '-'}
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
