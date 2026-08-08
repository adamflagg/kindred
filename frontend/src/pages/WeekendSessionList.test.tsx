/**
 * /weekend/sessions — the family & adult weekend lander.
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

const summaryQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }

vi.mock('../hooks/useWeekendRoster', () => ({
  useWeekendSummary: () => summaryQuery,
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, setCurrentYear: vi.fn() }),
}))

vi.mock('../config/branding', () => ({ getCampNameShort: () => 'Camp' }))

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // COPIES, not the shared constants. `beforeEach` rebuilds the wrapper object
  // but the two session literals are module-scoped, so a test that edits one
  // (the cancellation cases below) would otherwise leave it edited for every
  // test that runs after it — a failure that depends on test order and reads
  // as a bug in the component.
  summaryQuery.data = {
    year: 2026,
    weekends: [
      {
        session: { ...FAMILY_CAMP_1 },
        counts: {
          parties_total: 62,
          parties_assigned: 56,
          parties_unassigned: 6,
          units_family_available: 79,
        },
      },
      {
        session: { ...WOMENS },
        counts: {
          parties_total: 123,
          parties_assigned: 0,
          parties_unassigned: 123,
          units_family_available: 79,
        },
      },
    ],
  }
  summaryQuery.isLoading = false
  summaryQuery.error = null
})

describe('header', () => {
  it('names the program and the season, as the sessions lander does', () => {
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('Camp Weekends')).toBeInTheDocument()
    expect(screen.getByText('2026 family & adult weekends')).toBeInTheDocument()
  })
})

describe('rows', () => {
  it('links each weekend to its roster by readable slug, not CampMinder id', () => {
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByRole('link', { name: /Family Camp 1/ })).toHaveAttribute(
      'href',
      '/weekend/fc1'
    )
    expect(screen.getByRole('link', { name: /Women's Weekend/ })).toHaveAttribute(
      'href',
      '/weekend/ww'
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

describe('cancelled weekends', () => {
  /**
   * kindred#2092. The flag is STAFF-OWNED — CampMinder exposes no status field
   * to derive it from — and this lander is READ-ONLY about it: it badges, it
   * does not set. The write surface lives at /manage/lodging beside the
   * registry and the season roll-forward, behind the same permission gate.
   */
  function cancelWomensWeekend() {
    const data = summaryQuery.data as {
      weekends: { session: { status?: string } }[]
    }
    const womens = data.weekends[1]
    if (!womens) throw new Error('fixture changed: expected a second weekend to cancel')
    womens.session.status = 'cancelled'
  }

  it('badges a cancelled weekend in its own section rather than hiding it', () => {
    cancelWomensWeekend()
    render(<WeekendSessionList />, { wrapper })

    // Still reachable: a cancelled weekend keeps lodging rows the sync cannot
    // clean up, and its deep link must keep resolving.
    expect(screen.getByRole('link', { name: /Women's Weekend/ })).toHaveAttribute(
      'href',
      '/weekend/ww'
    )
    expect(screen.getByRole('heading', { level: 2, name: /Cancelled/ })).toBeInTheDocument()
  })

  it('counts a running weekend toward the header "need a cabin" figure', () => {
    // The baseline for the test below. Women's Weekend is the only one of the
    // two still upcoming — Family Camp 1's May dates are behind the clock, and
    // completed weekends were already excluded before this change — so the
    // header figure is its 123 alone.
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('123')).toBeInTheDocument()
  })

  it('stops counting a cancelled weekend toward "need a cabin"', () => {
    // Asking staff to house 123 families for a weekend that is not happening
    // is the whole complaint in kindred#2092.
    cancelWomensWeekend()
    render(<WeekendSessionList />, { wrapper })

    expect(screen.queryByText('123')).not.toBeInTheDocument()
    // …and the weekend itself is still on the page, badged. A figure that
    // dropped because the row vanished would be the wrong fix.
    expect(screen.getByText('CANCELLED')).toBeInTheDocument()
  })
})

describe('empty state', () => {
  it('invites a sync rather than showing a bare page', () => {
    summaryQuery.data = { year: 2026, weekends: [] }
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText('No weekends found')).toBeInTheDocument()
    expect(screen.getByText(/once sessions sync from CampMinder/)).toBeInTheDocument()
  })
})

describe('query states', () => {
  it('shows the loading state while sessions load', () => {
    summaryQuery.data = undefined
    summaryQuery.isLoading = true
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText(/Loading weekend sessions data/i)).toBeInTheDocument()
  })

  it('shows the error state when the sessions query fails', () => {
    summaryQuery.data = undefined
    summaryQuery.error = new Error('boom')
    render(<WeekendSessionList />, { wrapper })
    expect(screen.getByText(/Failed to load weekend sessions data: boom/i)).toBeInTheDocument()
  })
})
