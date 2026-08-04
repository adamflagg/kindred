/**
 * /weekend/:sessionRef/:view? — one weekend's lodging roster.
 *
 * The reference is a readable slug (`fc1`, `ww`, `mw`) falling back to the
 * CampMinder id when two weekends would slug alike; the view is a path
 * segment so a tab can be linked and reloaded. See `weekendNames.ts`.
 *
 * Laid out as the summer session view is, one program over: a title that is
 * itself the session switcher, a sticky pill-tab nav, a contextual stats bar,
 * then the content. What diverges is the domain — parties into spaces rather
 * than campers into bunks, and share/housing requirements rather than bunk
 * requests.
 *
 * Placements are editable by drag inside a scenario, for a user holding
 * `bunking.manage` (#1989); with none selected the board is read-only for
 * everyone. WHERE they come from depends on the scenario picker — with none selected this is the
 * CampMinder mirror, and inside a scenario it is that scenario's own draft
 * rows, with the mirror not read at all (#1974). The registry behind it IS
 * editable, though — Phase C added the Manage -> Family Camp Lodging editor
 * (spec §3.8), and this page links bunking staff straight to it for
 * corrections to units, areas and cabin-name aliases.
 *
 * Everything rendered here is READ from ingest-derived columns. If a share
 * preference, proximity mode or request text looks wrong, the fix belongs in
 * the Go ingest so every surface sees the correction at once.
 */
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import {
  ArrowLeft,
  ChevronDown,
  Home,
  LayoutGrid,
  Map as MapIcon,
  Settings2,
  Users,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { QueryGuard } from '../components/QueryGuard'
import { Permission } from '../constants/permissions'
import {
  countBoardSlots,
  countMapUnits,
  countUnmeasuredSpaces,
  formatSessionDates,
  HouseholdRosterTable,
  LodgingBoard,
  LodgingMap,
  partyBeds,
  resolveWeekendRef,
  scenarioForWeekend,
  SeedScenarioNotice,
  shouldOfferSeed,
  shortWeekendName,
  sortWeekendsByDate,
  UnitInventoryPanel,
  weekendRef,
  WeekendScenarioPicker,
  WeekendStatsBar,
} from '../components/weekend'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { usePermissions } from '../hooks/usePermissions'
import { useScenario } from '../hooks/useScenario'
import { useWeekendRoster, useWeekendSessions } from '../hooks/useWeekendRoster'

type View = 'roster' | 'inventory' | 'board' | 'map'

const VIEWS: View[] = ['roster', 'inventory', 'board', 'map']

const DEFAULT_VIEW: View = 'roster'

/**
 * The view is a URL segment, as the analytics sub-navs are — `/analytics/
 * retention/flow`, not a query string. A tab held only in `useState` cannot be
 * linked, survive a reload, or be reopened where you left it.
 *
 * An unrecognised segment falls back rather than rendering nothing: it arrives
 * from a stale bookmark or a typo, and a blank panel reads as a broken page.
 */
function parseView(segment: string | undefined): View {
  return VIEWS.find((candidate) => candidate === segment) ?? DEFAULT_VIEW
}

export default function WeekendRosterPage() {
  const { sessionRef, view: viewParam } = useParams<{ sessionRef: string; view: string }>()
  const navigate = useNavigate()
  const { currentYear } = useCurrentYear()
  const { hasPermission } = usePermissions()
  const canManageLodging = hasPermission(Permission.BUNKING_MANAGE)
  const view = parseView(viewParam)

  const sessionsQuery = useWeekendSessions(currentYear)
  // Chronological, as the summer session picker is — CampMinder's sort_order
  // is manual and does not track the calendar.
  const sessions = sortWeekendsByDate(sessionsQuery.data?.sessions ?? [])

  // A NUMERIC reference resolves without the list; a slug cannot. Reading the
  // number directly keeps the roster fetch off the back of the sessions fetch,
  // which would otherwise be a waterfall on every load.
  const numericRef = /^\d+$/.test(sessionRef ?? '') ? Number(sessionRef) : null
  const resolved = resolveWeekendRef(sessions, sessionRef)
  const selectedCmId = resolved?.session_cm_id ?? numericRef

  // `useSavedScenarios` filters on `currentSessionId`. Left unset, the picker
  // would offer whatever session summer last looked at — the slot is global.
  const { currentScenario, loadScenarios } = useScenario()
  useEffect(() => {
    if (selectedCmId !== null) void loadScenarios(selectedCmId)
  }, [selectedCmId, loadScenarios])

  // SCOPED to this weekend: the context holds one selection for the whole app,
  // and a scenario belonging to another session must read as the mirror rather
  // than be passed through. See `weekendScenario.ts`.
  const scenario = scenarioForWeekend(currentScenario, selectedCmId)
  const rosterQuery = useWeekendRoster(currentYear, selectedCmId, scenario)

  // A slug with no list yet is UNRESOLVED, not unknown — but the title's
  // existing `sessionsQuery.isLoading` branch already says "Loading weekends…"
  // in exactly that gap, so there is nothing more to add here.

  const selectedSession = sessions.find((session) => session.session_cm_id === selectedCmId)
  const dates = selectedSession
    ? formatSessionDates(selectedSession.start_date, selectedSession.end_date)
    : ''

  // Memoised on the payload, not left to run per render. The `?? []` fallbacks
  // are inside the memo on purpose: a bare `?? []` mints a new array every
  // render while the roster is loading, which would defeat every dependency
  // list below it.
  const parties = useMemo(() => rosterQuery.data?.parties ?? [], [rosterQuery.data])
  const units = useMemo(() => rosterQuery.data?.units ?? [], [rosterQuery.data])

  // These two build a whole model to read a length — `countBoardSlots` indexes
  // the entire board, and `countMapUnits` builds the board AND the map model on
  // top of it. The header needs both counts on every tab, so unmemoised they
  // ran twice per render of this page no matter which view was showing.
  const boardSlotCount = useMemo(() => countBoardSlots(parties, units), [parties, units])
  const mapUnitCount = useMemo(() => countMapUnits(parties, units), [parties, units])
  const bedsNeeded = useMemo(
    () => parties.reduce((sum, party) => sum + partyBeds(party), 0),
    [parties]
  )
  const spacesUnmeasured = useMemo(() => countUnmeasuredSpaces(units), [units])

  const TABS: Array<{ id: View; label: string; icon: typeof Users; count: number }> = [
    { id: 'roster', label: 'Roster', icon: Users, count: parties.length },
    { id: 'inventory', label: 'Inventory', icon: Home, count: units.length },
    // The board counts the SLOT CARDS it draws, which is not the inventory
    // count: a container carries the beds its halves already report, so it
    // never gets a card and never counts.
    { id: 'board', label: 'Board', icon: LayoutGrid, count: boardSlotCount },
    { id: 'map', label: 'Map', icon: MapIcon, count: mapUnitCount },
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
              value={selectedSession ? weekendRef(selectedSession, sessions) : ''}
              onChange={(value: string) => {
                // CARRIES THE TAB. Switching weekends from inside one is how
                // you compare the same view across two of them; landing back
                // on the roster every time is what makes you use the lander
                // instead. PUSH, unlike the tabs: the weekend is the
                // destination, so Back belongs to it.
                void navigate(`/weekend/${value}/${view}`)
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
                      value={weekendRef(session, sessions)}
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

          {/* Mode + scenario, as summer's SessionHeader stacks them. The badge
              renders for everyone — a viewer needs to know they are looking at
              the CampMinder mirror — while the picker itself is gated. */}
          {selectedCmId !== null && (
            <WeekendScenarioPicker
              sessionCmId={selectedCmId}
              year={currentYear}
              canManage={canManageLodging}
              scenario={scenario}
            />
          )}

          {/* Gated on bunking.manage, which is what the lodging_* write rules
              gate on — an admin flag would let the wrong people in and keep
              bunking staff out. */}
          {canManageLodging && (
            <Link
              to="/manage/lodging/units"
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
                          // REPLACE, not push. Four tabs and a habit of
                          // clicking through them would turn Back into a tour
                          // of the tabs you just left; the weekend is the
                          // destination, the tab is where you are standing in
                          // it.
                          void navigate(`/weekend/${sessionRef ?? ''}/${tab.id}`, {
                            replace: true,
                          })
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
                bedsNeeded={bedsNeeded}
                spacesUnmeasured={spacesUnmeasured}
              />

              {/* A scenario REPLACES the mirror (#1974), so a fresh one draws
                  an empty board. Without this the page just looks broken. */}
              {canManageLodging &&
                selectedCmId !== null &&
                shouldOfferSeed(scenario, roster.counts) && (
                  <SeedScenarioNotice
                    year={currentYear}
                    sessionCmId={selectedCmId}
                    scenario={scenario}
                    partiesTotal={roster.counts?.parties_total ?? 0}
                  />
                )}
            </div>

            <div
              className="pt-4"
              role="tabpanel"
              id={`weekend-panel-${view}`}
              aria-labelledby={`weekend-tab-${view}`}
            >
              {view === 'roster' && (
                <HouseholdRosterTable parties={parties} year={currentYear} units={units} />
              )}
              {view === 'inventory' && <UnitInventoryPanel units={units} />}
              {view === 'board' && (
                <LodgingBoard
                  parties={parties}
                  units={units}
                  year={currentYear}
                  scenario={scenario}
                  sessionCmId={selectedCmId ?? 0}
                  canManage={canManageLodging}
                />
              )}
              {view === 'map' && (
                <LodgingMap
                  parties={parties}
                  units={units}
                  year={currentYear}
                  scenario={scenario}
                />
              )}
            </div>
          </>
        )}
      </QueryGuard>
    </div>
  )
}
