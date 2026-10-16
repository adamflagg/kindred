/**
 * TDD Tests for TrendsOverview — "Camp → Teen" checkbox on RetentionRateLine.
 *
 * Tests are written FIRST before implementation (TDD).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// --- module mocks ---

// Control mock state for useMetricsSession
const mockMetricsSession = {
  activeSessionTypes: ['main', 'embedded'] as readonly string[],
  get scopeHasTeens() {
    return this.activeSessionTypes.some((t) => t === 'scit' || t === 'tli')
  },
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
  useHistoricalTrends: vi.fn(() => ({
    data: { years: [mockHistoricalYear] },
    isLoading: false,
    error: null,
  })),
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
import { useHistoricalTrends } from '../../../hooks/useMetrics'

describe('TrendsOverview — Camp → Teen checkbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMetricsSession.includeTeenPipeline = false
    mockMetricsSession.setIncludeTeenPipeline = vi.fn()
    vi.mocked(useRetentionTrends).mockReturnValue(
      mockRetentionTrends as unknown as ReturnType<typeof useRetentionTrends>
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

describe('TrendsOverview — teen-pipeline flag gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRetentionTrends).mockReturnValue(
      mockRetentionTrends as unknown as ReturnType<typeof useRetentionTrends>
    )
  })

  it('forwards includeTeenPipeline to useRetentionTrends in a teen scope', () => {
    mockMetricsSession.activeSessionTypes = ['scit', 'tli']
    mockMetricsSession.includeTeenPipeline = true
    renderWithClient()
    expect(useRetentionTrends).toHaveBeenLastCalledWith(
      2026,
      expect.objectContaining({ includeTeenPipeline: true })
    )
  })

  it('does NOT forward includeTeenPipeline when the scope has no teens', () => {
    mockMetricsSession.activeSessionTypes = ['main', 'embedded']
    mockMetricsSession.includeTeenPipeline = true
    renderWithClient()
    // Hidden flag must not leak into the hook call / cache key in a non-teen scope.
    expect(useRetentionTrends).toHaveBeenLastCalledWith(
      2026,
      expect.objectContaining({ includeTeenPipeline: false })
    )
  })
})

describe('TrendsOverview — no-coverage years render em-dash, not fabricated zero (#2443)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMetricsSession.includeTeenPipeline = false
    vi.mocked(useRetentionTrends).mockReturnValue(
      mockRetentionTrends as unknown as ReturnType<typeof useRetentionTrends>
    )
  })

  it('renders an em-dash for Cancelled/Cancel % when has_cancellation_data is false', () => {
    vi.mocked(useHistoricalTrends).mockReturnValue({
      data: {
        years: [
          {
            ...mockHistoricalYear,
            year: 2022,
            total_cancelled: 0,
            cancellation_rate: 0,
            has_cancellation_data: false,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHistoricalTrends>)

    renderWithClient()

    const table = screen.getByRole('table')
    const row = within(table).getByText('2022').closest('tr')
    expect(row).not.toBeNull()
    const cells = row ? Array.from(row.querySelectorAll('td')).map((td) => td.textContent) : []
    // Cancelled and Cancel % are the last two columns.
    expect(cells.at(-2)).toBe('—')
    expect(cells.at(-1)).toBe('—')
  })

  it('renders the real numbers when has_cancellation_data is true', () => {
    vi.mocked(useHistoricalTrends).mockReturnValue({
      data: {
        years: [
          {
            ...mockHistoricalYear,
            year: 2026,
            total_cancelled: 276,
            cancellation_rate: 43.9,
            has_cancellation_data: true,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHistoricalTrends>)

    renderWithClient()

    const table = screen.getByRole('table')
    const row = within(table).getByText('2026').closest('tr')
    expect(row).not.toBeNull()
    const cells = row ? Array.from(row.querySelectorAll('td')).map((td) => td.textContent) : []
    expect(cells.at(-2)).toBe('276')
    expect(cells.at(-1)).toBe('43.9%')
  })

  it('treats has_cancellation_data as true when the field is absent (backward compat)', () => {
    vi.mocked(useHistoricalTrends).mockReturnValue({
      data: {
        years: [{ ...mockHistoricalYear, year: 2026, total_cancelled: 5, cancellation_rate: 4.5 }],
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHistoricalTrends>)

    renderWithClient()

    const table = screen.getByRole('table')
    const row = within(table).getByText('2026').closest('tr')
    const cells = row ? Array.from(row.querySelectorAll('td')).map((td) => td.textContent) : []
    expect(cells.at(-2)).toBe('5')
    expect(cells.at(-1)).toBe('4.5%')
  })
})

describe('TrendsOverview — First Summer Year earliest bucket (#3207 36b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMetricsSession.activeSessionTypes = ['main', 'embedded']
  })

  it('labels the 2017 bucket "2017 or earlier"', () => {
    const year = (y: number) => ({
      year: y,
      total: 10,
      by_gender: [],
      by_grade: [],
      by_city: [],
      by_school: [],
      by_synagogue: [],
      by_summer_years: [],
      by_first_summer_year: [
        { first_summer_year: 2017, count: 4 },
        { first_summer_year: 2019, count: 6 },
      ],
    })
    vi.mocked(useRetentionTrends).mockReturnValue({
      ...mockRetentionTrends,
      data: { ...mockRetentionTrends.data, enrollment_by_year: [year(2025), year(2026)] },
    } as unknown as ReturnType<typeof useRetentionTrends>)

    renderWithClient()

    expect(screen.getAllByText('2017 or earlier').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^2017$/)).toBeNull()
  })
})

describe('TrendsOverview — numbered notes and number formatting (decisions 11, 43)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMetricsSession.includeTeenPipeline = false
    vi.mocked(useRetentionTrends).mockReturnValue(
      mockRetentionTrends as unknown as ReturnType<typeof useRetentionTrends>
    )
    vi.mocked(useHistoricalTrends).mockReturnValue({
      data: {
        years: [
          { ...mockHistoricalYear, year: 2025, total_enrolled: 2390, total_cancelled: 1208 },
          { ...mockHistoricalYear, year: 2026, total_enrolled: 1134, total_cancelled: 172 },
        ],
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useHistoricalTrends>)
  })

  it('marks Cancelled and Cancel % with numbered notes listed at the foot, no hover text', () => {
    renderWithClient()
    const table = screen.getByRole('table')
    const headers = Array.from(table.querySelectorAll('th'))
    const cancelled = headers.find((th) => th.textContent.startsWith('Cancelled'))
    const rate = headers.find((th) => th.textContent.startsWith('Cancel %'))
    expect(cancelled?.querySelector('sup')?.textContent).toBe('1')
    expect(rate?.querySelector('sup')?.textContent).toBe('2')
    expect(table.querySelector('[title]')).toBeNull()
    expect(screen.getByText(/whose status in CampMinder is Cancelled now/)).toBeInTheDocument()
    expect(screen.getByText(/cancelled ÷ \(enrolled \+ cancelled\)/)).toBeInTheDocument()
  })

  it('writes the total change with the true minus and separators', () => {
    renderWithClient()
    // Total Change and Avg. Annual Growth both read it over two years.
    expect(screen.getAllByText('\u22121,256')).toHaveLength(2)
    expect(screen.getByText('1,208')).toBeInTheDocument()
  })
})
