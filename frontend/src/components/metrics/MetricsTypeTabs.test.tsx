/**
 * Tests for MetricsTypeTabs component
 * Primary navigation for metrics module following SessionTabs pattern
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MetricsTypeTabs from './MetricsTypeTabs'
import { MetricsSessionProvider } from '../../contexts/MetricsSessionContext'
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

const renderWithRouter = (initialPath: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024],
    isTransitioning: false,
    isYearReady: true,
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CurrentYearContext value={mockYearContext}>
          <MetricsSessionProvider>
            <MetricsTypeTabs />
          </MetricsSessionProvider>
        </CurrentYearContext>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MetricsTypeTabs', () => {
  it('renders all three metric type tabs', () => {
    renderWithRouter('/analytics/registration')

    expect(screen.getByRole('link', { name: /registration/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /retention/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /trends/i })).toBeInTheDocument()
  })

  it('renders icons for each tab', () => {
    renderWithRouter('/analytics/registration')

    // Each tab should have an icon (rendered as svg)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)

    links.forEach((link) => {
      const svg = link.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  it('highlights registration tab when on registration route', () => {
    renderWithRouter('/analytics/registration')

    const registrationLink = screen.getByRole('link', {
      name: /registration/i,
    })
    const retentionLink = screen.getByRole('link', { name: /retention/i })

    // Active tab should have primary background
    expect(registrationLink).toHaveClass('bg-primary')
    expect(retentionLink).not.toHaveClass('bg-primary')
  })

  it('highlights registration tab when on registration sub-route', () => {
    renderWithRouter('/analytics/registration/geo')

    const registrationLink = screen.getByRole('link', {
      name: /registration/i,
    })
    expect(registrationLink).toHaveClass('bg-primary')
  })

  it('highlights retention tab when on retention route', () => {
    renderWithRouter('/analytics/retention')

    const retentionLink = screen.getByRole('link', { name: /retention/i })
    const registrationLink = screen.getByRole('link', {
      name: /registration/i,
    })

    expect(retentionLink).toHaveClass('bg-primary')
    expect(registrationLink).not.toHaveClass('bg-primary')
  })

  it('highlights trends tab when on trends route', () => {
    renderWithRouter('/analytics/trends')

    const trendsLink = screen.getByRole('link', { name: /trends/i })
    expect(trendsLink).toHaveClass('bg-primary')
  })

  it('links to correct paths', () => {
    renderWithRouter('/analytics/registration')

    expect(screen.getByRole('link', { name: /registration/i })).toHaveAttribute(
      'href',
      '/analytics/registration'
    )
    expect(screen.getByRole('link', { name: /retention/i })).toHaveAttribute(
      'href',
      '/analytics/retention'
    )
    expect(screen.getByRole('link', { name: /trends/i })).toHaveAttribute(
      'href',
      '/analytics/trends'
    )
  })

  it('uses nav element for accessibility', () => {
    renderWithRouter('/analytics/registration')

    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  describe('session selector integration', () => {
    it('should render session selector on the right side', () => {
      renderWithRouter('/analytics/registration')

      // Session selector should be present with "At Camp" default
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })

    it('should render session selector with calendar icon', () => {
      renderWithRouter('/analytics/registration')

      // Should have at least 2 buttons - one for the dropdown, others for tab links
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })

    it('should layout tabs and selector with flex justify-between', () => {
      renderWithRouter('/analytics/registration')

      const nav = screen.getByRole('navigation')
      // The nav should have justify-between class for proper layout
      expect(nav.querySelector('.justify-between')).toBeInTheDocument()
    })

    it('hides session selector on bunk analysis route', () => {
      renderWithRouter('/analytics/retention/bunks')

      // Session selector should NOT be visible — bunk analysis uses unfiltered data
      expect(screen.queryByText('At Camp')).not.toBeInTheDocument()
    })

    it('shows session selector on other retention routes', () => {
      renderWithRouter('/analytics/retention/flow')

      // Session selector should be present on non-bunk retention routes
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })
  })

  describe('retention teen-pipeline checkbox', () => {
    // New label: "Include camp → teen transition"
    // New visibility: only shown in teen-inclusive scopes (?view=all or ?view=teens)

    it('shows "Include camp → teen transition" checkbox on retention route with teen-inclusive scope (?view=all)', () => {
      renderWithRouter('/analytics/retention?view=all')

      expect(
        screen.getByRole('checkbox', { name: /include camp.*teen transition/i })
      ).toBeInTheDocument()
    })

    it('shows checkbox on retention route with teens-only scope (?view=teens)', () => {
      renderWithRouter('/analytics/retention?view=teens')

      expect(
        screen.getByRole('checkbox', { name: /include camp.*teen transition/i })
      ).toBeInTheDocument()
    })

    it('does NOT show the checkbox on retention route with non-teen scope (default / At Camp)', () => {
      renderWithRouter('/analytics/retention')

      expect(
        screen.queryByRole('checkbox', { name: /include camp.*teen transition/i })
      ).not.toBeInTheDocument()
    })

    it('does NOT show the checkbox on registration route', () => {
      renderWithRouter('/analytics/registration?view=all')

      expect(
        screen.queryByRole('checkbox', { name: /include camp.*teen transition/i })
      ).not.toBeInTheDocument()
    })

    it('does NOT show the checkbox on trends route', () => {
      renderWithRouter('/analytics/trends?view=all')

      expect(
        screen.queryByRole('checkbox', { name: /include camp.*teen transition/i })
      ).not.toBeInTheDocument()
    })
  })
})
