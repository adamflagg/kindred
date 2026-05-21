import { useMemo } from 'react'
import type { VelocityResponse } from '../types/velocity'
import { resolveSessionAlias } from '../utils/sessionAliases'
import {
  sortSessionDataByCampThenQuest,
  buildSessionDateLookup,
  buildSessionTypeLookup,
} from '../utils/sessionUtils'
import { formatDateShort } from '../utils/chartFormatters'

export interface VelocityChartConfig {
  metric: 'enrollment' | 'cancellation'
  splitByGender: boolean
  selectedPriorYears: number[]
}

type ChartRow = Record<string, string | number | boolean | null>

export function useVelocityChartData(
  data: VelocityResponse | undefined,
  sessions: Array<{ cm_id: number; name: string; start_date: string; session_type: string }>,
  config: VelocityChartConfig
) {
  const { metric, splitByGender } = config

  // Build unified chart data aligned by week_number
  const weeklyChartData = useMemo(() => {
    if (!data?.combined.weekly.length) return []

    // Build week_number -> data maps for current year
    const currentMap = new Map(data.combined.weekly.map((d) => [d.week_number, d]))

    // Build week_number -> data maps for each prior year
    const priorMaps = data.prior_years.map(
      (py) => new Map(py.weekly.map((d) => [d.week_number, d]))
    )

    // Build gender maps
    const mCurve = data.by_gender.find((c) => c.gender === 'M')
    const fCurve = data.by_gender.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.weekly.map((d) => [d.week_number, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.weekly.map((d) => [d.week_number, d])) : new Map()

    // Build prior year gender maps
    const priorMGender = data.prior_year_by_gender.filter((c) => c.gender === 'M')
    const priorFGender = data.prior_year_by_gender.filter((c) => c.gender === 'F')
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

      const row: ChartRow = {
        week_number: wn,
        label: weekLabel,
        week_start: current?.week_start ?? '',
        delta: current?.delta ?? null,
        is_partial: current?.is_partial ?? false,
        days_in_week: current?.days_in_week ?? 7,
      }

      if (metric === 'enrollment') {
        row['enrolled'] = current?.enrolled ?? null
        row['gross_enrolled'] = current?.gross_enrolled ?? null
        row['weekly_new'] = current?.weekly_new ?? null
        row['weekly_cancelled'] = current?.weekly_cancelled ?? null
      } else {
        // cancellation: enrolled field repurposed for cancelled count
        row['cancelled'] = current?.enrolled ?? null
      }

      // Prior year combined lines
      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(wn)
        if (metric === 'enrollment') {
          row[`enrolled_${py.year}`] = pyPoint?.enrolled ?? null
          row[`gross_enrolled_${py.year}`] = pyPoint?.gross_enrolled ?? null
          row[`weekly_new_${py.year}`] = pyPoint?.weekly_new ?? null
          row[`weekly_cancelled_${py.year}`] = pyPoint?.weekly_cancelled ?? null
        } else {
          row[`cancelled_${py.year}`] = pyPoint?.enrolled ?? null
        }
      })

      // Gender lines
      if (splitByGender) {
        if (metric === 'enrollment') {
          row['enrolled_boys'] = mMap.get(wn)?.enrolled ?? null
          row['enrolled_girls'] = fMap.get(wn)?.enrolled ?? null
          row['gross_enrolled_boys'] = mMap.get(wn)?.gross_enrolled ?? null
          row['gross_enrolled_girls'] = fMap.get(wn)?.gross_enrolled ?? null
          // Gender delta keys for Weekly Delta view
          row['weekly_new_boys'] = mMap.get(wn)?.weekly_new ?? null
          row['weekly_new_girls'] = fMap.get(wn)?.weekly_new ?? null
          row['weekly_cancelled_boys'] = mMap.get(wn)?.weekly_cancelled ?? null
          row['weekly_cancelled_girls'] = fMap.get(wn)?.weekly_cancelled ?? null

          for (const { year, map } of priorMGenderMaps) {
            row[`enrolled_boys_${year}`] = map.get(wn)?.enrolled ?? null
            row[`gross_enrolled_boys_${year}`] = map.get(wn)?.gross_enrolled ?? null
            row[`weekly_new_boys_${year}`] = map.get(wn)?.weekly_new ?? null
            row[`weekly_cancelled_boys_${year}`] = map.get(wn)?.weekly_cancelled ?? null
          }
          for (const { year, map } of priorFGenderMaps) {
            row[`enrolled_girls_${year}`] = map.get(wn)?.enrolled ?? null
            row[`gross_enrolled_girls_${year}`] = map.get(wn)?.gross_enrolled ?? null
            row[`weekly_new_girls_${year}`] = map.get(wn)?.weekly_new ?? null
            row[`weekly_cancelled_girls_${year}`] = map.get(wn)?.weekly_cancelled ?? null
          }
        } else {
          // cancellation: gender maps from enrolled value
          row['cancelled_boys'] = mMap.get(wn)?.enrolled ?? null
          row['cancelled_girls'] = fMap.get(wn)?.enrolled ?? null

          for (const { year, map } of priorMGenderMaps) {
            row[`cancelled_boys_${year}`] = map.get(wn)?.enrolled ?? null
          }
          for (const { year, map } of priorFGenderMaps) {
            row[`cancelled_girls_${year}`] = map.get(wn)?.enrolled ?? null
          }
        }
      }

      return row
    })
  }, [data, splitByGender, metric])

  // Build daily chart data aligned by day_offset
  const dailyChartData = useMemo(() => {
    if (!data?.daily.length) return []

    // Build day_offset -> data map for current year
    const currentMap = new Map(data.daily.map((d) => [d.day_offset, d]))

    // Build day_offset -> data maps for each prior year
    const priorMaps = data.prior_years.map((py) => new Map(py.daily.map((d) => [d.day_offset, d])))

    // Build gender maps from by_gender daily data
    const mCurve = data.by_gender.find((c) => c.gender === 'M')
    const fCurve = data.by_gender.find((c) => c.gender === 'F')
    const mMap = mCurve ? new Map(mCurve.daily.map((d) => [d.day_offset, d])) : new Map()
    const fMap = fCurve ? new Map(fCurve.daily.map((d) => [d.day_offset, d])) : new Map()

    // Build prior year gender daily maps
    const priorMGender = data.prior_year_by_gender.filter((c) => c.gender === 'M')
    const priorFGender = data.prior_year_by_gender.filter((c) => c.gender === 'F')
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

      const row: ChartRow = {
        day_offset: dayOffset,
        date: current?.date ?? '',
      }

      if (metric === 'enrollment') {
        row['enrolled'] = current?.enrolled ?? null
        row['gross_enrolled'] = current?.gross_enrolled ?? null
      } else {
        // cancellation: enrolled field repurposed for cancelled count
        row['cancelled'] = current?.enrolled ?? null
      }

      // Prior year combined lines
      data.prior_years.forEach((py, i) => {
        const pyPoint = priorMaps[i]?.get(dayOffset)
        if (metric === 'enrollment') {
          row[`enrolled_${py.year}`] = pyPoint?.enrolled ?? null
          row[`gross_enrolled_${py.year}`] = pyPoint?.gross_enrolled ?? null
        } else {
          row[`cancelled_${py.year}`] = pyPoint?.enrolled ?? null
        }
      })

      // Gender lines
      if (splitByGender) {
        if (metric === 'enrollment') {
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
        } else {
          // cancellation daily gender: use enrolled_boys/enrolled_girls from daily data point
          row['cancelled_boys'] = mMap.get(dayOffset)?.enrolled_boys ?? null
          row['cancelled_girls'] = fMap.get(dayOffset)?.enrolled_girls ?? null

          for (const { year, map } of priorMGenderMaps) {
            row[`cancelled_boys_${year}`] = map.get(dayOffset)?.enrolled_boys ?? null
          }
          for (const { year, map } of priorFGenderMaps) {
            row[`cancelled_girls_${year}`] = map.get(dayOffset)?.enrolled_girls ?? null
          }
        }
      }

      return row
    })
  }, [data, splitByGender, metric])

  // Sort by-session table using camp-then-quest ordering
  const sortedBySession = useMemo(() => {
    if (!data?.by_session.length || !sessions.length) return data?.by_session ?? []

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

  // Phase lines with week_number for X-axis positioning
  const phaseLines = useMemo(() => {
    if (!data?.phase_markers) return []
    return (
      data.phase_markers
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- week_number is int (non-nullable) per API schema, but defensive guard kept as belt-and-suspenders
        .filter((marker) => marker.week_number != null)
        .map((marker) => ({
          ...marker,
          weekNumber: marker.week_number,
        }))
    )
  }, [data?.phase_markers])

  // Phase day offsets for ReferenceArea bands on daily cumulative charts
  const phaseDayOffsets = useMemo(() => {
    if (!data?.phase_markers || !data.season_start) return []
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

  // Build day_offset -> date label formatter for daily x-axis tick formatting
  const dailyTickFormatter = useMemo(() => {
    if (!data?.season_start) return (_offset: number) => ''
    const seasonStart = new Date(data.season_start + 'T00:00:00')
    return (offset: number) => {
      const d = new Date(seasonStart)
      d.setDate(d.getDate() + offset)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }, [data?.season_start])

  // Weekly milestone indices in dailyChartData for zoom dropdown (every 7th day)
  const dailyZoomMilestones = useMemo(() => {
    if (!dailyChartData.length) return []
    const milestones: Array<{ index: number; label: string }> = []
    dailyChartData.forEach((pt, i) => {
      const offset = pt['day_offset'] as number
      if (offset % 7 === 0) {
        const weekNum = offset < 0 ? 0 : Math.floor(offset / 7) + 1
        const dateStr = pt['date'] as string
        const dateLabel = dateStr ? formatDateShort(dateStr) : ''
        milestones.push({ index: i, label: `Wk ${weekNum}${dateLabel ? ` - ${dateLabel}` : ''}` })
      }
    })
    // Always include the last point if not already a milestone
    const lastIdx = dailyChartData.length - 1
    const lastMilestone = milestones.at(-1)
    if (lastMilestone?.index !== lastIdx) {
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
    const map = new Map<string, VelocityResponse['prior_year_session_summaries'][number]>()
    for (const summary of data?.prior_year_session_summaries ?? []) {
      if (summary.session_name) {
        const canonical = resolveSessionAlias(summary.session_name)
        map.set(canonical, summary)
      }
    }
    return map
  }, [data?.prior_year_session_summaries])

  // Build prior year week map for delta table
  const priorWeekMap = useMemo(() => {
    if (!data?.prior_years.length) return null
    const py = data.prior_years[0]
    if (!py) return null
    return new Map(py.weekly.map((d) => [d.week_number, d]))
  }, [data?.prior_years])

  return {
    weeklyChartData,
    dailyChartData,
    sortedBySession,
    weekLabelMap,
    phaseLines,
    phaseDayOffsets,
    dailyTickFormatter,
    dailyZoomMilestones,
    priorSessionMap,
    priorWeekMap,
  }
}
