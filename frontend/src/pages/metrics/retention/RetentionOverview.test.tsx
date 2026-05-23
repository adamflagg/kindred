/**
 * TDD: RetentionOverview reads includeTeenPipeline + activeSessionTypes from
 * MetricsSessionContext (Task 8 → R3, FX2).
 *
 * Strategy: provide full mock data (not isLoading:true) so the component renders
 * past all early-return guards. The checkbox has MOVED to MetricsTypeTabs; here we
 * verify useRetentionMetrics is called with the flag sourced from context, and that
 * the aged-out note is scope-aware.
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

// Mutable session state — updated per describe/it block before each render
let mockIncludeTeenPipeline = true
let mockActiveSessionTypes: string[] = ['main', 'embedded', 'ag', 'quest']

vi.mock('../../../hooks/useMetrics', () => ({
  useRetentionMetrics: (...args: unknown[]) => useRetentionMetricsMock(...args),
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => ({
    selectedSessionCmId: null,
    sessions: [],
    activeSessionTypes: mockActiveSessionTypes,
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
    mockActiveSessionTypes = ['main', 'embedded', 'ag', 'quest']
    useRetentionMetricsMock.mockReturnValue({ data: mockData, isLoading: false, error: null })
  })

  it('does NOT render the teen-pipeline checkbox (it lives in MetricsTypeTabs now)', () => {
    render(<RetentionOverview />)

    expect(
      screen.queryByRole('checkbox', { name: /include camp.*tli\/scit retention/i })
    ).not.toBeInTheDocument()
  })

  it('passes includeTeenPipeline from context (true) as 4th arg to useRetentionMetrics', () => {
    render(<RetentionOverview />)

    // Context mock returns includeTeenPipeline: true — verify it flows into the hook call
    expect(useRetentionMetricsMock).toHaveBeenLastCalledWith(2025, 2026, expect.anything(), true)
  })
})

describe('RetentionOverview aged-out note — scope-aware composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('teen scope, flag OFF — both 10th and graduating excluded', () => {
    // aged_out_count = n10 + n12 = 10 (grade-10 base_count) + 3 (graduating)
    const n10 = 10
    const n12 = 3
    const dataTeenFlagOff: RetentionMetrics = {
      ...mockData,
      by_grade: [
        { grade: 9, base_count: 20, returned_count: 15, retention_rate: 0.75 },
        { grade: 10, base_count: n10, returned_count: 8, retention_rate: 0.8 },
      ],
      aged_out_count: n10 + n12,
    }

    beforeEach(() => {
      mockIncludeTeenPipeline = false
      mockActiveSessionTypes = ['main', 'embedded', 'ag', 'scit', 'tli']
      useRetentionMetricsMock.mockReturnValue({
        data: dataTeenFlagOff,
        isLoading: false,
        error: null,
      })
    })

    it('note mentions rising 10th graders count', () => {
      render(<RetentionOverview />)
      expect(screen.getByText(new RegExp(`${n10} rising 10th grader`))).toBeInTheDocument()
    })

    it('note mentions rising 12th graders count', () => {
      render(<RetentionOverview />)
      expect(screen.getByText(new RegExp(`${n12} rising 12th grader`))).toBeInTheDocument()
    })

    it('note mentions "check the box" to include 10th grader retention stats', () => {
      render(<RetentionOverview />)
      expect(
        screen.getByText(/check the box above to include 10th grader retention stats/i)
      ).toBeInTheDocument()
    })

    it('does NOT render the removed grade-10 "shown for reference" footnote', () => {
      render(<RetentionOverview />)
      expect(screen.queryByText(/shown for reference/i)).not.toBeInTheDocument()
    })
  })

  describe('teen scope, flag ON — only graduating excluded', () => {
    const n12 = 3
    const dataTeenFlagOn: RetentionMetrics = {
      ...mockData,
      by_grade: [
        { grade: 9, base_count: 20, returned_count: 15, retention_rate: 0.75 },
        { grade: 10, base_count: 10, returned_count: 8, retention_rate: 0.8 },
      ],
      aged_out_count: n12,
    }

    beforeEach(() => {
      mockIncludeTeenPipeline = true
      mockActiveSessionTypes = ['main', 'embedded', 'ag', 'scit', 'tli']
      useRetentionMetricsMock.mockReturnValue({
        data: dataTeenFlagOn,
        isLoading: false,
        error: null,
      })
    })

    it('note mentions rising 12th graders', () => {
      render(<RetentionOverview />)
      expect(screen.getByText(new RegExp(`${n12} rising 12th grader`))).toBeInTheDocument()
    })

    it('note does NOT mention rising 10th graders', () => {
      render(<RetentionOverview />)
      expect(screen.queryByText(/rising 10th grader/i)).not.toBeInTheDocument()
    })

    it('does NOT render the grade-10 "shown for reference" footnote', () => {
      render(<RetentionOverview />)
      expect(screen.queryByText(/shown for reference/i)).not.toBeInTheDocument()
    })
  })

  describe('non-teen scope (At Camp) — only rising 10th graders excluded', () => {
    const n10 = 7
    const dataAtCamp: RetentionMetrics = {
      ...mockData,
      // No grade-10 row in by_grade (backend omits it for non-teen scopes)
      by_grade: [
        { grade: 9, base_count: 20, returned_count: 15, retention_rate: 0.75 },
        { grade: 11, base_count: 5, returned_count: 4, retention_rate: 0.8 },
      ],
      aged_out_count: n10,
    }

    beforeEach(() => {
      mockIncludeTeenPipeline = false
      mockActiveSessionTypes = ['main', 'embedded', 'ag', 'quest']
      useRetentionMetricsMock.mockReturnValue({
        data: dataAtCamp,
        isLoading: false,
        error: null,
      })
    })

    it('note mentions rising 10th graders count', () => {
      render(<RetentionOverview />)
      expect(screen.getByText(new RegExp(`${n10} rising 10th grader`))).toBeInTheDocument()
    })

    it('note does NOT mention rising 12th graders', () => {
      render(<RetentionOverview />)
      expect(screen.queryByText(/rising 12th grader/i)).not.toBeInTheDocument()
    })

    it('note does NOT mention "check the box"', () => {
      render(<RetentionOverview />)
      expect(screen.queryByText(/check the box/i)).not.toBeInTheDocument()
    })

    it('does NOT render the grade-10 "shown for reference" footnote (no grade-10 row)', () => {
      render(<RetentionOverview />)
      expect(screen.queryByText(/shown for reference/i)).not.toBeInTheDocument()
    })
  })
})

// Legacy tests preserved — keep these green
describe('RetentionOverview grade-10 reference marking + aged-out note (legacy)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when includeTeenPipeline is false (non-teen scope)', () => {
    beforeEach(() => {
      mockIncludeTeenPipeline = false
      mockActiveSessionTypes = ['main', 'embedded', 'ag', 'quest']
      useRetentionMetricsMock.mockReturnValue({
        data: mockDataWithGrade10,
        isLoading: false,
        error: null,
      })
    })

    it('aged-out note mentions the by-grade chart, not just 10th graders', () => {
      render(<RetentionOverview />)

      // Must NOT say the old bare "10th grader.*aged out" copy
      expect(screen.queryByText(/10th grader.*aged out/i)).not.toBeInTheDocument()
    })

    it('does NOT render the reference footnote when by_grade has no grade-10 row', () => {
      // Non-teen-scope view: base is camp, no grade-10 bar.
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

  describe('when includeTeenPipeline is true (teen scope)', () => {
    beforeEach(() => {
      mockIncludeTeenPipeline = true
      mockActiveSessionTypes = ['main', 'embedded', 'ag', 'scit', 'tli']
      useRetentionMetricsMock.mockReturnValue({
        data: { ...mockDataWithGrade10, aged_out_count: 3 },
        isLoading: false,
        error: null,
      })
    })

    it('does NOT render the grade-10 reference footnote', () => {
      render(<RetentionOverview />)

      expect(screen.queryByText(/shown for reference/i)).not.toBeInTheDocument()
    })

    it('aged-out note uses the rising-12th-only copy (no by-grade chart mention)', () => {
      render(<RetentionOverview />)

      // Should see the flag-ON copy about rising 12th graders
      expect(screen.getByText(/rising 12th grader/i)).toBeInTheDocument()

      // Must NOT point to by-grade chart (that's flag-OFF copy)
      expect(screen.queryByText(/by-grade chart/i)).not.toBeInTheDocument()
    })
  })
})
