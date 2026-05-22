/**
 * Tests for Day1Page.
 *
 * Day 1 is a registration metrics page and must honor the shared session
 * picker like its siblings: the picker's session_types flow into the Day 1
 * query, and teen (SCIT/TLI) counts surface as their own breakdown.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Day1Page from './Day1Page'
import type { Day1Response } from '../../../types/day1'

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2026 })),
  CurrentYearContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}))

const mockUseMetricsSession = vi.fn()
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => mockUseMetricsSession(),
}))

const mockUseDay1 = vi.fn()
vi.mock('../../../hooks/useDay1', () => ({
  useDay1: (...args: unknown[]) => mockUseDay1(...args),
}))

/** A past-dated priority tier so the hero card renders its breakdown (not "Upcoming"). */
function makeData(teenCount: number): Day1Response {
  return {
    year: 2026,
    tiers: [
      {
        tier: 'priority',
        tier_label: 'Priority Registration',
        date: '2025-11-12',
        window_start: '2025-11-12T00:00:00-08:00',
        window_end: '2025-11-13T00:00:00-08:00',
        categories: [
          { category: 'at_camp', label: 'At Camp', count: 10 },
          { category: 'quest', label: 'Quest', count: 3 },
          { category: 'teen', label: 'Teens', count: teenCount },
        ],
        total: { count: 13 + teenCount },
        approximate: false,
      },
    ],
    prior_years: [],
  }
}

function setSession(sessionTypesParam: string) {
  mockUseMetricsSession.mockReturnValue({
    selectedSessionCmId: null,
    selectedSession: undefined,
    sessions: [],
    isLoading: false,
    viewMode: 'sessions',
    activeSessionTypes: sessionTypesParam.split(','),
    sessionTypesParam,
    campSessions: [],
    questSessions: [],
  })
}

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Day1Page />
    </QueryClientProvider>
  )
}

describe('Day1Page', () => {
  beforeEach(() => {
    mockUseMetricsSession.mockReset()
    mockUseDay1.mockReset()
  })

  it('forwards the picker session_types into the Day 1 query', () => {
    setSession('main,embedded,ag,quest,scit,tli')
    mockUseDay1.mockReturnValue({ data: makeData(4), isLoading: false, error: null })

    renderPage()

    expect(mockUseDay1).toHaveBeenCalledWith(2026, 'main,embedded,ag,quest,scit,tli')
  })

  it('renders a Teens breakdown when teen counts are present', () => {
    setSession('main,embedded,ag,quest,scit,tli')
    mockUseDay1.mockReturnValue({ data: makeData(4), isLoading: false, error: null })

    renderPage()

    expect(screen.getAllByText('Teens').length).toBeGreaterThan(0)
    // Teen count surfaces in both the hero chip and the comparison-table row.
    expect(screen.getAllByText('4').length).toBeGreaterThan(0)
  })

  it('omits the Teens breakdown when there are no teen counts', () => {
    setSession('main,embedded,ag')
    mockUseDay1.mockReturnValue({ data: makeData(0), isLoading: false, error: null })

    renderPage()

    expect(screen.queryByText('Teens')).not.toBeInTheDocument()
  })
})
