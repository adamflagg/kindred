/**
 * TDD: RetentionOverview "Include summer → teen retention" checkbox (Task 8)
 *
 * Strategy: provide full mock data (not isLoading:true) so the component renders
 * past all early-return guards and the checkbox is reachable via getByLabelText.
 * The checkbox is placed near the aged_out_count note, after the loading guard.
 */
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('RetentionOverview teen-pipeline checkbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRetentionMetricsMock.mockReturnValue({ data: mockData, isLoading: false, error: null })
  })

  it('defaults off and toggles include_teen_pipeline', () => {
    render(<RetentionOverview />)

    const checkbox = screen.getByLabelText<HTMLInputElement>(/include summer.*teen retention/i)
    expect(checkbox.checked).toBe(false)
    // Initial render: called with includeTeenPipeline = false
    expect(useRetentionMetricsMock).toHaveBeenLastCalledWith(2025, 2026, expect.anything(), false)

    fireEvent.click(checkbox)
    // After toggle: called with includeTeenPipeline = true
    expect(useRetentionMetricsMock).toHaveBeenLastCalledWith(2025, 2026, expect.anything(), true)
  })
})
