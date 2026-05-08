import { useState, useMemo, useEffect } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useForecast } from '../../../hooks/useForecast'
import { useWeekOptions } from '../../../hooks/useWeekOptions'
import { SnapshotDateSelector } from '../../../components/metrics/SnapshotDateSelector'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  sortSessionDataByCampThenQuest,
} from '../../../utils/sessionUtils'
import { isMainOrEmbedded, isAgSession, isQuestSession } from '../../../utils/sessionTypePredicates'
import { shortenSessionName } from '../../../utils/sessionDisplay'
import { buildForecastSections } from '../../../utils/forecastUtils'
import { resolveWeekOffset } from '../../../utils/resolveWeekOffset'
import type { SessionForecast } from '../../../types/forecast'

function pctColor(pct: number | null): string {
  if (pct === null) return ''
  if (pct >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function fmt(value: number | null, suffix = ''): string {
  if (value === null) return '---'
  return `${value.toLocaleString()}${suffix}`
}

function deltaColor(value: number | null): string {
  if (value === null || value === 0) return 'text-muted-foreground'
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

function fmtSigned(value: number | null): string {
  if (value === null) return '---'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toLocaleString()}`
}

function fmtSignedCurrency(value: number | null): string {
  if (value === null) return '---'
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  if (value > 0) return `+$${abs}`
  if (value < 0) return `-$${abs}`
  return `$${abs}`
}

function fmtCurrency(value: number | null): string {
  if (value === null) return '---'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(value: number | null): string {
  if (value === null) return '---'
  return `${value.toFixed(1)}%`
}

function ForecastTableHeader() {
  return (
    <thead>
      <tr className="bg-muted/50">
        <th className="px-3 py-2 text-left text-xs font-semibold">Session</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Goal</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Enrolled</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">B / G</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">WL</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">% Goal</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">vs Budget</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">Prior Yr</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">vs Prior</th>
        <th className="px-3 py-2 text-right text-xs font-semibold">2yr Prior</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">
          Budget Rev
        </th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">
          Actual Rev
        </th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Delta $</th>
        <th className="hidden px-3 py-2 text-right text-xs font-semibold lg:table-cell">Rev%</th>
      </tr>
    </thead>
  )
}

function SessionRow({ session, isTotal }: { session: SessionForecast; isTotal?: boolean }) {
  const rowClass = isTotal ? 'font-bold bg-muted/30' : 'border-border border-b last:border-b-0'

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2 text-sm whitespace-nowrap">
        {shortenSessionName(session.session_name)}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.participant_goal)}</td>
      <td className="px-3 py-2 text-right text-sm font-medium">
        {session.enrolled.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right text-sm whitespace-nowrap">
        {session.enrolled_boys !== null && session.enrolled_girls !== null ? (
          <>
            <span className="text-blue-800 dark:text-blue-300">{session.enrolled_boys}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-pink-800 dark:text-pink-300">{session.enrolled_girls}</span>
          </>
        ) : (
          <span className="text-muted-foreground">--</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm">{session.waitlisted.toLocaleString()}</td>
      <td className={`px-3 py-2 text-right text-sm font-medium ${pctColor(session.pct_of_goal)}`}>
        {fmtPct(session.pct_of_goal)}
      </td>
      <td className={`px-3 py-2 text-right text-sm ${deltaColor(session.participants_vs_budget)}`}>
        {fmtSigned(session.participants_vs_budget)}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.prior_year_count)}</td>
      <td
        className={`px-3 py-2 text-right text-sm ${deltaColor(session.participants_vs_prior_year)}`}
      >
        {fmtSigned(session.participants_vs_prior_year)}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.two_year_prior_count)}</td>
      <td className="hidden px-3 py-2 text-right text-sm lg:table-cell">
        {fmtCurrency(session.budget_revenue)}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm lg:table-cell">
        {fmtCurrency(session.actual_revenue)}
      </td>
      <td
        className={`hidden px-3 py-2 text-right text-sm lg:table-cell ${deltaColor(session.revenue_delta)}`}
      >
        {fmtSignedCurrency(session.revenue_delta)}
      </td>
      <td
        className={`hidden px-3 py-2 text-right text-sm lg:table-cell ${pctColor(session.revenue_pct)}`}
      >
        {fmtPct(session.revenue_pct)}
      </td>
    </tr>
  )
}

export default function ForecastPage() {
  const { currentYear, availableYears } = useCurrentYear()
  const {
    selectedSessionCmId,
    sessionTypesParam,
    sessions: metricsSessions,
    durationParam,
  } = useMetricsSession()
  const [dayOffset, setDayOffset] = useState<number | null>(null)
  const { data: weekOptions = [] } = useWeekOptions(currentYear)

  // Always know "today's week" from the latest (current) season — React Query
  // deduplicates when currentYear === latestYear, so no extra fetch in that case
  const latestYear = Math.max(0, ...availableYears)
  const { data: latestYearOptions = [] } = useWeekOptions(latestYear)
  const todayWeek = latestYearOptions.find((o) => o.is_today)?.week_number ?? null

  // Remap week selection when year changes or todayWeek becomes known
  useEffect(() => {
    // For past seasons, wait until todayWeek is loaded before remapping
    const isPastSeason = !weekOptions.some((o) => o.is_today)
    if (isPastSeason && todayWeek === null) return

    const resolved = resolveWeekOffset(dayOffset, weekOptions, todayWeek)
    if (resolved !== undefined) {
      setDayOffset(resolved)
    }
  }, [weekOptions, todayWeek]) // eslint-disable-line react-hooks/exhaustive-deps -- dayOffset excluded to avoid feedback loop

  const { data, isLoading, error } = useForecast(currentYear, {
    sessionCmId: selectedSessionCmId,
    sessionTypes: sessionTypesParam,
    dayOffset,
    duration: durationParam,
  })

  // Build lookups for camp-then-quest sorting from the session context
  const dateLookup = useMemo(() => buildSessionDateLookup(metricsSessions), [metricsSessions])
  const typeLookup = useMemo(() => buildSessionTypeLookup(metricsSessions), [metricsSessions])

  // Sort sessions: camp chronologically, then quests chronologically
  const allSessions = useMemo(
    () => (data ? sortSessionDataByCampThenQuest(data.sessions, dateLookup, typeLookup) : []),
    [data, dateLookup, typeLookup]
  )

  // Split into camp table: main/embedded first (by date), then AG at bottom (by date)
  const campSessions = useMemo(() => {
    const mainEmbedded = allSessions.filter(isMainOrEmbedded)
    const ag = allSessions.filter(isAgSession)
    return [...mainEmbedded, ...ag]
  }, [allSessions])
  const questSessions = useMemo(() => allSessions.filter(isQuestSession), [allSessions])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading forecast data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-red-500" />
        <p className="text-sm text-red-700 dark:text-red-300">Failed to load forecast data</p>
      </div>
    )
  }

  if (!data) return null

  if (data.sessions.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No forecast data available for the selected filters
      </div>
    )
  }

  const { grand_total } = data

  const sections = buildForecastSections(campSessions, questSessions)
  const showSectionHeadings = sections.length >= 2
  const showGrandTotal = sections.length >= 2 && selectedSessionCmId === null

  return (
    <div className="space-y-6">
      <div data-tour="reg-forecast-snapshot">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">Enrollment Forecast</h2>
          {grand_total.participant_goal !== null && grand_total.participant_goal > 0 && (
            <span className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">
                {grand_total.enrolled.toLocaleString()}/
                {grand_total.participant_goal.toLocaleString()}
              </span>
              {' enrolled'}
              {grand_total.pct_of_goal !== null && (
                <span className={`ml-1 font-medium ${pctColor(grand_total.pct_of_goal)}`}>
                  ({grand_total.pct_of_goal.toFixed(1)}% of goal)
                </span>
              )}
            </span>
          )}
          <div className="ml-auto">
            <SnapshotDateSelector
              dayOffset={dayOffset}
              onOffsetChange={setDayOffset}
              weekOptions={weekOptions}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {dayOffset != null
            ? `Enrollment at Week ${data.week_number ?? Math.floor(dayOffset / 7)} (${dayOffset} days after priority reg)`
            : `Budget goals and revenue projections for ${currentYear}`}
        </p>
      </div>

      {/* Section tables */}
      <div className="space-y-6" data-tour="reg-forecast-table">
        {sections.map((section) => {
          const showSectionTotal = section.sessions.length >= 2
          return (
            <div key={section.key}>
              {showSectionHeadings && (
                <h3 className="text-muted-foreground mb-2 text-sm font-semibold uppercase">
                  {section.label}
                </h3>
              )}
              <div className="border-border overflow-x-auto rounded-xl border">
                <table className="w-full border-collapse">
                  <ForecastTableHeader />
                  <tbody>
                    {section.sessions.map((s) => (
                      <SessionRow key={s.session_cm_id} session={s} />
                    ))}
                  </tbody>
                  {showSectionTotal && (
                    <tfoot>
                      <SessionRow session={section.total} isTotal />
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )
        })}

        {/* Grand total (standalone row when 2+ sections visible) */}
        {showGrandTotal && (
          <div className="border-border overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse">
              <tbody>
                <SessionRow session={grand_total} isTotal />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
