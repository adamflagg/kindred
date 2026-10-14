/**
 * Tests for MetricsTypeTabs component
 * Primary navigation for metrics module following SessionTabs pattern
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// The empty-season gate (PR 4, board 9 A). Default: the season has rows.
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

beforeEach(() => {
  mockSeasonRows.mockReset().mockReturnValue({ hasRows: true, isLoading: false })
})

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

    it('greys the session selector on bunk analysis, saying it is not used there (4B)', () => {
      renderWithRouter('/analytics/retention/bunks')

      // Bunk analysis uses unfiltered data: the picker shows, disabled, with the reason inside.
      expect(screen.queryByText('At Camp')).not.toBeInTheDocument()
      const picker = screen.getByRole('button', { name: /At Camp · not used here/ })
      expect(picker).toBeDisabled()
    })

    it('shows session selector on other retention routes', () => {
      renderWithRouter('/analytics/retention/flow')

      // Session selector should be present on non-bunk retention routes
      expect(screen.getByText('At Camp')).toBeInTheDocument()
    })
  })

  describe('retention teen-pipeline checkbox', () => {
    const teenBox = () => screen.getByRole('checkbox', { name: /include camp.*teen transition/i })

    it('is live on retention with a teen-inclusive scope (?view=all)', () => {
      renderWithRouter('/analytics/retention?view=all')
      expect(teenBox()).toBeEnabled()
    })

    it('is live on retention with the teens-only scope (?view=teens)', () => {
      renderWithRouter('/analytics/retention?view=teens')
      expect(teenBox()).toBeEnabled()
    })

    it('is disabled with its reason inside on a scope without teens (4B)', () => {
      renderWithRouter('/analytics/retention')
      expect(teenBox()).toBeDisabled()
      expect(
        screen.getByText('Include camp → teen transition: needs Teens or All Summer')
      ).toBeInTheDocument()
    })

    it('is disabled on Bunk Analysis, saying so', () => {
      renderWithRouter('/analytics/retention/bunks?view=all')
      expect(teenBox()).toBeDisabled()
      expect(
        screen.getByText('Include camp → teen transition: not on Bunk Analysis')
      ).toBeInTheDocument()
    })

    it('does NOT show on registration', () => {
      renderWithRouter('/analytics/registration?view=all')
      expect(
        screen.queryByRole('checkbox', { name: /include camp.*teen transition/i })
      ).not.toBeInTheDocument()
    })

    it('does NOT show on trends', () => {
      renderWithRouter('/analytics/trends?view=all')
      expect(
        screen.queryByRole('checkbox', { name: /include camp.*teen transition/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('disabled with the reason inside (PR 4, pick 4B)', () => {
    it('Compare reads "not on Day 1" on Day 1, where it does nothing', () => {
      renderWithRouter('/analytics/registration/day1')
      expect(screen.getByRole('button', { name: 'Compare: not on Day 1' })).toBeDisabled()
    })

    it('Compare reads "not on Forecast" on Forecast instead of vanishing', () => {
      renderWithRouter('/analytics/registration/forecast')
      expect(screen.getByRole('button', { name: 'Compare: not on Forecast' })).toBeDisabled()
    })

    it('Compare is live on Overview', () => {
      renderWithRouter('/analytics/registration/overview')
      expect(screen.getByRole('button', { name: /Compare to/ })).toBeEnabled()
    })

    it('Expanded analysis reads "not on Cancellations" on Trends › Cancellations', () => {
      renderWithRouter('/analytics/trends/cancellations')
      expect(screen.getByRole('checkbox', { name: /Expanded analysis/ })).toBeDisabled()
      expect(screen.getByText('Expanded analysis: not on Cancellations')).toBeInTheDocument()
    })

    it('Expanded analysis is live on the Trends overview', () => {
      renderWithRouter('/analytics/trends')
      expect(screen.getByRole('checkbox', { name: /Expanded analysis/ })).toBeEnabled()
    })
  })

  describe('empty season (board 9 A)', () => {
    beforeEach(() => {
      mockSeasonRows.mockReturnValue({ hasRows: false, isLoading: false })
    })

    it('asks about the viewed season', () => {
      renderWithRouter('/analytics/registration/overview')
      expect(mockSeasonRows).toHaveBeenCalledWith(2026)
    })

    it('greys Compare with "no 2026 enrollments yet"', () => {
      renderWithRouter('/analytics/registration/overview')
      expect(
        screen.getByRole('button', { name: 'Compare: no 2026 enrollments yet' })
      ).toBeDisabled()
    })

    it('greys Expanded analysis and the teen box the same way', () => {
      renderWithRouter('/analytics/trends')
      expect(screen.getByText('Expanded analysis: no 2026 enrollments yet')).toBeInTheDocument()
    })

    it('greys the teen box on Retention', () => {
      renderWithRouter('/analytics/retention?view=all')
      expect(
        screen.getByText('Include camp → teen transition: no 2026 enrollments yet')
      ).toBeInTheDocument()
    })

    it('keeps the session picker live', () => {
      renderWithRouter('/analytics/registration/overview')
      expect(screen.getByRole('button', { name: /At Camp/ })).toBeEnabled()
    })
  })
})
