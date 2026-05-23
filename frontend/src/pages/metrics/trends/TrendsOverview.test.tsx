/**
 * TDD Tests for TrendsOverview — "Camp → Teen" checkbox on RetentionRateLine.
 *
 * Tests are written FIRST before implementation (TDD).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// --- module mocks ---

// Control mock state for useMetricsSession
const mockMetricsSession = {
  activeSessionTypes: ['main', 'embedded'] as readonly string[],
  includeTeenPipeline: false,
  setIncludeTeenPipeline: vi.fn(),
  expandedRetention: false,
  filterOptions: { sessionTypes: 'main,embedded' },
  selectedSessionCmId: null,
}

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => mockMetricsSession,
}))

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: 2026,
    availableYears: [2024, 2025, 2026],
    isTransitioning: false,
    isYearReady: true,
  }),
}))

const mockRetentionTrends = {
  data: {
    years: [
      {
        from_year: 2025,
        to_year: 2026,
        retention_rate: 0.65,
        base_count: 100,
        returned_count: 65,
        by_gender: [],
        by_grade: [],
      },
    ],
    avg_retention_rate: 0.65,
    trend_direction: 'stable',
    enrollment_by_year: [],
  },
  isLoading: false,
  error: null,
}

vi.mock('../../../hooks/useRetentionTrends', () => ({
  useRetentionTrends: vi.fn(() => mockRetentionTrends),
}))

const mockHistoricalYear = {
  year: 2026,
  total_enrolled: 100,
  new_campers: 40,
  returning_campers: 60,
  total_cancelled: 0,
  cancellation_rate: 0,
  new_vs_returning: {
    new_count: 40,
    returning_count: 60,
    new_percentage: 40,
    returning_percentage: 60,
  },
  by_gender: [],
  by_grade: [],
  by_summer_years: [],
  by_first_summer_year: [],
  by_city: [],
  by_school: [],
  by_synagogue: [],
}

vi.mock('../../../hooks/useMetrics', () => ({
  useHistoricalTrends: () => ({
    data: { years: [mockHistoricalYear] },
    isLoading: false,
    error: null,
  }),
}))

// Stub out recharts to avoid ResizeObserver issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: () => null,
  LabelList: () => null,
}))

// --- helpers ---

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrendsOverview />
    </QueryClientProvider>
  )
}

// Import after mocks are set up
import TrendsOverview from './TrendsOverview'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'

describe('TrendsOverview — Camp → Teen checkbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMetricsSession.includeTeenPipeline = false
    mockMetricsSession.setIncludeTeenPipeline = vi.fn()
    vi.mocked(useRetentionTrends).mockReturnValue(
      mockRetentionTrends as ReturnType<typeof useRetentionTrends>
    )
  })

  it('shows "Camp → Teen" checkbox when activeSessionTypes includes scit', () => {
    mockMetricsSession.activeSessionTypes = ['scit']
    renderWithClient()
    expect(screen.getByLabelText(/Camp → Teen/i)).toBeInTheDocument()
  })

  it('shows "Camp → Teen" checkbox when activeSessionTypes includes tli', () => {
    mockMetricsSession.activeSessionTypes = ['tli']
    renderWithClient()
    expect(screen.getByLabelText(/Camp → Teen/i)).toBeInTheDocument()
  })

  it('hides checkbox when scope is [main, quest] (no teens)', () => {
    mockMetricsSession.activeSessionTypes = ['main', 'quest']
    renderWithClient()
    expect(screen.queryByLabelText(/Camp → Teen/i)).not.toBeInTheDocument()
  })

  it('calls setIncludeTeenPipeline(true) when checkbox is clicked', () => {
    mockMetricsSession.activeSessionTypes = ['scit', 'tli']
    renderWithClient()
    const checkbox = screen.getByLabelText(/Camp → Teen/i)
    fireEvent.click(checkbox)
    expect(mockMetricsSession.setIncludeTeenPipeline).toHaveBeenCalledWith(true)
  })
})
