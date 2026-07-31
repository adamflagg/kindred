/**
 * /weekend/session/:sessionCmId — one weekend's roster.
 *
 * The weekend comes from the URL now, as a summer session does. Choosing
 * between weekends belongs to the lander; this page's title doubles as the
 * switcher, mirroring the summer session header.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WeekendRosterPage from './WeekendRosterPage'

const sessionsQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const rosterQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const navigate = vi.fn()

vi.mock('../hooks/useWeekendRoster', () => ({
  useWeekendSessions: () => sessionsQuery,
  useWeekendRoster: () => rosterQuery,
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, setCurrentYear: vi.fn() }),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return { ...actual, useNavigate: () => navigate }
})

const FAMILY_CAMP_1 = {
  session_id: 'sess_1',
  session_cm_id: 1000001,
  name: 'Family Camp 1',
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

function renderPage(cmId = '1000001') {
  return render(
    <MemoryRouter initialEntries={[`/weekend/session/${cmId}`]}>
      <Routes>
        <Route path="/weekend/session/:sessionCmId" element={<WeekendRosterPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  navigate.mockReset()
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
    expect(screen.getByRole('combobox', { name: /weekend/i })).toHaveValue('1000001')
    expect(screen.getByRole('option', { name: 'Family Camp 1' })).toBeInTheDocument()
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /weekend/i }), '1000002')
    expect(navigate).toHaveBeenCalledWith('/weekend/session/1000002')
  })

  it('offers a way back to the lander', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /All weekends/i })).toHaveAttribute('href', '/weekend')
  })

  it('links to the lodging settings so a wrong seed can be corrected', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /Lodging settings/i })).toHaveAttribute(
      'href',
      '/admin/lodging'
    )
  })

  it('says so when the URL names a weekend that does not exist', () => {
    renderPage('9999999')
    expect(screen.getByRole('option', { name: 'Weekend not found' })).toBeInTheDocument()
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
  })
})
