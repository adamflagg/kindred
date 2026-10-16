/**
 * Trends compares retention with the same point last year (#3207 PR 11, rulings #86, #87, #89, #90):
 * the dashed same-day line and the Year-by-Year table's Retention columns, while live; finals after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  // The previous season read at this season's registration day (decision 7).
  useRegistrationMetrics: vi.fn(() => ({ data: undefined })),
}))

vi.mock('../../../hooks/useCompareYearFilter', () => ({
  useCompareYearFilter: (_p: number, _c: number | null, options: unknown) => options,
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

import TrendsOverview from './TrendsOverview'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'
import { useHistoricalTrends, useRegistrationMetrics } from '../../../hooks/useMetrics'

const t = (from: number, rate: number, samePoint: number | null = null) => ({
  from_year: from,
  to_year: from + 1,
  retention_rate: rate,
  base_count: 1000,
  returned_count: Math.round(rate * 1000),
  by_gender: [],
  by_grade: [],
  same_point_rate: samePoint,
})

function trends(live: boolean) {
  vi.mocked(useRetentionTrends).mockReturnValue({
    data: live
      ? {
          years: [t(2023, 0.697, 0.619), t(2024, 0.706, 0.627), t(2025, 0.655, 0.655)],
          prior_basis: 'same_point',
          as_of_date: '2025-10-16',
          day_offset: -27,
          prior_day_offset: -27,
          enrollment_by_year: [],
        }
      : {
          years: [t(2023, 0.697), t(2024, 0.706), t(2025, 0.712)],
          prior_basis: 'final',
          enrollment_by_year: [],
        },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useRetentionTrends>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMetricsSession.activeSessionTypes = ['main', 'embedded']
  vi.mocked(useHistoricalTrends).mockReturnValue({
    data: {
      years: [
        { ...mockHistoricalYear, year: 2024, total_enrolled: 2052 },
        { ...mockHistoricalYear, year: 2025, total_enrolled: 2079 },
        { ...mockHistoricalYear, year: 2026, total_enrolled: 1927 },
      ],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useHistoricalTrends>)
})

describe('while registration is live', () => {
  beforeEach(() => {
    trends(true)
    vi.mocked(useRegistrationMetrics).mockReturnValue({
      data: {
        prior_basis: 'same_point',
        as_of_date: '2025-10-16',
        day_offset: -27,
        total_enrolled: 1965,
      },
    } as unknown as ReturnType<typeof useRegistrationMetrics>)
  })

  it('says the basis', () => {
    renderWithClient()
    expect(screen.getByText('vs same point last year.')).toBeInTheDocument()
    expect(
      screen.getByText(/compared with each earlier year at the same registration day \(Oct 16\)/)
    ).toBeInTheDocument()
  })

  it('adds Retention and Retention change to the table, the live row to date', () => {
    renderWithClient()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('button', { name: /^Retention4/ })).toBeInTheDocument()
    const row = within(table).getByText('2026', { selector: 'td' }).closest('tr')!
    expect(within(row).getByText('to date')).toBeInTheDocument()
    expect(within(row).getByText('▲ +2.8 pts')).toBeInTheDocument()
  })

  it("draws the dashed same-day line with its note after the table's", () => {
    const { container } = renderWithClient()
    expect(container).toHaveTextContent('dashed: each year at Oct 16 of its own registration6')
    expect(screen.getByText(/Each year as it stood at Oct 16/).closest('li')).toHaveTextContent(
      /^6\./
    )
  })
})

describe('after registration', () => {
  beforeEach(() => {
    trends(false)
    vi.mocked(useRegistrationMetrics).mockReturnValue({
      data: { prior_basis: 'final', total_enrolled: 2079 },
    } as unknown as ReturnType<typeof useRegistrationMetrics>)
  })

  it('has no dashed line, and reads final to final', () => {
    renderWithClient()
    expect(screen.queryByText(/dashed/)).not.toBeInTheDocument()
    expect(screen.getByText("vs last year's final.")).toBeInTheDocument()
    const row = within(screen.getByRole('table'))
      .getByText('2026', { selector: 'td' })
      .closest('tr')!
    expect(within(row).queryByText('to date')).not.toBeInTheDocument()
    expect(within(row).getByText('71.2%')).toBeInTheDocument()
  })
})
