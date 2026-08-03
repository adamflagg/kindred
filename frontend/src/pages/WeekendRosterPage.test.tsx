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
}))

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

  it('shows the weekend dates and its program type', () => {
    renderPage()
    expect(screen.getByText('May 22–25, 2026')).toBeInTheDocument()
    expect(screen.getByText('Family')).toBeInTheDocument()
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
    // an unanchored match cannot tell the roster from the map and would pass
    // whatever the tab-carrying test below asserts.
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/weekend\/ww\/roster$/)
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

  it('offers a way back to the lander', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /All weekends/i })).toHaveAttribute(
      'href',
      '/weekend/sessions'
    )
  })

  it('links to the lodging editor under /manage', () => {
    // The editor moved off /admin so bunking staff can reach it. It points
    // straight at the units section rather than the bare path, skipping one
    // redirect hop.
    renderPage()
    expect(screen.getByRole('link', { name: /Lodging settings/i })).toHaveAttribute(
      'href',
      '/manage/lodging/units'
    )
  })

  it('offers the lodging-settings link to a non-admin holding bunking.manage', () => {
    // The whole point of the move: cabin confirmations are bunking staff's
    // job. The link must follow the permission that now gates the writes, not
    // the admin flag that used to.
    isAdmin = false
    permissions = new Set(['bunking.manage'])
    renderPage()
    expect(screen.getByRole('link', { name: /Lodging settings/i })).toHaveAttribute(
      'href',
      '/manage/lodging/units'
    )
  })

  it('hides the lodging-settings link from a user without bunking.manage', () => {
    // Every lodging collection now gates writes on bunking.manage, and the
    // route itself is behind RequirePermission — following the link would land
    // on the permission-denied page.
    isAdmin = false
    renderPage()
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

  it('opens the roster when the URL names no view', () => {
    rosterQuery.data = ONE_UNIT
    renderPage()
    expect(screen.getByRole('tab', { name: /Roster/ })).toHaveAttribute('aria-selected', 'true')
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

    await userEvent.click(screen.getByRole('tab', { name: /Board/ }))
    await userEvent.click(screen.getByRole('tab', { name: /Map/ }))
    await userEvent.click(screen.getByRole('button', { name: 'probe-back' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/weekend/sessions')
  })

  it('falls back to the roster when the URL names a view that does not exist', () => {
    // A stale bookmark, or a typo. Rendering nothing would read as a broken
    // page; the roster is the honest default.
    rosterQuery.data = ONE_UNIT
    renderPage('1000001', 'gantt')
    expect(screen.getByRole('tab', { name: /Roster/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('tabs', () => {
  it('opens on the roster and offers the inventory beside it', async () => {
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

    expect(screen.getByRole('tab', { name: /Roster/ })).toHaveAttribute('aria-selected', 'true')
    // The inventory is a tab away, not further down the same scroll.
    expect(screen.queryByText('Ridge A')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Inventory/ }))
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
  })

  it('counts what each tab holds, as the summer session tabs do', () => {
    rosterQuery.data = {
      year: 2026,
      session_cm_id: 1000001,
      parties: [],
      units: [],
      counts: {},
    }
    renderPage()
    expect(screen.getByRole('tab', { name: 'Roster (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Inventory (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Board (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Map (0)' })).toBeInTheDocument()
  })

  it('opens the board on its own tab', async () => {
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

    await userEvent.click(screen.getByRole('tab', { name: /Board/ }))
    expect(screen.getByText(/CampMinder mirror/i)).toBeInTheDocument()
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
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
    expect(screen.getByRole('tab', { name: 'Board (1)' })).toBeInTheDocument()
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
