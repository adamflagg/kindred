/**
 * /weekend/sessions — the family & adult weekend lander.
 *
 * Deliberately the same page as the summer sessions lander, one program over:
 * forest gradient header with aggregate figures, then rows grouped by
 * lifecycle. Where it diverges is what a row counts. Summer counts campers
 * into bunks; a weekend places whole PARTIES into whole SPACES — a family
 * holds a cabin whether or not it fills it — so the figures are parties and
 * spaces, not people and beds.
 *
 * Per-weekend figures arrive in ONE request. Calling the roster endpoint per
 * weekend meant twelve composed reads whose cost is dominated by year-scoped
 * work identical across all of them — a weekend with zero parties still took
 * ~3s — so `/api/lodging/summary` does that work once for the year.
 */
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Home,
  PlayCircle,
  Tent,
  Users,
} from 'lucide-react'
import { Link } from 'react-router'

import { QueryGuard } from '../components/QueryGuard'
import {
  formatSessionDates,
  groupWeekends,
  splitWeekendName,
  todayKey,
} from '../components/weekend'
import type { WeekendStatus } from '../components/weekend'
import { getCampNameShort } from '../config/branding'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { useWeekendSummary } from '../hooks/useWeekendRoster'
import type { RosterCountSummary, WeekendSession } from '../types/lodging'

interface WeekendStats {
  parties: number
  placed: number
  unplaced: number
  spaces: number
}

function statsFrom(counts: RosterCountSummary): WeekendStats {
  return {
    parties: counts.parties_total ?? 0,
    placed: counts.parties_assigned ?? 0,
    unplaced: counts.parties_unassigned ?? 0,
    spaces: counts.units_family_available ?? 0,
  }
}

const STATUS_STYLE: Record<
  WeekendStatus,
  { label: string; subtitle: string; bg: string; border: string; text: string; iconBg: string }
> = {
  'in-progress': {
    label: 'Happening now',
    subtitle: 'Families are on site',
    bg: 'bg-green-50 dark:bg-green-900/50',
    border: 'border-green-200 dark:border-green-700',
    text: 'text-green-700 dark:text-green-200',
    iconBg: 'bg-green-100 dark:bg-green-700',
  },
  upcoming: {
    label: 'Upcoming',
    subtitle: 'Ready for cabin assignment',
    bg: 'bg-forest-50 dark:bg-forest-900/50',
    border: 'border-forest-200 dark:border-forest-700',
    text: 'text-forest-700 dark:text-forest-200',
    iconBg: 'bg-forest-100 dark:bg-forest-700',
  },
  completed: {
    label: 'Completed',
    subtitle: 'Weekend finished',
    bg: 'bg-stone-50 dark:bg-stone-800/60',
    border: 'border-stone-200 dark:border-stone-600',
    text: 'text-stone-600 dark:text-stone-300',
    iconBg: 'bg-stone-100 dark:bg-stone-700',
  },
}

function StatusSectionHeader({ status, count }: { status: WeekendStatus; count: number }) {
  const style = STATUS_STYLE[status]
  const Icon = status === 'completed' ? CheckCircle2 : status === 'in-progress' ? PlayCircle : Tent
  return (
    <div className={`flex items-center gap-3 border-b px-4 py-2.5 ${style.bg} ${style.border}`}>
      <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${style.iconBg}`}>
        <Icon className={`h-4 w-4 ${style.text}`} />
      </div>
      <div className="min-w-0">
        <h2 className={`text-sm font-bold ${style.text}`}>
          {style.label}
          <span className="ml-2 font-semibold tabular-nums opacity-70">{count}</span>
        </h2>
        <p className="text-muted-foreground text-xs">{style.subtitle}</p>
      </div>
    </div>
  )
}

function WeekendRow({
  session,
  status,
  stats,
}: {
  session: WeekendSession
  status: WeekendStatus
  stats: WeekendStats | undefined
}) {
  const isCompleted = status === 'completed'
  const isAdult = session.session_type === 'adult'
  const dates = formatSessionDates(session.start_date, session.end_date)
  const { short, qualifier } = splitWeekendName(session.name)

  return (
    <Link
      to={`/weekend/session/${String(session.session_cm_id)}`}
      className={`group hover:bg-forest-50/50 dark:hover:bg-forest-800/40 block transition-all duration-200 ${
        isCompleted ? 'opacity-70 hover:opacity-100' : ''
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${
            isCompleted
              ? 'bg-stone-100 dark:bg-stone-700/80'
              : isAdult
                ? 'bg-amber-100 dark:bg-amber-800/60'
                : 'bg-forest-100 dark:bg-forest-800/60'
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 className="h-4 w-4 text-stone-500 sm:h-5 sm:w-5 dark:text-stone-400" />
          ) : isAdult ? (
            <Users className="h-4 w-4 text-amber-600 sm:h-5 sm:w-5 dark:text-amber-400" />
          ) : (
            <Tent className="text-forest-600 dark:text-forest-400 h-4 w-4 sm:h-5 sm:w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`font-display group-hover:text-primary truncate text-base font-semibold transition-colors sm:text-lg ${
                isCompleted ? 'text-stone-600 dark:text-stone-400' : 'text-foreground'
              }`}
            >
              {short}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                isAdult
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                  : 'bg-forest-100 text-forest-700 dark:bg-forest-900/50 dark:text-forest-300'
              }`}
            >
              {isAdult ? 'Adult' : 'Family'}
            </span>
            {status === 'in-progress' && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/50 dark:text-green-300">
                LIVE
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {dates.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3 w-3 flex-shrink-0" />
                {dates}
              </span>
            )}
            {/* The half of the CampMinder name that says what the weekend is,
                given the row's spare width rather than crammed into the title. */}
            {qualifier.length > 0 && <span className="truncate">{qualifier}</span>}
          </div>
        </div>

        {stats ? (
          <>
            {/* Parties placed */}
            <div className="hidden w-[150px] flex-shrink-0 items-center justify-end gap-1.5 text-sm sm:flex">
              <Users className="text-primary h-4 w-4 flex-shrink-0" />
              <span className="tabular-nums">
                <span className="font-semibold">{stats.placed}</span>
                <span className="text-muted-foreground">/{stats.parties}</span>
              </span>
              <span className="text-muted-foreground text-xs">placed</span>
            </div>

            {/* Spaces — what a party occupies whole */}
            <div className="hidden w-[120px] flex-shrink-0 items-center justify-center gap-1.5 text-sm sm:flex">
              <Home className="text-bark-500 dark:text-bark-400 h-4 w-4 flex-shrink-0" />
              <span className="tabular-nums">{stats.spaces}</span>
              <span className="text-muted-foreground text-xs">spaces</span>
            </div>

            <div className="hidden w-[110px] items-center justify-end sm:flex">
              {stats.unplaced > 0 && status !== 'completed' && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  <AlertCircle className="h-3 w-3" />
                  {stats.unplaced} need a cabin
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="hidden w-[380px] flex-shrink-0 items-center justify-center sm:flex">
            <div className="spinner-lodge h-4 w-4" />
          </div>
        )}

        <ChevronRight className="text-muted-foreground group-hover:text-primary h-5 w-5 flex-shrink-0 transition-colors" />
      </div>
    </Link>
  )
}

export default function WeekendSessionList() {
  const { currentYear } = useCurrentYear()
  // One request for the whole lander: identities and counts together.
  const summaryQuery = useWeekendSummary(currentYear)
  const entries = summaryQuery.data?.weekends ?? []
  const sessions = entries.map((entry) => entry.session)

  const today = todayKey(new Date())
  const groups = groupWeekends(sessions, today)
  const statsByCmId = new Map<number, WeekendStats>(
    entries.map((entry) => [entry.session.session_cm_id, statsFrom(entry.counts)])
  )

  const totalParties = entries.reduce((sum, entry) => sum + (entry.counts.parties_total ?? 0), 0)
  const totalUnplaced = [...groups.inProgress, ...groups.upcoming].reduce(
    (sum, session) => sum + (statsByCmId.get(session.session_cm_id)?.unplaced ?? 0),
    0
  )

  const ordered: Array<[WeekendStatus, WeekendSession[]]> = [
    ['in-progress', groups.inProgress],
    ['upcoming', groups.upcoming],
    ['completed', groups.completed],
  ]

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="from-forest-700 to-forest-800 rounded-xl bg-gradient-to-r px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="rounded-lg bg-white/10 p-1.5 sm:p-2">
              <Home className="h-5 w-5 text-amber-400 sm:h-6 sm:w-6" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white sm:text-xl">
                {getCampNameShort()} Weekends
              </h1>
              <p className="text-forest-200 text-xs sm:text-sm">
                {currentYear} family &amp; adult weekends
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="text-right">
              <div className="font-display text-xl font-bold text-white tabular-nums sm:text-2xl">
                {totalParties}
              </div>
              <div className="text-forest-300 text-xs">
                <span className="hidden sm:inline">total </span>parties
              </div>
            </div>
            {totalUnplaced > 0 && (
              <div className="text-right">
                <div className="font-display text-xl font-bold text-amber-400 tabular-nums sm:text-2xl">
                  {totalUnplaced}
                </div>
                <div className="text-forest-300 text-xs">
                  <span className="hidden sm:inline">need a </span>cabin
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <QueryGuard
        isLoading={summaryQuery.isLoading}
        error={summaryQuery.error}
        data={summaryQuery.data}
        label="weekend sessions"
        emptyMessage="No family or adult sessions found for this year."
      >
        {() =>
          sessions.length === 0 ? (
            <div className="dark:bg-card flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-8 py-16 text-center dark:border-stone-600">
              <div className="bg-muted/50 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
                <Home className="text-muted-foreground h-8 w-8" />
              </div>
              <h2 className="font-display mb-2 text-xl font-semibold">No weekends found</h2>
              <p className="text-muted-foreground max-w-sm text-sm">
                Family and adult weekends appear here once sessions sync from CampMinder.
              </p>
            </div>
          ) : (
            <div className="dark:bg-card overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-700">
              {ordered.map(([status, group]) =>
                group.length === 0 ? null : (
                  <div key={status}>
                    <StatusSectionHeader status={status} count={group.length} />
                    {group.map((session) => (
                      <div
                        key={session.session_cm_id}
                        className="border-b border-stone-200/80 last:border-b-0 dark:border-stone-700/80"
                      >
                        <WeekendRow
                          session={session}
                          status={status}
                          stats={statsByCmId.get(session.session_cm_id)}
                        />
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )
        }
      </QueryGuard>
    </div>
  )
}
