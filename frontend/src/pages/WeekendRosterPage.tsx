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
 * not edited. The registry behind it IS editable, though — Phase C added the
 * Admin -> Family Camp Lodging editor (spec §3.8), and this page links admins
 * straight to it for corrections to units, areas and cabin-name aliases.
 *
 * Everything rendered here is READ from ingest-derived columns. If a share
 * preference, proximity mode or request text looks wrong, the fix belongs in
 * the Go ingest so every surface sees the correction at once.
 */
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ArrowLeft, ChevronDown, Home, Settings2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { QueryGuard } from '../components/QueryGuard'
import {
  countUnmeasuredSpaces,
  formatSessionDates,
  HouseholdRosterTable,
  partyBeds,
  shortWeekendName,
  sortWeekendsByDate,
  UnitInventoryPanel,
  WeekendStatsBar,
} from '../components/weekend'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { usePermissions } from '../hooks/usePermissions'
import { useWeekendRoster, useWeekendSessions } from '../hooks/useWeekendRoster'

type View = 'roster' | 'inventory'

export default function WeekendRosterPage() {
  const { sessionCmId } = useParams<{ sessionCmId: string }>()
  const navigate = useNavigate()
  const { currentYear } = useCurrentYear()
  const { isAdmin } = usePermissions()
  const [view, setView] = useState<View>('roster')

  const selectedCmId = sessionCmId === undefined ? null : Number(sessionCmId)
  const sessionsQuery = useWeekendSessions(currentYear)
  const rosterQuery = useWeekendRoster(currentYear, selectedCmId)

  // Chronological, as the summer session picker is — CampMinder's sort_order
  // is manual and does not track the calendar.
  const sessions = sortWeekendsByDate(sessionsQuery.data?.sessions ?? [])
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
          to="/weekend/sessions"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All weekends
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          {/* The weekend IS the title, and the title IS the switcher — the
              same move the summer session header makes with its session
              dropdown. */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <Home className="text-primary h-5 w-5 flex-shrink-0 sm:h-6 sm:w-6" />
            <Listbox
              value={selectedCmId === null ? '' : String(selectedCmId)}
              onChange={(value: string) => {
                void navigate(`/weekend/session/${value}`)
              }}
            >
              <div className="relative">
                <ListboxButton className="font-display hover:text-primary flex cursor-pointer items-center gap-1 bg-transparent text-xl font-bold transition-colors focus:outline-none sm:text-2xl">
                  {selectedSession
                    ? shortWeekendName(selectedSession.name)
                    : sessionsQuery.isLoading
                      ? 'Loading weekends…'
                      : 'Weekend not found'}
                  <ChevronDown className="text-muted-foreground h-4 w-4" />
                </ListboxButton>
                <ListboxOptions className="listbox-options w-auto min-w-[220px]">
                  {sessions.map((session) => (
                    <ListboxOption
                      key={session.session_cm_id}
                      value={String(session.session_cm_id)}
                      className="listbox-option py-1.5"
                    >
                      {shortWeekendName(session.name)}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
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

          {/* Restored now that Phase C registers /admin/lodging. It was pulled
              in 03754754 because App.tsx's path="*" silently bounced the user
              home when the route did not exist. */}
          {isAdmin && (
            <Link
              to="/admin/lodging/units"
              className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1.5 text-sm transition-colors"
            >
              <Settings2 className="h-4 w-4" />
              Lodging settings
            </Link>
          )}
        </div>
      </header>

      <QueryGuard
        isLoading={rosterQuery.isLoading}
        error={rosterQuery.error}
        data={rosterQuery.data}
        label="weekend roster"
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
