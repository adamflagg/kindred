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
 * (spec §3.8), which is where corrections to units, areas and cabin-name
 * aliases belong. The header no longer shortcuts to it, as summer's does not.
 *
 * Everything rendered here is READ from ingest-derived columns. If a share
 * preference, proximity mode or request text looks wrong, the fix belongs in
 * the Go ingest so every surface sees the correction at once.
 */
import { Home, Map as MapIcon, Users } from 'lucide-react'
import { Activity, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { ErrorBoundary } from '../components/ErrorBoundary'
import { QueryGuard } from '../components/QueryGuard'
import { TitleSwitcher } from '../components/ui'
import { Permission } from '../constants/permissions'
import {
  countBoardSlots,
  countMapUnits,
  countUnmeasuredSpaces,
  HouseholdRosterTable,
  partyBeds,
  resolveWeekendRef,
  scenarioForWeekend,
  SeedScenarioNotice,
  shouldOfferSeed,
  shortWeekendName,
  sortWeekendsByDate,
  weekendRef,
  WeekendScenarioPicker,
  WeekendStatsBar,
} from '../components/weekend'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { usePermissions } from '../hooks/usePermissions'
import { useScenario } from '../hooks/useScenario'
import { useWeekendRoster, useWeekendSessions } from '../hooks/useWeekendRoster'

/**
 * Imported by DIRECT PATH, never through `../components/weekend` (#1964). A
 * `lazy()` that resolves through the barrel pulls the barrel's whole export
 * surface — and everything it re-exports — into the lazy chunk, which
 * defeats the split entirely: `WeekendSessionList` also imports from the
 * barrel, so anything reachable through it is hoisted into a chunk shared
 * with the lander and shipped there too.
 *
 * `countBoardSlots` / `countMapUnits` stay eager imports above, straight from
 * the barrel — pure functions the header needs on every tab, not components.
 */
const LodgingBoard = lazy(() =>
  import('../components/weekend/LodgingBoard').then((m) => ({ default: m.LodgingBoard }))
)
const LodgingMap = lazy(() =>
  import('../components/weekend/LodgingMap').then((m) => ({ default: m.LodgingMap }))
)

/**
 * A bare `null` fallback (the modal precedent elsewhere in this codebase) is
 * fine for something that pops over existing content; this is the whole tab
 * panel, open long enough on a slow connection to read as a broken page
 * without something in it. Same treatment as `FriendGroupsView`'s graph load.
 */
function TabLoadingFallback() {
  return (
    <div
      className="flex min-h-[400px] items-center justify-center"
      data-testid="lodging-view-loading"
    >
      <div className="spinner-lodge" />
    </div>
  )
}

/**
 * `housing`, not `board`. Summer names its board tab after what is being
 * assigned — Bunks — rather than after the widget, and this follows it. The
 * COMPONENT stays `LodgingBoard`, exactly as summer's Bunks tab renders
 * `BunkingBoardByArea`: the board is still a board internally.
 *
 * The rename took the URL with it and left no alias, so a `/board` link just
 * falls through to `DEFAULT_VIEW`. Deliberate — the surface is young, and a
 * permanent redirect for a segment that lived a few weeks is a cost paid
 * forever. That the default is now Housing, the very tab `board` used to name,
 * is a happy accident rather than a route: the URL is left exactly as the
 * bookmark wrote it.
 */
type View = 'roster' | 'housing' | 'map'

/** Tab order. `DEFAULT_VIEW` is a separate choice — see below. */
const VIEWS: View[] = ['housing', 'roster', 'map']

/**
 * Housing, not the roster: the tab strip already leads with it, as summer's
 * leads with Bunks, and placing families is what staff open a weekend to do.
 * Landing on the second tab put the lead tab one click away from the work.
 *
 * `parseView` uses this for an unrecognised segment as well as a missing one,
 * deliberately — a typo should land where a fresh visit lands, not somewhere
 * else again.
 */
const DEFAULT_VIEW: View = 'housing'

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
  // Gated on bunking.manage, which is what the lodging_* write rules gate on —
  // an admin flag would let the wrong people in and keep bunking staff out.
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

  /**
   * A view is added the first time it becomes active and never removed —
   * mirroring what `<Activity mode="hidden">` itself does below: once a tab
   * has been opened, it stays mounted rather than being torn down and
   * rebuilt on every switch away (#2004).
   *
   * Adjusted DURING render, not in a `useEffect` — the "storing information
   * from previous renders" pattern the React docs give for exactly this
   * shape (https://react.dev/reference/react/useState#storing-information-from-previous-renders):
   * deriving state from a prop that just changed, without paying for an
   * extra commit-then-effect-then-rerender round trip that would flash the
   * newly-opened tab's panel empty for a frame first. `openedViews.has(view)`
   * is already self-terminating — once `view` has been added, the condition
   * is false on the very next render, so it doubles as its own "did this
   * change since last render" check with nothing extra to track. (An earlier
   * draft kept a separate `renderedView` state purely to notice the change;
   * that state read nothing else and existed only to gate a call that already
   * gates itself, so it's gone.)
   *
   * GATING ON THIS, rather than wrapping all three panels in `Activity`
   * unconditionally, is what keeps a never-opened tab from paying for its
   * lazy chunk: `Activity`'s hidden mode still mounts and commits hidden
   * content (that is the point — it is what lets a return to it skip the
   * fallback), so an ungated `Activity` around `LodgingBoard`/`LodgingMap`
   * would fetch BOTH chunks on first paint no matter which tab is showing,
   * silently undoing the code-split #2057 built.
   */
  const [openedViews, setOpenedViews] = useState<Set<View>>(() => new Set([view]))
  if (!openedViews.has(view)) {
    setOpenedViews(new Set(openedViews).add(view))
  }

  // Housing first, as summer leads with Bunks.
  const TABS: Array<{ id: View; label: string; icon: typeof Users; count: number }> = [
    // Counts the SLOT CARDS the board draws, not the raw unit count: a
    // container carries the beds its halves already report, so it never gets
    // a card and never counts.
    //
    // The house is summer's icon for the same tab — its Bunks tab is `Home`.
    { id: 'housing', label: 'Housing', icon: Home, count: boardSlotCount },
    { id: 'roster', label: 'Roster', icon: Users, count: parties.length },
    { id: 'map', label: 'Map', icon: MapIcon, count: mapUnitCount },
  ]

  return (
    <div>
      {/* Seated in a lodge card and spaced like summer's SessionHeader, which
          is the same two wrappers. Nothing here navigates AWAY from the
          weekend: the lander is the brand link in AppLayout, and the lodging
          editor is under Manage. */}
      <header className="mb-4">
        <div className="card-lodge p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* The weekend IS the title, and the title IS the switcher — the
                same move the summer session header makes, now literally the
                same component. */}
            <TitleSwitcher
              icon={Home}
              label={
                selectedSession
                  ? shortWeekendName(selectedSession.name)
                  : sessionsQuery.isLoading
                    ? 'Loading weekends…'
                    : 'Weekend not found'
              }
              value={selectedSession ? weekendRef(selectedSession, sessions) : ''}
              options={sessions.map((session) => ({
                value: weekendRef(session, sessions),
                label: shortWeekendName(session.name),
              }))}
              onChange={(value: string) => {
                // CARRIES THE TAB. Switching weekends from inside one is how
                // you compare the same view across two of them; landing back
                // on the roster every time is what makes you use the lander
                // instead. PUSH, unlike the tabs: the weekend is the
                // destination, so Back belongs to it.
                void navigate(`/weekend/${value}/${view}`)
              }}
              optionsClassName="min-w-[220px]"
            />

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
          </div>
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
                          // REPLACE, not push. Three tabs and a habit of
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

            {/* THREE STATIC PANELS, not one panel whose id follows `view`.
                Under `Activity` all three subtrees stay mounted at once, so a
                single dynamic id would either collide across the three (all
                three claiming `weekend-panel-${view}` — impossible, there is
                only one `view`) or leave two tabs' `aria-controls` pointing at
                an id that only the third panel currently wears. Each tab's
                `aria-controls` (above) targets one of these three fixed ids,
                which exist for the lifetime of the page.

                Each container also carries `hidden={view !== id}`. `Activity`
                sets `display:none` on the panel's CHILDREN when hidden, not
                on this container — so without it, every panel that has ever
                been opened stays exposed to the accessibility tree at once
                (a screen reader would land in an empty region for a tab that
                isn't selected). The native `hidden` attribute nests OVER
                `Activity`'s own display toggle rather than replacing it, so
                state preservation is untouched; it only controls what's
                exposed, not what's mounted.

                Each panel ALSO gets its own `ErrorBoundary`, inside the
                `Activity` so it guards the panel's actual content rather than
                the visibility mechanism around it. Reason it has to be
                per-panel rather than one shared boundary: once a tab has been
                opened, `Activity` keeps it mounted — hidden, not torn down —
                so a crash in a BACKGROUND tab (its chunk still loading while
                the user has already switched away) would otherwise climb to
                the route-level boundary in App.tsx and blank the header,
                scenario picker and tab strip along with the two tabs that
                never broke. `ErrorBoundary`'s default fallback supplies the
                retry — the ONLY way back for a panel that already crashed,
                since `Activity` no longer remounts it on a tab switch. */}
            <div className="pt-4">
              <div
                role="tabpanel"
                id="weekend-panel-housing"
                aria-labelledby="weekend-tab-housing"
                hidden={view !== 'housing'}
              >
                {/* The board takes the scenario, the weekend and the manage
                    permission because it WRITES now (#1989) — main's note that
                    drag placement "is what earns plumbing it back down" is
                    this. The map still takes only what it renders.

                    Each is its own Suspense boundary, not one wrapping the
                    whole panel: `Activity` keeps a previously-opened tab
                    mounted (just hidden) rather than unmounting it on switch,
                    so the board's chunk can genuinely still be loading in the
                    background at the same moment the map's Suspense starts —
                    one loading must not hold up the other. */}
                {openedViews.has('housing') && (
                  <Activity mode={view === 'housing' ? 'visible' : 'hidden'}>
                    <ErrorBoundary>
                      <Suspense fallback={<TabLoadingFallback />}>
                        <LodgingBoard
                          parties={parties}
                          units={units}
                          year={currentYear}
                          scenario={scenario}
                          sessionCmId={selectedCmId ?? 0}
                          canManage={canManageLodging}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  </Activity>
                )}
              </div>

              <div
                role="tabpanel"
                id="weekend-panel-roster"
                aria-labelledby="weekend-tab-roster"
                hidden={view !== 'roster'}
              >
                {openedViews.has('roster') && (
                  <Activity mode={view === 'roster' ? 'visible' : 'hidden'}>
                    <ErrorBoundary>
                      <HouseholdRosterTable parties={parties} units={units} year={currentYear} />
                    </ErrorBoundary>
                  </Activity>
                )}
              </div>

              <div
                role="tabpanel"
                id="weekend-panel-map"
                aria-labelledby="weekend-tab-map"
                hidden={view !== 'map'}
              >
                {openedViews.has('map') && (
                  <Activity mode={view === 'map' ? 'visible' : 'hidden'}>
                    <ErrorBoundary>
                      <Suspense fallback={<TabLoadingFallback />}>
                        <LodgingMap parties={parties} units={units} year={currentYear} />
                      </Suspense>
                    </ErrorBoundary>
                  </Activity>
                )}
              </div>
            </div>
          </>
        )}
      </QueryGuard>
    </div>
  )
}
