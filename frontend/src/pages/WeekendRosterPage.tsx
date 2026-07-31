/**
 * /weekend/session/:sessionCmId — one weekend's lodging roster.
 *
 * Laid out as the summer session view is, one program over: a title that is
 * itself the session switcher, a sticky pill-tab nav, a contextual stats bar,
 * then the content. What diverges is the domain — parties into spaces rather
 * than campers into bunks, and share/housing requirements rather than bunk
 * requests.
 *
 * Read-only in this slice: assignments come from CampMinder and are shown,
 * not edited. The registry behind it IS editable, at Admin -> Family Camp
 * Lodging, because a seed nobody can correct is worthless (spec §3.8).
 *
 * Everything rendered here is READ from ingest-derived columns. If a share
 * preference, proximity mode or request text looks wrong, the fix belongs in
 * the Go ingest so every surface sees the correction at once.
 */
import { ArrowLeft, ChevronDown, Home, Settings, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { QueryGuard } from '../components/QueryGuard'
import {
  countUnmeasuredSpaces,
  formatSessionDates,
  HouseholdRosterTable,
  partyBeds,
  UnitInventoryPanel,
  WeekendStatsBar,
} from '../components/weekend'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { useWeekendRoster, useWeekendSessions } from '../hooks/useWeekendRoster'

type View = 'roster' | 'inventory'

export default function WeekendRosterPage() {
  const { sessionCmId } = useParams<{ sessionCmId: string }>()
  const navigate = useNavigate()
  const { currentYear } = useCurrentYear()
  const [view, setView] = useState<View>('roster')

  const selectedCmId = sessionCmId === undefined ? null : Number(sessionCmId)
  const sessionsQuery = useWeekendSessions(currentYear)
  const rosterQuery = useWeekendRoster(currentYear, selectedCmId)

  const sessions = sessionsQuery.data?.sessions ?? []
  const selectedSession = sessions.find((session) => session.session_cm_id === selectedCmId)
  const dates = selectedSession
    ? formatSessionDates(selectedSession.start_date, selectedSession.end_date)
    : ''

  const parties = rosterQuery.data?.parties ?? []
  const units = rosterQuery.data?.units ?? []

  const TABS: Array<{ id: View; label: string; icon: typeof Users; count: number }> = [
    { id: 'roster', label: 'Roster', icon: Users, count: parties.length },
    { id: 'inventory', label: 'Inventory', icon: Home, count: units.length },
  ]

  return (
    <div>
      <header className="flex flex-col gap-2 pb-2">
        <Link
          to="/weekend"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All weekends
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          {/* The weekend IS the title, and the title IS the switcher — the
              same move the summer session header makes with its session
              dropdown. */}
          <div className="relative flex min-w-0 items-center">
            <select
              aria-label="Weekend"
              value={selectedCmId === null ? '' : String(selectedCmId)}
              onChange={(event) => {
                void navigate(`/weekend/session/${event.target.value}`)
              }}
              className="font-display hover:text-primary cursor-pointer appearance-none bg-transparent pr-7 text-xl font-bold transition-colors focus:outline-none sm:text-2xl"
            >
              {selectedSession === undefined && (
                <option value="">
                  {sessionsQuery.isLoading ? 'Loading weekends…' : 'Weekend not found'}
                </option>
              )}
              {sessions.map((session) => (
                <option key={session.session_cm_id} value={String(session.session_cm_id)}>
                  {session.name}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute right-1 h-4 w-4"
            />
          </div>

          {dates.length > 0 && <span className="text-muted-foreground text-sm">{dates}</span>}
          {selectedSession && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                selectedSession.session_type === 'adult'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                  : 'bg-forest-100 text-forest-700 dark:bg-forest-900/50 dark:text-forest-300'
              }`}
            >
              {selectedSession.session_type === 'adult' ? 'Adult' : 'Family'}
            </span>
          )}

          <Link
            to="/admin/lodging"
            className="btn-secondary ml-auto flex items-center gap-1.5 px-3 py-2 text-sm"
          >
            <Settings className="h-4 w-4" />
            Lodging settings
          </Link>
        </div>
      </header>

      <QueryGuard
        isLoading={rosterQuery.isLoading}
        error={rosterQuery.error}
        data={rosterQuery.data}
        label="weekend roster"
        emptyMessage="No roster data for this weekend."
      >
        {(roster) => (
          <>
            {/* Unified navigation region — tabs + contextual stats, sticky,
                exactly as the summer session view stacks them. */}
            <div className="bg-background/95 sticky top-0 z-10 backdrop-blur-sm">
              <nav className="border-border/50 border-b py-2" aria-label="View">
                <div className="flex flex-wrap items-center gap-1.5" role="tablist">
                  {TABS.map((tab) => {
                    const Icon = tab.icon
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`weekend-tab-${tab.id}`}
                        aria-selected={view === tab.id}
                        aria-controls={`weekend-panel-${tab.id}`}
                        onClick={() => {
                          setView(tab.id)
                        }}
                        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                          view === tab.id
                            ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                            : 'text-muted-foreground hover:text-foreground hover:bg-forest-50/50 dark:hover:bg-forest-950/30'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>
                          {tab.label} ({tab.count})
                        </span>
                      </button>
                    )
                  })}
                </div>
              </nav>

              <WeekendStatsBar
                counts={roster.counts ?? {}}
                bedsNeeded={parties.reduce((sum, party) => sum + partyBeds(party), 0)}
                spacesUnmeasured={countUnmeasuredSpaces(units)}
              />
            </div>

            <div
              className="pt-4"
              role="tabpanel"
              id={`weekend-panel-${view}`}
              aria-labelledby={`weekend-tab-${view}`}
            >
              {view === 'roster' ? (
                <HouseholdRosterTable parties={parties} year={currentYear} units={units} />
              ) : (
                <UnitInventoryPanel units={units} />
              )}
            </div>
          </>
        )}
      </QueryGuard>
    </div>
  )
}
