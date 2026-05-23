/**
 * TDD: RetentionOverview reads includeTeenPipeline from MetricsSessionContext (Task 8 → R3)
 *
 * Strategy: provide full mock data (not isLoading:true) so the component renders
 * past all early-return guards. The checkbox has MOVED to MetricsTypeTabs; here we
 * verify useRetentionMetrics is called with the flag sourced from context.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RetentionOverview from './RetentionOverview'
import type { RetentionMetrics } from '../../../types/metrics'

// Minimal mock data that satisfies all fields RetentionOverview reads.
const mockData: RetentionMetrics = {
  base_year: 2025,
  compare_year: 2026,
  base_year_total: 100,
  compare_year_total: 90,
  returned_count: 70,
  overall_retention_rate: 0.7,
  by_gender: [],
  by_grade: [],
  by_session: [],
  by_years_at_camp: [],
  by_summer_years: [],
  by_first_summer_year: [],
  by_prior_session: [],
  by_city: [],
  by_school: [],
  by_synagogue: [],
  session_flow: [],
  aged_out_count: 0,
}

const useRetentionMetricsMock = vi.fn()

vi.mock('../../../hooks/useMetrics', () => ({
  useRetentionMetrics: (...args: unknown[]) => useRetentionMetricsMock(...args),
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => ({
    selectedSessionCmId: null,
    sessions: [],
    activeSessionTypes: ['main', 'embedded', 'ag', 'quest'],
    durationParam: undefined,
    filterOptions: { sessionTypes: 'main,embedded,ag,quest' },
    // other fields used by useDrilldown init
    selectedSession: undefined,
    isLoading: false,
    setSelectedSessionCmId: vi.fn(),
    clearSession: vi.fn(),
    viewMode: 'sessions',
    setViewMode: vi.fn(),
    sessionTypesParam: 'main,embedded,ag,quest',
    campSessions: [],
    questSessions: [],
    teenSessions: [],
    hasScit: false,
    hasTli: false,
    selectedTeenType: null,
    setSelectedTeenType: vi.fn(),
    selectedDuration: null,
    setSelectedDuration: vi.fn(),
    durationGroups: new Map(),
    expandedRetention: false,
    setExpandedRetention: vi.fn(),
    compareYear: null,
    setCompareYear: vi.fn(),
    isComparing: false,
    includeTeenPipeline: true,
    setIncludeTeenPipeline: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

// Mock useDrilldown — it returns { setFilter, DrilldownModal }
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: () => ({
    setFilter: vi.fn(),
    DrilldownModal: () => null,
  }),
}))

// Mock chart components so they don't blow up without canvas
vi.mock('../../../components/metrics/BreakdownChart', () => ({
  BreakdownChart: () => null,
}))
vi.mock('../../../components/metrics/CssVerticalRetentionBarChart', () => ({
  CssVerticalRetentionBarChart: () => null,
}))
vi.mock('../../../components/metrics/RetentionRateLineChart', () => ({
  RetentionRateLineChart: () => null,
}))
vi.mock('../../../components/metrics/MetricCard', () => ({
  MetricCard: () => null,
}))
vi.mock('../../../components/metrics/RetentionNotableOutliers', () => ({
  OutlierSection: () => null,
}))

describe('RetentionOverview teen-pipeline flag from context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRetentionMetricsMock.mockReturnValue({ data: mockData, isLoading: false, error: null })
  })

  it('does NOT render the teen-pipeline checkbox (it lives in MetricsTypeTabs now)', () => {
    render(<RetentionOverview />)

    expect(
      screen.queryByRole('checkbox', { name: /include summer.*teen retention/i })
    ).not.toBeInTheDocument()
  })

  it('passes includeTeenPipeline from context (true) as 4th arg to useRetentionMetrics', () => {
    render(<RetentionOverview />)

    // Context mock returns includeTeenPipeline: true — verify it flows into the hook call
    expect(useRetentionMetricsMock).toHaveBeenLastCalledWith(2025, 2026, expect.anything(), true)
  })
})
