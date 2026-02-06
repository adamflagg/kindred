/**
 * Tests for WaitlistAnalysis component
 *
 * TDD: Tests written first to define expected rendering behavior
 * for the waitlist analysis tab before implementation.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WaitlistAnalysis from './WaitlistAnalysis'

// Mock data matching the WaitlistMetrics interface
const mockWaitlistData = {
  year: 2026,
  total_waitlisted: 5,
  waitlisted_no_enrollment: 2,
  waitlisted_has_enrollment: 3,
  total_accepted: 4,
  total_declined: 1,
  by_session: [
    {
      session_cm_id: 1001,
      session_name: 'Session 1',
      waitlisted: 3,
      no_enrollment: 1,
      has_enrollment: 2,
      accepted: 2,
      declined: 0,
    },
    {
      session_cm_id: 1002,
      session_name: 'Session 2',
      waitlisted: 2,
      no_enrollment: 1,
      has_enrollment: 1,
      accepted: 2,
      declined: 1,
    },
  ],
  by_grade: [
    { grade: 5, count: 2, percentage: 40.0 },
    { grade: 6, count: 3, percentage: 60.0 },
  ],
  by_gender: [
    { gender: 'F', count: 3, percentage: 60.0 },
    { gender: 'M', count: 2, percentage: 40.0 },
  ],
}

// Mock hooks
const mockUseWaitlistMetrics = vi.fn()
vi.mock('../../../hooks/useMetrics', () => ({
  useRegistrationMetrics: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useRetentionMetrics: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useComparisonMetrics: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useHistoricalTrends: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useWaitlistMetrics: (...args: unknown[]) => mockUseWaitlistMetrics(...args),
}))

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2026 })),
  CurrentYearContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(() => ({
    selectedSessionCmId: null,
    selectedSession: undefined,
    sessions: [],
    isLoading: false,
    setSelectedSessionCmId: vi.fn(),
    clearSession: vi.fn(),
  })),
}))

const renderWithClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <WaitlistAnalysis />
    </QueryClientProvider>
  )
}

describe('WaitlistAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows loading spinner when data is loading', () => {
      mockUseWaitlistMetrics.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      })

      renderWithClient()

      expect(screen.getByText(/loading waitlist/i)).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message on fetch failure', () => {
      mockUseWaitlistMetrics.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Failed to fetch'),
      })

      renderWithClient()

      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows no data message when data is null', () => {
      mockUseWaitlistMetrics.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      })

      renderWithClient()

      expect(screen.getByText(/no data/i)).toBeInTheDocument()
    })
  })

  describe('with data', () => {
    beforeEach(() => {
      mockUseWaitlistMetrics.mockReturnValue({
        data: mockWaitlistData,
        isLoading: false,
        error: null,
      })
    })

    it('renders summary cards with correct counts', () => {
      renderWithClient()

      // Each summary value appears within a MetricCard (text-2xl font-bold).
      // Values may also appear in the session table, so use getAllByText.
      // Total Waitlisted = 5 (unique to summary card)
      expect(screen.getByText('5')).toBeInTheDocument()

      // Accepted = 4 (unique to summary card; table shows per-session accepted)
      expect(screen.getByText('4')).toBeInTheDocument()

      // Values 1, 2, 3 appear in both summary cards and session table.
      // Verify they render at all (at least once).
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
    })

    it('renders summary card labels', () => {
      renderWithClient()

      expect(screen.getByText(/total waitlisted/i)).toBeInTheDocument()
      expect(screen.getByText(/no other sessions/i)).toBeInTheDocument()
      // "Accepted" and "Declined" appear in both summary cards and table headers
      expect(screen.getAllByText(/accepted/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/declined/i).length).toBeGreaterThanOrEqual(1)
    })

    it('renders session details table', () => {
      renderWithClient()

      expect(screen.getByText('Session 1')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    it('renders grade breakdown', () => {
      renderWithClient()

      // Should show grade distribution section header
      expect(screen.getByText(/grade distribution/i)).toBeInTheDocument()
    })
  })

  describe('with zero waitlisted', () => {
    it('shows appropriate messaging when no one is waitlisted', () => {
      mockUseWaitlistMetrics.mockReturnValue({
        data: {
          ...mockWaitlistData,
          total_waitlisted: 0,
          waitlisted_no_enrollment: 0,
          waitlisted_has_enrollment: 0,
          total_accepted: 0,
          total_declined: 0,
          by_session: [],
          by_grade: [],
          by_gender: [],
        },
        isLoading: false,
        error: null,
      })

      renderWithClient()

      // Should render without errors even with zeros (multiple cards show 0)
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1)
    })
  })
})
