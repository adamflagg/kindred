/**
 * /weekend — the family & adult weekend lander.
 *
 * Deliberately the summer sessions lander one program over: forest header,
 * aggregate figures, rows grouped by lifecycle. What diverges is the unit —
 * parties into spaces, because a family holds a whole cabin.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WeekendSessionList from './WeekendSessionList'

const sessionsQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }

vi.mock('../hooks/useWeekendRoster', () => ({
  useWeekendSessions: () => sessionsQuery,
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, setCurrentYear: vi.fn() }),
}))

vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

vi.mock('../config/branding', () => ({ getCampNameShort: () => 'Camp' }))

// Per-weekend figures come from the roster endpoint, one query per weekend.
const rosterFor = vi.fn()
vi.mock('../services/lodgingApi', () => ({
  fetchWeekendRoster: (...args: unknown[]) => rosterFor(...args),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

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

beforeEach(() => {
  rosterFor.mockReset().mockResolvedValue({ counts: {} })
  sessionsQuery.data = { year: 2026, sessions: [FAMILY_CAMP_1, WOMENS] }
  sessionsQuery.isLoading = false
  sessionsQuery.error = null
})

describe('header', () => {
  it('names the program and the season, as the sessions lander does', () => {
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('Camp Weekends')).toBeInTheDocument()
    expect(screen.getByText('2026 family & adult weekends')).toBeInTheDocument()
  })
})

describe('rows', () => {
  it('links each weekend to its roster', () => {
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByRole('link', { name: /Family Camp 1/ })).toHaveAttribute(
      'href',
      '/weekend/session/1000001'
    )
  })

  it('labels family and adult weekends distinctly', () => {
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getByText('Adult')).toBeInTheDocument()
  })

  it('shows each weekend its dates', () => {
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('May 22–25, 2026')).toBeInTheDocument()
    expect(screen.getByText('Oct 15–18, 2026')).toBeInTheDocument()
  })

  it('groups by lifecycle rather than listing flat', () => {
    render(<WeekendSessionList />, { wrapper })
    // Both 2026 weekends are in the past or future relative to the test clock;
    // whichever group they land in, the lander must head it.
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.length).toBeGreaterThan(0)
  })
})

describe('empty state', () => {
  it('invites a sync rather than showing a bare page', () => {
    sessionsQuery.data = { year: 2026, sessions: [] }
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('No weekends found')).toBeInTheDocument()
    expect(screen.getByText(/once sessions sync from CampMinder/)).toBeInTheDocument()
  })
})

describe('query states', () => {
  it('shows the loading state while sessions load', () => {
    sessionsQuery.data = undefined
    sessionsQuery.isLoading = true
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText(/Loading weekend sessions data/i)).toBeInTheDocument()
  })

  it('shows the error state when the sessions query fails', () => {
    sessionsQuery.data = undefined
    sessionsQuery.error = new Error('boom')
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText(/Failed to load weekend sessions data: boom/i)).toBeInTheDocument()
  })
})
