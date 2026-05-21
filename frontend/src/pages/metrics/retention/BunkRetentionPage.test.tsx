/**
 * Tests for BunkRetentionPage - Dedicated bunk retention heatmap tab.
 *
 * BunkRetentionPage calls useRetentionMetrics WITHOUT session filter params
 * so the heatmap always shows unfiltered "did camper return to camp at all" data.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CurrentYearContext, type CurrentYearContextType } from '../../../hooks/useCurrentYear'

// Mock hooks
vi.mock('../../../hooks/useMetrics', () => ({
  useRetentionMetrics: vi.fn(),
}))

vi.mock('../../../hooks/useBunkStaff', () => ({
  useBunkStaff: vi.fn(() => ({ data: undefined })),
}))

// Mock useMetricsSession to provide campSessions
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(() => ({
    campSessions: [],
  })),
}))

// Import mocked function for assertions
import { useRetentionMetrics } from '../../../hooks/useMetrics'

// Import the component under test (lazy, so we import directly)
import BunkRetentionPage from './BunkRetentionPage'

const mockYearContext: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026, 2025],
  isTransitioning: false,
  isYearReady: true,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/analytics/retention/bunks']}>
        <CurrentYearContext value={mockYearContext}>
          <Routes>
            <Route path="/analytics/retention/bunks" element={<BunkRetentionPage />} />
          </Routes>
        </CurrentYearContext>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('BunkRetentionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls useRetentionMetrics without session filter params', () => {
    ;(useRetentionMetrics as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    renderPage()

    // Should be called with (priorYear, currentYear) and NO session params
    expect(useRetentionMetrics).toHaveBeenCalledWith(2025, 2026)
  })

  it('shows loading state', () => {
    ;(useRetentionMetrics as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    renderPage()

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    ;(useRetentionMetrics as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    })

    renderPage()

    expect(screen.getByText(/network error/i)).toBeInTheDocument()
  })

  it('shows empty state when no data', () => {
    ;(useRetentionMetrics as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    })

    renderPage()

    expect(screen.getByText(/no.*data/i)).toBeInTheDocument()
  })

  it('shows empty message when data exists but by_session_bunk is missing', () => {
    ;(useRetentionMetrics as Mock).mockReturnValue({
      data: { overall: { base_count: 100, returned_count: 80, retention_rate: 0.8 } },
      isLoading: false,
      error: null,
    })

    renderPage()

    // Data exists but by_session_bunk is undefined — should show empty message, not blank
    expect(screen.getByText('No bunk retention data available')).toBeInTheDocument()
  })
})
