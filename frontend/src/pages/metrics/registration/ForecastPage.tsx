import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { MINUS, formatCount, formatPercent, formatSignedCount } from '../../../utils/numberFormat'
import { Loader2 } from 'lucide-react'
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
import {
  isMainOrEmbedded,
  isAgSession,
  isQuestSession,
  isTeenProgram,
} from '../../../utils/sessionTypePredicates'
import { sessionName } from '../../../utils/sessionName'
import { buildForecastSections } from '../../../utils/forecastUtils'
import { resolveWeekOffset } from '../../../utils/resolveWeekOffset'
import type { SessionForecast } from '../../../types/forecast'
import { DefinitionNotes, DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import {
  PRIORITY_DAY_NOTE,
  PRIORITY_DAY_NOTES,
  PRIORITY_DAY_PENDING,
  PRIORITY_DAY_PENDING_CLASS,
  isPriorityDayOffset,
  readsThroughNextDay,
} from '../../../utils/priorityDay'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'
import { deltaInk } from '../../../utils/deltaTokens'
import { useTableSort } from '../../../hooks/useTableSort'
import { MetricSortHeader } from '../../../components/metrics/MetricSortHeader'
import { TableExportButtons } from '../../../components/metrics/TableExportButtons'
import { csvFilename } from '../../../components/metrics/exportFilename'
import type { SortValue } from '../../../utils/tableSort'

type ForecastField =
  | 'name'
  | 'goal'
  | 'enrolled'
  | 'waitlisted'
  | 'pctGoal'
  | 'vsBudget'
  | 'prior'
  | 'vsPrior'
  | 'twoYear'
  | 'budgetRev'
  | 'actualRev'
  | 'revDelta'
  | 'revPct'

interface ForecastSort {
  direction: (field: ForecastField) => 'ascending' | 'descending' | null
  toggle: (field: ForecastField) => void
}

function forecastSortValue(s: SessionForecast, field: ForecastField): SortValue {
  switch (field) {
    case 'name':
      return sessionName(s.session_name, undefined, 'short')
    case 'goal':
      return s.participant_goal
    case 'enrolled':
      return s.enrolled
    case 'waitlisted':
      return s.waitlisted
    case 'pctGoal':
      return s.pct_of_goal
    case 'vsBudget':
      return s.participants_vs_budget
    case 'prior':
      return s.prior_year_count
    case 'vsPrior':
      return s.participants_vs_prior_year
    case 'twoYear':
      return s.two_year_prior_count
    case 'budgetRev':
      return s.budget_revenue
    case 'actualRev':
      return s.actual_revenue
    case 'revDelta':
      return s.revenue_delta
    case 'revPct':
      return s.revenue_pct
  }
}

function pctColor(pct: number | null): string {
  if (pct === null) return ''
  if (pct >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function fmt(value: number | null, suffix = ''): string {
  if (value === null) return '---'
  return `${formatCount(value)}${suffix}`
}

function deltaColor(value: number | null): string {
  return deltaInk(value ?? 0, 'up-good')
}

function fmtSigned(value: number | null): string {
  if (value === null) return '---'
  return formatSignedCount(value)
}

function fmtSignedCurrency(value: number | null): string {
  if (value === null) return '---'
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  if (value > 0) return `+$${abs}`
  if (value < 0) return `${MINUS}$${abs}`
  return `$${abs}`
}

function fmtCurrency(value: number | null): string {
  if (value === null) return '---'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(value: number | null): string {
  if (value === null) return '---'
  return formatPercent(value)
}

function ForecastTableHeader({
  priorBasis,
  priorityDay,
  sort,
}: {
  priorBasis: 'same_point' | 'final'
  /** The prior columns are read through the next day: a priority, early or open date (decision 45). */
  priorityDay: boolean
  sort: ForecastSort
}) {
  const mark = priorityDay ? <DefRef n={1} title={PRIORITY_DAY_NOTE} /> : null
  const h = (
    label: string,
    field: ForecastField,
    align: 'left' | 'right' = 'right',
    hide = false,
    suffix?: ReactNode
  ) => (
    <MetricSortHeader
      bare
      label={label}
      labelSuffix={suffix}
      align={align}
      direction={sort.direction(field)}
      onSort={() => sort.toggle(field)}
      className={`${hide ? 'hidden lg:table-cell' : ''} px-3 py-2 text-${align} text-xs font-semibold`}
    />
  )
  return (
    <thead>
      <tr className="bg-muted/50">
        {h('Session', 'name', 'left')}
        {h('Goal', 'goal')}
        {h('Enrolled', 'enrolled')}
        <th className="px-3 py-2 text-right text-xs font-semibold">B / G</th>
        {h('WL', 'waitlisted')}
        {h('% Goal', 'pctGoal')}
        {h('vs Budget', 'vsBudget')}
        {h('Prior Yr', 'prior', 'right', false, mark)}
        {h(priorBasis === 'same_point' ? 'vs same point' : 'vs final', 'vsPrior')}
        {h('2yr Prior', 'twoYear', 'right', false, mark)}
        {h('Budget Rev', 'budgetRev', 'right', true)}
        {h('Actual Rev', 'actualRev', 'right', true)}
        {h('Delta $', 'revDelta', 'right', true)}
        {h('Rev%', 'revPct', 'right', true)}
      </tr>
    </thead>
  )
}

function SessionRow({
  session,
  isTotal,
  deltaPending = false,
}: {
  session: SessionForecast
  isTotal?: boolean
  /** On the priority date itself the same-point delta reads "updates tomorrow" (ruling 9). */
  deltaPending?: boolean
}) {
  const rowClass = isTotal ? 'font-bold bg-muted/30' : 'border-border border-b last:border-b-0'

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2 text-sm whitespace-nowrap">
        {sessionName(session.session_name, undefined, 'short')}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.participant_goal)}</td>
      <td className="px-3 py-2 text-right text-sm font-medium">{formatCount(session.enrolled)}</td>
      <td className="px-3 py-2 text-right text-sm whitespace-nowrap">
        {session.enrolled_boys !== null && session.enrolled_girls !== null ? (
          <>
            <span className="text-blue-800 dark:text-blue-300">
              {formatCount(session.enrolled_boys)}
            </span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-pink-800 dark:text-pink-300">
              {formatCount(session.enrolled_girls)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">--</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm">{fmt(session.waitlisted)}</td>
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
        {deltaPending && session.participants_vs_prior_year !== null ? (
          <span className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</span>
        ) : (
          fmtSigned(session.participants_vs_prior_year)
        )}
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

function forecastCsvHeaders(priorBasis: 'same_point' | 'final', withSection: boolean): string[] {
  return [
    ...(withSection ? ['Section'] : []),
    'Session',
    'Goal',
    'Enrolled',
    'Boys',
    'Girls',
    'Waitlisted',
    '% Goal',
    'vs Budget',
    'Prior Yr',
    priorBasis === 'same_point' ? 'vs same point' : 'vs final',
    '2yr Prior',
    'Budget Rev',
    'Actual Rev',
    'Delta $',
    'Rev %',
  ]
}

/** Every section's rows in the order on screen, each section's Total after it, the grand total last. */
function forecastCsvRows(
  sections: ReadonlyArray<{ label: string; sessions: SessionForecast[]; total: SessionForecast }>,
  withSection: boolean,
  withGrandTotal: boolean,
  grandTotal: SessionForecast,
  deltaPending: boolean
): Array<Array<string | number | null>> {
  const line = (section: string, name: string, s: SessionForecast) => [
    ...(withSection ? [section] : []),
    name,
    s.participant_goal,
    s.enrolled,
    s.enrolled_boys,
    s.enrolled_girls,
    s.waitlisted,
    s.pct_of_goal,
    s.participants_vs_budget,
    s.prior_year_count,
    deltaPending ? null : s.participants_vs_prior_year,
    s.two_year_prior_count,
    s.budget_revenue,
    s.actual_revenue,
    s.revenue_delta,
    s.revenue_pct,
  ]
  const out: Array<Array<string | number | null>> = []
  for (const section of sections) {
    for (const s of section.sessions) {
      out.push(line(section.label, sessionName(s.session_name, undefined, 'short'), s))
    }
    if (section.sessions.length >= 2) out.push(line(section.label, 'Total', section.total))
  }
  if (withGrandTotal) out.push(line('', 'Grand total', grandTotal))
  return out
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
  const sort = useTableSort<ForecastField>('name')
  const { data: weekOptions = [] } = useWeekOptions(currentYear)

  // Always know "today's week" from the latest (current) season — React Query
  // deduplicates when currentYear === latestYear, so no extra fetch in that case
  const latestYear = Math.max(0, ...availableYears)
  const { data: latestYearOptions = [] } = useWeekOptions(latestYear)
  const todayWeek = latestYearOptions.find((o) => o.is_today)?.week_number ?? null
  // Live mode (no week picked) reads at Today's offset in the selected season.
  const todayOffset = weekOptions.find((o) => o.is_today)?.day_offset ?? null

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

  const { data, isLoading, error, refetch, isPlaceholderData } = useForecast(currentYear, {
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

  const teenSessions = useMemo(() => (data ? data.sessions.filter(isTeenProgram) : []), [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading forecast data...</span>
      </div>
    )
  }

  if (error) {
    return <MetricsLoadError label="forecast" error={error} onRetry={() => void refetch()} />
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
  const thisYearOffset = data.day_offset ?? todayOffset
  // Ruling 9: only the priority date itself waits a day for this year's data.
  const deltaPending = data.prior_basis === 'same_point' && isPriorityDayOffset(thisYearOffset)

  const sections = buildForecastSections(
    campSessions,
    questSessions,
    teenSessions,
    data.section_priors
  ).map((section) => ({
    ...section,
    // A pending vs-prior cell reads "updates tomorrow" and is blank in the CSV, so it sorts as a blank.
    sessions: sort.apply(section.sessions, (row, field) =>
      deltaPending && field === 'vsPrior' ? null : forecastSortValue(row, field)
    ),
  }))
  const showSectionHeadings = sections.length >= 2
  const showGrandTotal = sections.length >= 2 && selectedSessionCmId === null
  const priorityDay =
    data.prior_basis === 'same_point' && readsThroughNextDay(thisYearOffset, data.prior_day_offset)

  return (
    <MetricsBusy busy={isPlaceholderData} what={String(currentYear)}>
      <div className="space-y-6">
        <div data-tour="reg-forecast-snapshot">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold">Enrollment Forecast</h2>
            {grand_total.participant_goal !== null && grand_total.participant_goal > 0 && (
              <span className="text-muted-foreground text-sm">
                <span className="text-foreground font-medium">
                  {formatCount(grand_total.enrolled)}/{formatCount(grand_total.participant_goal)}
                </span>
                {' enrolled'}
                {grand_total.pct_of_goal !== null && (
                  <span className={`ml-1 font-medium ${pctColor(grand_total.pct_of_goal)}`}>
                    ({formatPercent(grand_total.pct_of_goal)} of goal)
                  </span>
                )}
              </span>
            )}
            <div className="ml-auto flex items-center gap-3">
              <TableExportButtons
                filename={csvFilename(currentYear, 'Enrollment Forecast')}
                headers={forecastCsvHeaders(data.prior_basis, showSectionHeadings)}
                rows={forecastCsvRows(
                  sections,
                  showSectionHeadings,
                  showGrandTotal,
                  grand_total,
                  deltaPending
                )}
              />
              <div data-app-chrome>
                <SnapshotDateSelector
                  dayOffset={dayOffset}
                  onOffsetChange={setDayOffset}
                  weekOptions={weekOptions}
                />
              </div>
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
                    <ForecastTableHeader
                      priorBasis={data.prior_basis}
                      priorityDay={priorityDay}
                      sort={sort}
                    />
                    <tbody>
                      {section.sessions.map((s) => (
                        <SessionRow
                          key={`${s.session_type}-${s.session_cm_id}`}
                          session={s}
                          deltaPending={deltaPending}
                        />
                      ))}
                    </tbody>
                    {showSectionTotal && (
                      <tfoot>
                        <SessionRow session={section.total} isTotal deltaPending={deltaPending} />
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
                  <SessionRow session={grand_total} isTotal deltaPending={deltaPending} />
                </tbody>
              </table>
            </div>
          )}
        </div>

        {priorityDay && <DefinitionNotes notes={PRIORITY_DAY_NOTES} />}
      </div>
    </MetricsBusy>
  )
}
