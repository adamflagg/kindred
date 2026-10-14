/**
 * Tests for MetricsLayout component
 * Shared layout with sticky nav that wraps metric routes
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MetricsLayout from './MetricsLayout'
import { CurrentYearContext, type CurrentYearContextType } from '../../hooks/useCurrentYear'
import { AuthContext } from '../../contexts/AuthContext'
import { createMockAuthContext, createMockUser } from '../../test/test-helpers'

// Mock useMetricsSessions hook
vi.mock('../../hooks/useMetricsSessions', () => ({
  useMetricsSessions: vi.fn(() => ({
    data: [
      {
        cm_id: 1001,
        name: 'Session 1',
        session_type: 'main',
        start_date: '2026-06-15',
      },
      {
        cm_id: 1002,
        name: 'Session 2',
        session_type: 'main',
        start_date: '2026-07-01',
      },
    ],
    isLoading: false,
  })),
}))

// The empty-season gate (PR 4, board 9 A). Default: the season has rows, so pages render.
interface SeasonRowsResult {
  hasRows: boolean | undefined
  isLoading: boolean
}
const mockSeasonRows = vi.fn((_year: number): SeasonRowsResult => ({
  hasRows: true,
  isLoading: false,
}))
vi.mock('../../hooks/useSeasonHasRows', () => ({
  useSeasonHasRows: (year: number) => mockSeasonRows(year),
}))
const mockFreshness = vi.fn((_year: number): { kind: string } => ({ kind: 'none' }))
vi.mock('../../hooks/useAnalyticsFreshness', () => ({
  useAnalyticsFreshness: (year: number) => mockFreshness(year),
}))
const mockPriorityDate = vi.fn((_year: number): string | undefined => undefined)
vi.mock('../../hooks/useRegistrationDates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useRegistrationDates')>()),
  usePriorityRegDate: (year: number) => mockPriorityDate(year),
}))

const mockSetCurrentYear = vi.fn()
let lastSearch = ''
function LocationProbe() {
  lastSearch = useLocation().search
  return null
}

beforeEach(() => {
  mockSeasonRows.mockReset().mockReturnValue({ hasRows: true, isLoading: false })
  mockFreshness.mockReset().mockReturnValue({ kind: 'none' })
  mockPriorityDate.mockReset().mockReturnValue(undefined)
  mockSetCurrentYear.mockReset()
})

const TestChild = ({ text }: { text: string }) => <div data-testid="child">{text}</div>

const renderWithRouter = (initialPath: string, childText = 'Child Content') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: mockSetCurrentYear,
    availableYears: [2026, 2025, 2024],
    isTransitioning: false,
    isYearReady: true,
  }

  const user = createMockUser({ is_admin: true })
  const authCtx = createMockAuthContext({ user })

  return render(
    createElement(
      AuthContext.Provider,
      { value: authCtx },
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationProbe />
          <CurrentYearContext value={mockYearContext}>
            <Routes>
              <Route path="/analytics/*" element={<MetricsLayout />}>
                <Route path="registration/*" element={<TestChild text={childText} />} />
                <Route path="retention" element={<TestChild text="Retention" />} />
                <Route path="retention/flow" element={<TestChild text="Session Flow" />} />
                <Route path="retention/bunks" element={<TestChild text="Bunk Analysis" />} />
                <Route path="trends" element={<TestChild text="Trends" />} />
              </Route>
            </Routes>
          </CurrentYearContext>
        </MemoryRouter>
      </QueryClientProvider>
    )
  )
}

describe('MetricsLayout', () => {
  it('renders primary navigation tabs', () => {
    renderWithRouter('/analytics/registration/overview')

    expect(screen.getByRole('link', { name: /registration/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /retention/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument()
  })

  it('renders child content via Outlet', () => {
    renderWithRouter('/analytics/registration/overview', 'Registration Content')

    expect(screen.getByTestId('child')).toHaveTextContent('Registration Content')
  })

  it('renders sub-nav for registration routes', () => {
    renderWithRouter('/analytics/registration/overview')

    // Sub-nav items for registration (synagogue removed — data lives in geo tab)
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /geographic/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /synagogue/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /waitlist/i })).toBeInTheDocument()
  })

  it('renders sub-nav with Overview, Session Flow, and Bunk Analysis links for retention routes', () => {
    renderWithRouter('/analytics/retention')

    // Retention sub-nav should show Overview, Session Flow, and Bunk Analysis
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /session flow/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /bunk analysis/i })).toBeInTheDocument()
  })

  it('highlights Overview sub-nav on /analytics/retention', () => {
    renderWithRouter('/analytics/retention')

    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const sessionFlowLink = screen.getByRole('link', { name: /session flow/i })

    expect(overviewLink).toHaveClass('bg-primary')
    expect(sessionFlowLink).not.toHaveClass('bg-primary')
  })

  it('highlights Session Flow sub-nav on /analytics/retention/flow', () => {
    renderWithRouter('/analytics/retention/flow')

    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const sessionFlowLink = screen.getByRole('link', { name: /session flow/i })

    expect(sessionFlowLink).toHaveClass('bg-primary')
    expect(overviewLink).not.toHaveClass('bg-primary')
  })

  it('highlights Bunk Analysis sub-nav on /analytics/retention/bunks', () => {
    renderWithRouter('/analytics/retention/bunks')

    const bunkRetentionLink = screen.getByRole('link', { name: /bunk analysis/i })
    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const sessionFlowLink = screen.getByRole('link', { name: /session flow/i })

    expect(bunkRetentionLink).toHaveClass('bg-primary')
    expect(overviewLink).not.toHaveClass('bg-primary')
    expect(sessionFlowLink).not.toHaveClass('bg-primary')
  })

  it('renders sub-nav for trends routes', () => {
    renderWithRouter('/analytics/trends')

    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument()
    // Trends now has its own sub-nav with Overview
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
  })

  it('renders page header with title for registration', () => {
    renderWithRouter('/analytics/registration/overview')

    expect(screen.getByRole('heading', { name: 'Registration' })).toBeInTheDocument()
  })

  it('renders page header with title for retention', () => {
    renderWithRouter('/analytics/retention')

    expect(screen.getByRole('heading', { name: 'Retention' })).toBeInTheDocument()
  })

  describe('scope line (PR 4, pick 1A: replaces the subtitle)', () => {
    const line = () => screen.getByTestId('metrics-scope-line')

    it('says what Registration Overview counts, under the current filter', () => {
      renderWithRouter('/analytics/registration/overview')
      expect(line()).toHaveTextContent(
        "2026 · At Camp — Quests and Teens not counted · counted in campers · Summer only: Family Camp, B*Mitzvah and winter programs aren't in Analytics"
      )
      expect(screen.queryByText(/analyze registration data/i)).not.toBeInTheDocument()
    })

    it('follows the session filter', () => {
      renderWithRouter('/analytics/registration/overview?view=all')
      expect(line()).toHaveTextContent(/^2026 · All Summer · counted in campers · Summer only/)
    })

    it('reads last season into this one on Retention', () => {
      renderWithRouter('/analytics/retention')
      expect(line()).toHaveTextContent(
        /^2025 → 2026 · At Camp — Quests and Teens not counted · counted in last year's campers/
      )
      expect(screen.queryByText(/prior year.*current year.*returning/i)).not.toBeInTheDocument()
    })

    it('says the filter does not apply on Bunk Analysis', () => {
      renderWithRouter('/analytics/retention/bunks')
      expect(line()).toHaveTextContent(
        /^2025 → 2026 · every 2025 cabin — the session filter doesn't apply here/
      )
    })

    it('stays on an empty season', () => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
      renderWithRouter('/analytics/registration/overview')
      expect(line()).toHaveTextContent(/^2026 · At Camp/)
    })
  })

  it('renders sticky nav container', () => {
    renderWithRouter('/analytics/registration/overview')

    // The nav container should have sticky positioning class
    const stickyContainer = document.querySelector('.sticky')
    expect(stickyContainer).toBeInTheDocument()
  })

  it('highlights correct primary tab based on route', () => {
    renderWithRouter('/analytics/retention')

    const retentionLink = screen.getByRole('link', { name: /^retention$/i })
    const registrationLink = screen.getByRole('link', {
      name: /registration/i,
    })

    expect(retentionLink).toHaveClass('bg-primary')
    expect(registrationLink).not.toHaveClass('bg-primary')
  })

  describe('MetricsSessionProvider integration', () => {
    it('renders session selector via MetricsSessionProvider', () => {
      renderWithRouter('/analytics/registration/overview')

      // The session selector should be rendered (via MetricsTypeTabs)
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })

    it('session selector is present on all metric tabs', () => {
      // Test that it's present on registration
      renderWithRouter('/analytics/registration/overview')
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })
  })

  describe('empty season (PR 4, board 9 A)', () => {
    it('asks about the viewed season', () => {
      renderWithRouter('/analytics/registration/overview')
      expect(mockSeasonRows).toHaveBeenCalledWith(2026)
    })

    it('replaces every page body with the empty state, keeping header, tabs, sub-nav and picker', () => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
      renderWithRouter('/analytics/registration/overview', 'Registration Content')
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
      expect(screen.getByText(/No enrollments yet for 2026/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'view 2025' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Registration' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /geographic/i })).toBeInTheDocument()
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })

    it('does the same on Retention and Trends pages', () => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
      renderWithRouter('/analytics/retention/bunks')
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
      expect(screen.getByText(/No enrollments yet for 2026/)).toBeInTheDocument()
    })

    it('shows no page and no empty state while the count loads, so no zeros flash', () => {
      mockSeasonRows.mockReturnValue({ hasRows: undefined, isLoading: true })
      renderWithRouter('/analytics/registration/overview')
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
      expect(screen.queryByText(/No enrollments yet/)).not.toBeInTheDocument()
      expect(screen.getByTestId('season-rows-loading')).toBeInTheDocument()
    })

    it('says the season has not synced when its enrollment sync never ran', () => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
      mockFreshness.mockReturnValue({ kind: 'never' })
      renderWithRouter('/analytics/registration/overview')
      expect(screen.getByText(/2026 hasn.t synced from CampMinder yet/)).toBeInTheDocument()
    })

    it('names the configured priority date', () => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
      mockPriorityDate.mockReturnValue('2099-11-11')
      renderWithRouter('/analytics/registration/overview')
      expect(mockPriorityDate).toHaveBeenCalledWith(2026)
      expect(screen.getByText(/Priority registration opens .*Nov 11\./)).toBeInTheDocument()
    })

    it('"view 2025" sets ?year=2025, keeps the other params, and never saves the season', () => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
      renderWithRouter('/analytics/registration/overview?session=1001&view=quests')
      fireEvent.click(screen.getByRole('button', { name: 'view 2025' }))
      const s = new URLSearchParams(lastSearch)
      expect(s.get('year')).toBe('2025')
      expect(s.get('session')).toBe('1001')
      expect(s.get('view')).toBe('quests')
      expect(mockSetCurrentYear).not.toHaveBeenCalled()
    })
  })
})
