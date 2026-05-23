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

// Mock data with by_grade entries including grade 10 and aged_out_count > 0
const mockDataWithGrade10: RetentionMetrics = {
  ...mockData,
  by_grade: [
    { grade: 9, base_count: 20, returned_count: 15, retention_rate: 0.75 },
    { grade: 10, base_count: 10, returned_count: 8, retention_rate: 0.8 },
  ],
  aged_out_count: 5,
}

const useRetentionMetricsMock = vi.fn()
let mockIncludeTeenPipeline = true

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
    includeTeenPipeline: mockIncludeTeenPipeline,
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
    mockIncludeTeenPipeline = true
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

describe('RetentionOverview grade-10 reference marking + aged-out note', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when includeTeenPipeline is false', () => {
    beforeEach(() => {
      mockIncludeTeenPipeline = false
      useRetentionMetricsMock.mockReturnValue({
        data: mockDataWithGrade10,
        isLoading: false,
        error: null,
      })
    })

    it('renders a grade-10 reference footnote below the grade chart', () => {
      render(<RetentionOverview />)

      // Should see a footnote indicating grade-10 is reference-only
      expect(screen.getByText(/shown for reference/i)).toBeInTheDocument()
    })

    it('aged-out note mentions the by-grade chart, not just 10th graders', () => {
      render(<RetentionOverview />)

      // Must NOT say the old bare "10th grader" copy
      expect(screen.queryByText(/10th grader.*aged out/i)).not.toBeInTheDocument()

      // Must point the reader to the by-grade chart and the toggle
      expect(screen.getByText(/by-grade chart/i)).toBeInTheDocument()
    })

    it('aged-out note mentions enabling the toggle to fold grade-10 into rate', () => {
      render(<RetentionOverview />)

      // Both the aged-out note and the chart footnote reference the toggle — at least one must appear
      expect(screen.getAllByText(/include.*summer.*teen/i).length).toBeGreaterThan(0)
    })

    it('does NOT render the reference footnote when by_grade has no grade-10 row', () => {
      // Teen-scope view (e.g. SCIT/TLI selected): base is all teens, no grade-10 bar.
      useRetentionMetricsMock.mockReturnValue({
        data: {
          ...mockDataWithGrade10,
          by_grade: [{ grade: 9, base_count: 20, returned_count: 15, retention_rate: 0.75 }],
        },
        isLoading: false,
        error: null,
      })
      render(<RetentionOverview />)

      // No grade-10 bar → footnote would be confusing, so it must be absent
      expect(screen.queryByText(/shown for reference/i)).not.toBeInTheDocument()
    })
  })

  describe('when includeTeenPipeline is true', () => {
    beforeEach(() => {
      mockIncludeTeenPipeline = true
      useRetentionMetricsMock.mockReturnValue({
        data: mockDataWithGrade10,
        isLoading: false,
        error: null,
      })
    })

    it('does NOT render the grade-10 reference footnote', () => {
      render(<RetentionOverview />)

      expect(screen.queryByText(/shown for reference/i)).not.toBeInTheDocument()
    })

    it('aged-out note uses the graduating-only copy (no by-grade chart mention)', () => {
      render(<RetentionOverview />)

      // Should see the flag-ON copy about graduating campers
      expect(screen.getByText(/graduating/i)).toBeInTheDocument()

      // Must NOT point to by-grade chart (that's flag-OFF copy)
      expect(screen.queryByText(/by-grade chart/i)).not.toBeInTheDocument()
    })
  })
})
