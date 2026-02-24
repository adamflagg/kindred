/**
 * VelocityPage - Registration velocity curves with day-over-day enrollment data.
 *
 * Shows:
 * - Cumulative enrollment line chart (current year + optional prior year overlays)
 * - Optional gender split (boys/girls lines instead of combined)
 * - Vertical phase markers for priority/early/open registration dates
 * - Color-coded phase marker legend below chart title
 * - Per-session breakdown table with optional gender columns
 * - Week-over-week delta table (daily data re-aggregated to weekly)
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
import type { VelocityDataPoint } from '../../../types/velocity'
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

/** Re-aggregate daily data into weekly summaries for the delta table. */
function aggregateDailyToWeekly(data: VelocityDataPoint[]): VelocityDataPoint[] {
  if (!data.length) return []

  // Group by week index (7-day buckets from day_number)
  const weekGroups = new Map<number, VelocityDataPoint[]>()
  for (const point of data) {
    const weekIdx = Math.floor(point.day_number / 7)
    const group = weekGroups.get(weekIdx)
    if (group) {
      group.push(point)
    } else {
      weekGroups.set(weekIdx, [point])
    }
  }

  // Take last point of each week, compute week-over-week delta
  const weeks: VelocityDataPoint[] = []
  let prevEnrolled = 0

  for (const weekIdx of [...weekGroups.keys()].sort((a, b) => a - b)) {
    const group = weekGroups.get(weekIdx)
    if (!group?.length) continue
    const lastPoint = group[group.length - 1]
    if (!lastPoint) continue
    const delta = lastPoint.enrolled - prevEnrolled
    weeks.push({
      date: lastPoint.date,
      label: lastPoint.label,
      enrolled: lastPoint.enrolled,
      waitlisted: lastPoint.waitlisted,
      data_source: lastPoint.data_source,
      day_number: lastPoint.day_number,
      delta,
    })
    prevEnrolled = lastPoint.enrolled
  }

  return weeks
}

export default function VelocityPage() {
  const { selectedSessionCmId, sessionTypesParam, sessions } = useMetricsSession()
  const { currentYear, availableYears } = useCurrentYear()
  const [selectedPriorYears, setSelectedPriorYears] = useState<number[]>([])
  const [splitByGender, setSplitByGender] = useState(false)

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

  // Build unified chart data aligned by day_number (not index)
  const chartData = useMemo(() => {
    if (!data?.combined?.data?.length) return []

    // Build day_number -> data maps for current year
    const currentMap = new Map(data.combined.data.map((d) => [d.day_number, d]))

    // Build day_number -> data maps for each prior year
    const priorMaps = data.prior_years.map(
      (py) => new Map(py.data.map((d) => [d.day_number, d]))
    )

    // Build gender maps
    const mCurve = data.by_gender?.find((c) => c.gender === 'M')
    const fCurve = data.by_gender?.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.data.map((d) => [d.day_number, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.data.map((d) => [d.day_number, d])) : new Map()

    // Build prior year gender maps
    const priorMGender = data.prior_year_by_gender?.filter((c) => c.gender === 'M') ?? []
    const priorFGender = data.prior_year_by_gender?.filter((c) => c.gender === 'F') ?? []
    const priorMGenderMaps = priorMGender.map(
      (c) => ({ year: c.year, map: new Map(c.data.map((d) => [d.day_number, d])) })
    )
    const priorFGenderMaps = priorFGender.map(
      (c) => ({ year: c.year, map: new Map(c.data.map((d) => [d.day_number, d])) })
    )

    // Collect all day_numbers across all years and gender curves
    const allDayNumbers = new Set<number>()
    for (const dn of currentMap.keys()) allDayNumbers.add(dn)
    for (const pm of priorMaps) {
      for (const dn of pm.keys()) allDayNumbers.add(dn)
    }
    for (const dn of mMap.keys()) allDayNumbers.add(dn)
    for (const dn of fMap.keys()) allDayNumbers.add(dn)
    for (const { map } of priorMGenderMaps) {
      for (const dn of map.keys()) allDayNumbers.add(dn)
    }
    for (const { map } of priorFGenderMaps) {
      for (const dn of map.keys()) allDayNumbers.add(dn)
    }

    const sorted = [...allDayNumbers].sort((a, b) => a - b)

    return sorted.map((dn) => {
      const current = currentMap.get(dn)
      let dateLabel = current?.label ?? ''

      // Fill label from prior year if current year doesn't have it
      if (!dateLabel) {
        for (const pm of priorMaps) {
          const pd = pm.get(dn)
          if (pd?.label) {
            dateLabel = pd.label
            break
          }
        }
      }
      if (!dateLabel) dateLabel = `Day ${dn}`

      const row: Record<string, string | number | null> = {
        day_number: dn,
        label: dateLabel,
        date: current?.date ?? '',
        enrolled: current?.enrolled ?? null,
        waitlisted: current?.waitlisted ?? null,
        delta: current?.delta ?? null,
      }

      // Prior year combined lines
      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(dn)
        row[`enrolled_${py.year}`] = pyPoint?.enrolled ?? null
      })

      // Gender lines
      if (splitByGender) {
        row['enrolled_boys'] = mMap.get(dn)?.enrolled ?? null
        row['enrolled_girls'] = fMap.get(dn)?.enrolled ?? null

        for (const { year, map } of priorMGenderMaps) {
          row[`enrolled_boys_${year}`] = map.get(dn)?.enrolled ?? null
        }
        for (const { year, map } of priorFGenderMaps) {
          row[`enrolled_girls_${year}`] = map.get(dn)?.enrolled ?? null
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

  // Build day_number -> label lookup for XAxis tick formatting
  const dayLabelMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const pt of chartData) {
      const dn = pt['day_number'] as number
      const label = pt['label'] as string
      if (label) map.set(dn, label)
    }
    return map
  }, [chartData])

  // Re-aggregate daily data to weekly for the delta table
  const weeklyDeltaData = useMemo(() => {
    if (!data?.combined?.data?.length) return []
    return aggregateDailyToWeekly(data.combined.data)
  }, [data?.combined?.data])

  // Phase lines with day_number for X-axis positioning
  const phaseLines = useMemo(() => {
    if (!data?.phase_markers) return []
    return data.phase_markers
      .filter((marker) => marker.day_number != null)
      .map((marker) => ({
        ...marker,
        dayNumber: marker.day_number,
      }))
  }, [data?.phase_markers])

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

  if (!data || data.combined.data.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No velocity data available. Enrollment snapshots or attendee dates are needed.
      </div>
    )
  }

  const togglePriorYear = (year: number) => {
    if (splitByGender) {
      // When gender split is on, only allow 1 prior year
      setSelectedPriorYears((prev) =>
        prev.includes(year) ? [] : [year]
      )
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
                  style={{ borderColor: PHASE_COLORS[phase.phase] ?? 'hsl(var(--muted-foreground))' }}
                />
                <span className="text-muted-foreground">{phase.label}</span>
              </div>
            ))}
          </div>
        )}

        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="day_number"
              type="number"
              domain={['dataMin', 'dataMax']}
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(dn: number) => dayLabelMap.get(dn) ?? `D${dn}`}
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
                const displayLabel = dayLabelMap.get(label as number) ?? `Day ${label}`
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

            {/* Phase marker vertical lines (no inline labels) */}
            {phaseLines.map((phase) => (
              <ReferenceLine
                key={phase.phase}
                x={phase.dayNumber}
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
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    Days Tracked
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedBySession.map((session) => {
                  const lastPoint = session.data[session.data.length - 1]
                  const genderData = session.session_cm_id
                    ? genderBreakdownMap.get(session.session_cm_id)
                    : undefined
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
                          <td className="px-4 py-3 text-right" style={{ color: GENDER_COLORS.boys }}>
                            {genderData?.boys_enrolled?.toLocaleString() ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-right" style={{ color: GENDER_COLORS.girls }}>
                            {genderData?.girls_enrolled?.toLocaleString() ?? '-'}
                          </td>
                        </>
                      )}
                      <td className="text-foreground px-4 py-3 text-right">
                        {lastPoint?.enrolled?.toLocaleString() ?? 0}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right">
                        {session.data.length}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Week-over-Week Delta Table (daily data re-aggregated to weekly) */}
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
                  Change
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Cumulative
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {weeklyDeltaData.map((week: VelocityDataPoint) => (
                <tr
                  key={week.date}
                  className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                >
                  <td className="text-foreground px-4 py-3 font-medium">{week.label}</td>
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
