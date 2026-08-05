/**
 * /weekend/:sessionRef/:view? — one weekend's roster.
 *
 * The weekend comes from the URL now, as a summer session does. Choosing
 * between weekends belongs to the lander; this page's title doubles as the
 * switcher, mirroring the summer session header.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WeekendRosterPage from './WeekendRosterPage'

const sessionsQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const rosterQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }

vi.mock('../hooks/useWeekendRoster', () => ({
  useWeekendSessions: () => sessionsQuery,
  useWeekendRoster: () => rosterQuery,
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, setCurrentYear: vi.fn() }),
  useYear: () => 2026,
}))

// The picker seeds through `useSeedScenario`, which reaches `useApiWithAuth`
// and `useQueryClient` on RENDER, not just on click — so this file needs both
// even though nothing here ever seeds. Without them every test in the file
// dies on "useAuth must be used within an AuthProvider".
vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }
})

// The board mounts `useLodgingPlacement`, which mounts a real `useMutation` —
// and that reaches for a QueryClient through react-query's own internals,
// which the `useQueryClient` stub above does not satisfy. These files are
// about layout, navigation and the scenario picker; drag placement has its own
// tests in `components/weekend/LodgingBoard.drag.test.tsx`.
vi.mock('../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(() => Promise.resolve()), isMoving: false }),
}))

// Same reason, same board: the reserve/release control mounts a real
// `useMutation` too. Its gate is pinned in
// `components/weekend/LodgingBoard.availability.test.tsx`.
vi.mock('../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({
    setAvailability: vi.fn(() => Promise.resolve()),
    pendingUnitId: '',
  }),
}))

// Same reason, same board: the merge handle and split control mount a real
// `useMutation` too. Their gate is pinned in
// `components/weekend/LodgingBoard.merge.test.tsx`.
vi.mock('../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({
    setCombined: vi.fn(() => Promise.resolve()),
    pendingUnitId: null,
  }),
}))

// The page reads the global ScenarioContext to resolve which plan the roster
// is being read in (#1967). These tests are about layout and navigation, so
// the mock stays in production mode throughout — the picker's own behaviour
// lives in `WeekendRosterPage.scenario.test.tsx`.
vi.mock('../hooks/useScenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useScenario')>()
  return {
    ...actual,
    useScenario: () => ({
      currentScenario: null,
      isProductionMode: true,
      scenarios: [],
      isLoading: false,
      isMutating: false,
      error: null,
      loadScenarios: vi.fn(),
      createScenario: vi.fn(),
      selectScenario: vi.fn(),
      updateScenario: vi.fn(),
      deleteScenario: vi.fn(),
      clearScenario: vi.fn(),
    }),
  }
})

// Admin and bunking.manage are tracked separately: the point of the lodging
// link's gate is that a non-admin holding bunking.manage still gets it.
let isAdmin = true
let permissions = new Set<string>()

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin,
    permissions: [...permissions],
    hasPermission: (p: string) => isAdmin || permissions.has(p),
    hasAnyPermission: (...ps: string[]) => isAdmin || ps.some((p) => permissions.has(p)),
  }),
}))

// Pass-through spies on the two expensive derivations the header needs for
// its tab counts. Both build a whole model to read a length — `countBoardSlots`
// indexes the entire board, `countMapUnits` builds the board AND the map model
// — so calling them on every render is real work, on every tab, whether or not
// the board or map is mounted.
const countBoardSlotsSpy = vi.fn()
const countMapUnitsSpy = vi.fn()

vi.mock('../components/weekend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/weekend')>()
  return {
    ...actual,
    countBoardSlots: (...args: Parameters<typeof actual.countBoardSlots>) => {
      countBoardSlotsSpy()
      return actual.countBoardSlots(...args)
    },
    countMapUnits: (...args: Parameters<typeof actual.countMapUnits>) => {
      countMapUnitsSpy()
      return actual.countMapUnits(...args)
    },
  }
})

// The `useNavigate` spy this file used to install has been removed on purpose.
// The view now lives in the URL, so a spy would have asserted that the page
// ASKED to navigate while the page it rendered stayed on the old tab — the
// exact disagreement these tests exist to catch. A real MemoryRouter plus a
// location probe asserts where the app actually ended up.

const FAMILY_CAMP_1 = {
  session_id: 'sess_1',
  session_cm_id: 1000001,
  name: 'Family Camp 1: Memorial Day Weekend',
  session_type: 'family',
  start_date: '2026-05-22 07:00:00.000Z',
  end_date: '2026-05-25 07:00:00.000Z',
}

const WOMENS = {
  session_id: 'sess_2',
  session_cm_id: 1000002,
  name: "Women's Weekend",
  session_type: 'adult',
  start_date: '2026-10-15 07:00:00.000Z',
  end_date: '2026-10-18 07:00:00.000Z',
}

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <button
        type="button"
        onClick={() => {
          void navigate(-1)
        }}
      >
        probe-back
      </button>
    </>
  )
}

function renderPage(ref = '1000001', view = '') {
  const path = `/weekend/${ref}${view === '' ? '' : `/${view}`}`
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  )
}

/** The `<header>` landmark, for assertions about the header's own container. */
function renderHeader(ref = '1000001') {
  renderPage(ref)
  return screen.getByRole('banner')
}

beforeEach(() => {
  isAdmin = true
  permissions = new Set()
  sessionsQuery.data = { year: 2026, sessions: [FAMILY_CAMP_1, WOMENS] }
  sessionsQuery.isLoading = false
  sessionsQuery.error = null
  rosterQuery.data = { year: 2026, session_cm_id: 1000001, parties: [], units: [], counts: {} }
  rosterQuery.isLoading = false
  rosterQuery.error = null
})

describe('header', () => {
  it('makes the weekend name the title and the switcher', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /Family Camp 1/ })).toBeInTheDocument()
  })

  it('shortens the CampMinder name to its identity in the title', () => {
    // "Family Camp 1: Memorial Day Weekend" would wrap a title and swamp a
    // picker; the description belongs on the lander row.
    renderPage()
    expect(screen.queryByText(/Memorial Day Weekend/)).not.toBeInTheDocument()
  })

  it('shows the program type but not the dates', () => {
    // Summer's session header carries no date range either. Inside a weekend
    // you already know which one you are in — the dates earn their place on
    // the lander, where they are what tells one weekend from the next, and
    // `WeekendSessionList` still shows them there.
    renderPage()
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.queryByText('May 22–25, 2026')).not.toBeInTheDocument()
  })

  it('labels an adult weekend distinctly', () => {
    rosterQuery.data = { year: 2026, session_cm_id: 1000002, parties: [], units: [], counts: {} }
    renderPage('1000002')
    expect(screen.getByText('Adult')).toBeInTheDocument()
  })

  it('navigates to the chosen weekend rather than swapping state in place', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /Family Camp 1/ }))
    await userEvent.click(await screen.findByRole('option', { name: "Women's Weekend" }))
    // ANCHORED: `/weekend/ww` is a prefix of every tab under that weekend, so
    // an unanchored match cannot tell one tab from another and would pass
    // whatever the tab-carrying test below asserts.
    //
    // `housing` because the switch carries the tab you are on, and this page
    // opened on the default.
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/weekend\/ww\/housing$/)
  })

  it('stays on the tab you are looking at when you switch weekends', async () => {
    // Comparing one view across two weekends is the reason to switch from
    // inside a weekend rather than from the lander. Dropping back to the
    // roster every time makes the switcher useless for exactly that.
    renderPage('fc1', 'map')
    await userEvent.click(screen.getByRole('button', { name: /Family Camp 1/ }))
    await userEvent.click(await screen.findByRole('option', { name: "Women's Weekend" }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/weekend\/ww\/map$/)
  })

  it('orders the picker by date, not by CampMinder sort_order', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /Family Camp 1/ }))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['Family Camp 1', "Women's Weekend"])
  })

  it('seats the header in a lodge card, as the summer session header is', () => {
    // `card-lodge` is the container primitive summer's SessionHeader sits in.
    // Asserting the class rather than "some box is drawn" is the point: a
    // header boxed by hand-rolled classes is exactly the drift this catches.
    expect(renderHeader().querySelector('.card-lodge')).not.toBeNull()
  })

  it('carries no navigation away from the weekend', () => {
    // Both links went. Summer's session header carries neither, and neither
    // destination is stranded: AppLayout's brand link reaches `/weekend/`,
    // which redirects to the lander, and Manage reaches the lodging editor.
    //
    // Rendered as an ADMIN — the default here, and someone the old gate let
    // through. Asserting absence for a user who could never see the settings
    // link would pass whether or not the link was actually removed.
    renderPage()
    expect(screen.queryByRole('link', { name: /All weekends/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Lodging settings/i })).not.toBeInTheDocument()
  })

  it('says so when the URL names a weekend that does not exist', () => {
    renderPage('9999999')
    expect(screen.getByRole('button', { name: /Weekend not found/ })).toBeInTheDocument()
  })
})

describe('query states', () => {
  it('shows the loading state while the roster loads', () => {
    rosterQuery.data = undefined
    rosterQuery.isLoading = true
    renderPage()
    expect(screen.getByText(/Loading weekend roster data/i)).toBeInTheDocument()
  })

  it('shows the error state when the roster query fails', () => {
    rosterQuery.data = undefined
    rosterQuery.error = new Error('boom')
    renderPage()
    expect(screen.getByText(/Failed to load weekend roster data: boom/i)).toBeInTheDocument()
  })
})

describe('addressing a weekend by slug', () => {
  it('opens the weekend a slug names', () => {
    renderPage('fc1')
    expect(screen.getByRole('button', { name: /Family Camp 1/ })).toBeInTheDocument()
  })

  it('keeps the slug when moving between tabs', async () => {
    renderPage('fc1')
    await userEvent.click(screen.getByRole('tab', { name: /Map/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/weekend/fc1/map')
  })

  it('waits for the weekend list before calling a slug unknown', () => {
    // A slug cannot be resolved without the list, so deciding early would flash
    // "Weekend not found" on every load of a perfectly good link.
    sessionsQuery.data = undefined
    sessionsQuery.isLoading = true
    rosterQuery.data = undefined
    renderPage('fc1')
    expect(screen.queryByRole('button', { name: /Weekend not found/ })).not.toBeInTheDocument()
  })

  it('says so once the list has loaded and the slug still names nothing', () => {
    renderPage('zz')
    expect(screen.getByRole('button', { name: /Weekend not found/ })).toBeInTheDocument()
  })
})

describe('the view in the URL', () => {
  const ONE_UNIT = {
    year: 2026,
    session_cm_id: 1000001,
    parties: [],
    counts: {},
    units: [
      {
        unit_id: 'u1',
        code: 'ridge-a',
        name: 'Ridge A',
        area_code: 'RIDGE',
        area_name: 'Ridge Side',
        sleeps: 5,
        is_confirmed: true,
        is_container: false,
        is_family_available: true,
      },
    ],
  }

  it('opens the view the URL names, so a tab can be linked and reloaded', () => {
    rosterQuery.data = ONE_UNIT
    renderPage('1000001', 'inventory')
    expect(screen.getByRole('tab', { name: /Inventory/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
  })

  it('opens Housing when the URL names no view', () => {
    // The tab strip already leads with Housing, as summer leads with Bunks.
    // Landing on the second tab made the lead tab a click away from the thing
    // staff came to do.
    rosterQuery.data = ONE_UNIT
    renderPage()
    expect(screen.getByRole('tab', { name: /Housing/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('puts the chosen view in the URL', async () => {
    rosterQuery.data = ONE_UNIT
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: /Inventory/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/weekend/1000001/inventory')
  })

  it('replaces rather than stacks, so Back leaves the weekend', async () => {
    // Four tabs and a habit of clicking through them turns Back into a tour of
    // the tabs you already saw. The weekend is the destination; the tab is not.
    //
    // ASSERTING THE FINAL URL WOULD NOT TEST THIS — it is identical whether the
    // tab pushed or replaced. Only going Back tells them apart, which needs a
    // real entry BEHIND the weekend to come back to.
    rosterQuery.data = ONE_UNIT
    render(
      <MemoryRouter initialEntries={['/weekend/sessions', '/weekend/fc1']} initialIndex={1}>
        <Routes>
          <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    )

    await userEvent.click(screen.getByRole('tab', { name: /Housing/ }))
    await userEvent.click(screen.getByRole('tab', { name: /Map/ }))
    await userEvent.click(screen.getByRole('button', { name: 'probe-back' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/weekend/sessions')
  })

  it('falls back to Housing when the URL names a view that does not exist', () => {
    // A stale bookmark, or a typo. Rendering nothing would read as a broken
    // page; the landing view is the honest default. Same constant as the
    // no-segment case — deliberately, so a typo cannot land somewhere a fresh
    // visit never would.
    rosterQuery.data = ONE_UNIT
    renderPage('1000001', 'gantt')
    expect(screen.getByRole('tab', { name: /Housing/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('still does not answer to `board`, though the default now lands where it pointed', () => {
    // The rename took the URL with it, deliberately and without a redirect.
    //
    // ASSERTING THE RENDERED TAB WOULD NO LONGER TEST THIS. `board` is an
    // unrecognised segment, so it falls to the default — and the default is now
    // Housing, the very tab `board` used to name. A tab assertion would pass
    // whether or not an alias existed, which is a test that pins nothing.
    //
    // What still tells them apart is the URL: an alias would rewrite it to
    // `/housing`, and a fallback leaves the stale segment exactly where the
    // bookmark put it. That a stale link now lands on the right content is a
    // happy side effect of the default, not a route.
    rosterQuery.data = ONE_UNIT
    renderPage('1000001', 'board')
    expect(screen.getByTestId('location')).toHaveTextContent('/weekend/1000001/board')
  })
})

describe('tabs', () => {
  it('opens on Housing and offers the inventory beside it', async () => {
    rosterQuery.data = {
      year: 2026,
      session_cm_id: 1000001,
      parties: [],
      counts: {},
      units: [
        {
          unit_id: 'u1',
          code: 'ridge-a',
          name: 'Ridge A',
          area_code: 'RIDGE',
          area_name: 'Ridge Side',
          sleeps: 5,
          is_confirmed: true,
          is_container: false,
          is_family_available: true,
        },
      ],
    }
    renderPage()

    expect(screen.getByRole('tab', { name: /Housing/ })).toHaveAttribute('aria-selected', 'true')
    // The inventory is a tab away, not further down the same scroll. Housing
    // names the same unit, so the unit name no longer tells the two apart —
    // the panel's own heading does.
    expect(screen.queryByText('Lodging inventory')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Inventory/ }))
    expect(screen.getByText('Lodging inventory')).toBeInTheDocument()
  })

  it('leads with Housing and counts what each tab holds, as summer does', () => {
    // ORDER IS THE ASSERTION, not just presence. Summer leads with Bunks and
    // puts Campers after it; a weekend reads the same way round, and for the
    // same reason — both name the tab after the thing being assigned rather
    // than after the widget. Inventory trails: it describes the buildings, not
    // this weekend.
    renderPage()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Housing (0)',
      'Roster (0)',
      'Map (0)',
      'Inventory (0)',
    ])
  })

  it('opens Housing on its own tab, at its own URL', async () => {
    rosterQuery.data = {
      year: 2026,
      session_cm_id: 1000001,
      parties: [],
      counts: {},
      units: [
        {
          unit_id: 'u1',
          code: 'ridge-a',
          name: 'Ridge A',
          area_code: 'RIDGE',
          area_name: 'Ridge Side',
          sleeps: 5,
          is_confirmed: true,
          is_container: false,
          is_active: true,
          is_family_available: true,
        },
      ],
    }
    renderPage()

    await userEvent.click(screen.getByRole('tab', { name: /Housing/ }))
    // The URL follows the label. No `board` segment survives the rename.
    expect(screen.getByTestId('location')).toHaveTextContent('/weekend/1000001/housing')
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
    // The mode lives in the header badge alone now, as it does on summer's
    // board — not repeated as a chip over the content.
    expect(screen.queryByText(/CampMinder mirror/i)).not.toBeInTheDocument()
  })

  it('counts the slot cards the board draws, not the building rows', () => {
    // A container carries the beds its halves already report; giving it a
    // card would double-count them, so it never gets one and never counts.
    rosterQuery.data = {
      year: 2026,
      session_cm_id: 1000001,
      parties: [],
      counts: {},
      units: [
        {
          unit_id: 'u1',
          code: 'ridge-a',
          name: 'Ridge A',
          area_code: 'RIDGE',
          area_name: 'Ridge Side',
          is_container: false,
          is_active: true,
        },
        {
          unit_id: 'u2',
          code: 'ridge-block',
          name: 'Ridge Block',
          area_code: 'RIDGE',
          area_name: 'Ridge Side',
          is_container: true,
          is_active: true,
        },
      ],
    }
    renderPage()
    expect(screen.getByRole('tab', { name: 'Housing (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Inventory (2)' })).toBeInTheDocument()
  })

  it('shows the map when the Map tab is selected', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Map (0)' }))
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument()
  })

  it('counts the marks the map draws, not the inventory', async () => {
    // A container and an unpositioned room both appear in Inventory and neither
    // gets a mark, so the two counts must differ.
    rosterQuery.data = {
      parties: [],
      units: [
        {
          unit_id: 'u1',
          code: 'cedar-1',
          name: 'Cedar 1',
          area_code: 'CG',
          area_name: 'Cedar Grove',
          is_container: false,
          is_active: true,
          map_x: 0.4,
          map_y: 0.5,
        },
        {
          unit_id: 'u2',
          code: 'lodge',
          name: 'Lodge',
          area_code: 'CG',
          area_name: 'Cedar Grove',
          is_container: true,
          is_active: true,
          map_x: 0.4,
          map_y: 0.5,
        },
        {
          unit_id: 'u3',
          code: 'cedar-3',
          name: 'Cedar 3',
          area_code: 'CG',
          area_name: 'Cedar Grove',
          is_container: false,
          is_active: true,
          map_x: 0,
          map_y: 0,
        },
      ],
      counts: {},
    }
    renderPage()
    expect(screen.getByRole('tab', { name: 'Inventory (3)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Map (1)' })).toBeInTheDocument()
  })
})

describe('recomputation', () => {
  // Switching tabs re-renders this page with the SAME roster payload. Nothing
  // about the board index or the map model can have changed, so neither should
  // be rebuilt — and the summer board it is modelled on does not rebuild its
  // derivations per render either. The tab-count assertions above are the
  // correctness half of this pair: they fail if memoising returns stale counts.
  it('does not rebuild the board index or the map model when only the tab changes', async () => {
    renderPage()
    countBoardSlotsSpy.mockClear()
    countMapUnitsSpy.mockClear()

    await userEvent.click(screen.getByRole('tab', { name: /Housing/ }))
    await userEvent.click(screen.getByRole('tab', { name: /Map/ }))
    await userEvent.click(screen.getByRole('tab', { name: /Roster/ }))

    expect(countBoardSlotsSpy).not.toHaveBeenCalled()
    expect(countMapUnitsSpy).not.toHaveBeenCalled()
  })

  it('does rebuild them when the roster payload actually changes', async () => {
    // The guard above must not be satisfiable by never computing at all.
    const { rerender } = renderPage()
    countBoardSlotsSpy.mockClear()
    countMapUnitsSpy.mockClear()

    rosterQuery.data = {
      year: 2026,
      session_cm_id: 1000001,
      parties: [],
      units: [
        {
          unit_id: 'u1',
          code: 'cedar-1',
          name: 'Cedar 1',
          area_code: 'CG',
          area_name: 'Cedar Grove',
          is_container: false,
          is_active: true,
          map_x: 0.2,
          map_y: 0.3,
        },
      ],
      counts: {},
    }
    rerender(
      <MemoryRouter initialEntries={['/weekend/1000001']}>
        <Routes>
          <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(countBoardSlotsSpy).toHaveBeenCalled()
    expect(countMapUnitsSpy).toHaveBeenCalled()
  })
})
