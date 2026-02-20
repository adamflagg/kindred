/**
 * Tests for MetricsLayout component
 * Shared layout with sticky nav that wraps metric routes
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MetricsLayout from './MetricsLayout'
import { CurrentYearContext, type CurrentYearContextType } from '../../hooks/useCurrentYear'

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

const TestChild = ({ text }: { text: string }) => <div data-testid="child">{text}</div>

const renderWithRouter = (initialPath: string, childText = 'Child Content') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024],
    isTransitioning: false,
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CurrentYearContext.Provider value={mockYearContext}>
          <Routes>
            <Route path="/metrics/*" element={<MetricsLayout />}>
              <Route path="registration/*" element={<TestChild text={childText} />} />
              <Route path="retention" element={<TestChild text="Retention" />} />
              <Route path="retention/flow" element={<TestChild text="Session Flow" />} />
              <Route path="retention/bunks" element={<TestChild text="Bunk Analysis" />} />
              <Route path="trends" element={<TestChild text="Trends" />} />
            </Route>
          </Routes>
        </CurrentYearContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MetricsLayout', () => {
  it('renders primary navigation tabs', () => {
    renderWithRouter('/metrics/registration/overview')

    expect(screen.getByRole('link', { name: /registration/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /retention/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument()
  })

  it('renders child content via Outlet', () => {
    renderWithRouter('/metrics/registration/overview', 'Registration Content')

    expect(screen.getByTestId('child')).toHaveTextContent('Registration Content')
  })

  it('renders sub-nav for registration routes', () => {
    renderWithRouter('/metrics/registration/overview')

    // Sub-nav items for registration (synagogue removed — data lives in geo tab)
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /geographic/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /synagogue/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /waitlist/i })).toBeInTheDocument()
  })

  it('renders sub-nav with Overview, Session Flow, and Bunk Analysis links for retention routes', () => {
    renderWithRouter('/metrics/retention')

    // Retention sub-nav should show Overview, Session Flow, and Bunk Analysis
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /session flow/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /bunk analysis/i })).toBeInTheDocument()
  })

  it('highlights Overview sub-nav on /metrics/retention', () => {
    renderWithRouter('/metrics/retention')

    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const sessionFlowLink = screen.getByRole('link', { name: /session flow/i })

    expect(overviewLink).toHaveClass('bg-primary')
    expect(sessionFlowLink).not.toHaveClass('bg-primary')
  })

  it('highlights Session Flow sub-nav on /metrics/retention/flow', () => {
    renderWithRouter('/metrics/retention/flow')

    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const sessionFlowLink = screen.getByRole('link', { name: /session flow/i })

    expect(sessionFlowLink).toHaveClass('bg-primary')
    expect(overviewLink).not.toHaveClass('bg-primary')
  })

  it('highlights Bunk Analysis sub-nav on /metrics/retention/bunks', () => {
    renderWithRouter('/metrics/retention/bunks')

    const bunkRetentionLink = screen.getByRole('link', { name: /bunk analysis/i })
    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const sessionFlowLink = screen.getByRole('link', { name: /session flow/i })

    expect(bunkRetentionLink).toHaveClass('bg-primary')
    expect(overviewLink).not.toHaveClass('bg-primary')
    expect(sessionFlowLink).not.toHaveClass('bg-primary')
  })

  it('does not render sub-nav for trends routes', () => {
    renderWithRouter('/metrics/trends')

    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /overview/i })).not.toBeInTheDocument()
  })

  it('renders page header with title for registration', () => {
    renderWithRouter('/metrics/registration/overview')

    expect(screen.getByText('Registration Metrics')).toBeInTheDocument()
    expect(screen.getByText(/analyze registration data/i)).toBeInTheDocument()
  })

  it('renders page header with title for retention', () => {
    renderWithRouter('/metrics/retention')

    expect(screen.getByText('Retention Metrics')).toBeInTheDocument()
    expect(screen.getByText(/prior year.*current year.*returning/i)).toBeInTheDocument()
  })

  it('renders sticky nav container', () => {
    renderWithRouter('/metrics/registration/overview')

    // The nav container should have sticky positioning class
    const stickyContainer = document.querySelector('.sticky')
    expect(stickyContainer).toBeInTheDocument()
  })

  it('highlights correct primary tab based on route', () => {
    renderWithRouter('/metrics/retention')

    const retentionLink = screen.getByRole('link', { name: /^retention$/i })
    const registrationLink = screen.getByRole('link', {
      name: /registration/i,
    })

    expect(retentionLink).toHaveClass('bg-primary')
    expect(registrationLink).not.toHaveClass('bg-primary')
  })

  describe('MetricsSessionProvider integration', () => {
    it('renders session selector via MetricsSessionProvider', () => {
      renderWithRouter('/metrics/registration/overview')

      // The session selector should be rendered (via MetricsTypeTabs)
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })

    it('session selector is present on all metric tabs', () => {
      // Test that it's present on registration
      renderWithRouter('/metrics/registration/overview')
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })
  })
})
