/**
 * The /weekend page: session picker, honest counts, roster, inventory.
 * All four query states must be handled (frontend/CLAUDE.md).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
  useCurrentYear: () => ({
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026],
    isTransitioning: false,
    isYearReady: true,
  }),
}))

vi.mock('../contexts/ProgramContext', () => ({
  useProgram: () => ({ currentProgram: 'weekend', setProgram: vi.fn(), clearProgram: vi.fn() }),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <WeekendRosterPage />
    </MemoryRouter>
  )
}

const FAMILY_CAMP_1 = {
  session_id: 'sess_1',
  session_cm_id: 1000001,
  name: 'Family Camp 1',
  session_type: 'family',
  start_date: '2026-09-04',
  end_date: '2026-09-07',
}

beforeEach(() => {
  sessionsQuery.data = { year: 2026, sessions: [] }
  sessionsQuery.isLoading = false
  sessionsQuery.error = null
  rosterQuery.data = undefined
  rosterQuery.isLoading = false
  rosterQuery.error = null
})

describe('WeekendRosterPage', () => {
  it('replaces the placeholder — no "Coming Soon" anywhere', () => {
    renderPage()
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekend Housing Module')).not.toBeInTheDocument()
  })

  it('shows the loading state while sessions load', () => {
    sessionsQuery.data = undefined
    sessionsQuery.isLoading = true
    renderPage()
    expect(screen.getByText(/Loading weekend sessions data/i)).toBeInTheDocument()
  })

  it('shows the error state when the sessions query fails', () => {
    sessionsQuery.data = undefined
    sessionsQuery.error = new Error('boom')
    renderPage()
    expect(screen.getByText(/Failed to load weekend sessions data: boom/i)).toBeInTheDocument()
  })

  it('prompts for a weekend when none is selected', () => {
    sessionsQuery.data = { year: 2026, sessions: [FAMILY_CAMP_1] }
    renderPage()
    expect(screen.getByRole('button', { name: /Family Camp 1/ })).toBeInTheDocument()
    expect(screen.getByText('Choose a weekend to see its roster.')).toBeInTheDocument()
  })

  it('does not fetch a roster before a weekend is chosen', () => {
    sessionsQuery.data = { year: 2026, sessions: [FAMILY_CAMP_1] }
    renderPage()
    // The roster query is enabled only once a session id exists, so the
    // roster's own loading/empty states must not appear yet.
    expect(screen.queryByText(/Loading weekend roster data/i)).not.toBeInTheDocument()
    expect(screen.queryByText('No roster data for this weekend.')).not.toBeInTheDocument()
  })

  it('links to the lodging settings so a wrong seed can be corrected', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /Lodging settings/i })).toHaveAttribute(
      'href',
      '/admin/lodging'
    )
  })
})
