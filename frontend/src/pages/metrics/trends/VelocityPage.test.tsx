/**
 * Tests for VelocityPage chart remount behavior.
 *
 * Verifies that the component renders correctly and that year changes
 * trigger a full remount via the key prop, preventing duplicate <Line>
 * components from accumulating across year transitions (#752).
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import type {
  PriorYearSessionSummary,
  VelocityCurve,
  VelocityResponse,
  WeeklyDataPoint,
} from '../../../types/velocity'

// Mock data that passes the component's loading/empty guards
const mockWeeklyPoint = {
  week_start: '2026-01-05',
  week_end: '2026-01-11',
  week_label: 'Jan 5',
  week_number: 1,
  enrolled: 100,
  delta: 10,
  data_source: 'snapshot' as const,
  gross_enrolled: 110,
  weekly_new: 15,
  weekly_cancelled: 5,
  is_partial: false,
  days_in_week: 7,
  enrolled_boys: null,
  enrolled_girls: null,
  gross_enrolled_boys: null,
  gross_enrolled_girls: null,
  weekly_new_boys: null,
  weekly_new_girls: null,
  weekly_cancelled_boys: null,
  weekly_cancelled_girls: null,
}

const mockVelocityData: VelocityResponse = {
  year: 2026,
  season_start: '2026-01-01',
  combined: {
    year: 2026,
    session_cm_id: null,
    session_name: null,
    gender: null,
    daily: [],
    weekly: [mockWeeklyPoint],
  },
  by_session: [],
  by_gender: [],
  prior_years: [],
  prior_year_by_gender: [],
  phase_markers: [],
  session_gender_breakdown: [],
  cancelled_to_date: null,
  prior_year_cancelled_to_date: [],
  prior_year_session_summaries: [],
  prior_year_season_starts: {},
  daily: [],
  weekly: [mockWeeklyPoint],
  warnings: [],
}

// Mutable state for controlling mocks between tests
const mockCurrentYear = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2025, 2026],
  isTransitioning: false,
  isYearReady: true,
}

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => mockCurrentYear,
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => ({
    selectedSessionCmId: null,
    selectedSession: undefined,
    sessions: [],
    isLoading: false,
    setSelectedSessionCmId: vi.fn(),
    clearSession: vi.fn(),
    viewMode: 'sessions' as const,
    setViewMode: vi.fn(),
    sessionTypesParam: 'camp',
    durationParam: null,
    selectedDuration: null,
    setSelectedDuration: vi.fn(),
    filterOptions: { sessionTypes: ['camp'], durations: [] },
  }),
}))

const mockControls = {
  splitByGender: false,
  selectedPriorYears: [] as number[],
}

vi.mock('../../../hooks/useVelocityControls', () => ({
  useVelocityControls: () => ({
    splitByGender: mockControls.splitByGender,
    selectedPriorYears: mockControls.selectedPriorYears,
    toggleGender: vi.fn(),
    togglePriorYear: vi.fn(),
    availablePriorYears: [],
  }),
}))

const mockState = { data: mockVelocityData }

vi.mock('../../../hooks/useVelocity', () => ({
  useVelocity: () => ({
    data: mockState.data,
    isLoading: false,
    error: null,
  }),
}))

const mockChart = {
  comparisonYear: null as number | null,
  sortedBySession: [] as VelocityCurve[],
  priorSessionMap: new Map<number | string, PriorYearSessionSummary>(),
  priorWeekMap: null as Map<number, WeeklyDataPoint> | null,
}

vi.mock('../../../hooks/useVelocityChartData', () => ({
  useVelocityChartData: () => ({
    weeklyChartData: [{ week_number: 1, label: 'Jan 5' }],
    dailyChartData: [{ day_offset: 0, date: '2026-01-01' }],
    sortedBySession: mockChart.sortedBySession,
    weekLabelMap: new Map([[1, 'Jan 5']]),
    phaseLines: [],
    phaseDayOffsets: [],
    dailyTickFormatter: () => '',
    dailyZoomMilestones: [],
    priorSessionMap: mockChart.priorSessionMap,
    priorWeekMap: mockChart.priorWeekMap,
    comparisonYear: mockChart.comparisonYear,
  }),
}))

vi.mock('../../../hooks/useChartZoom', () => ({
  useChartZoom: () => ({
    zoomRange: null,
    handleBrushChange: vi.fn(),
    resetZoom: vi.fn(),
    setZoomRange: vi.fn(),
    isZoomedIn: false,
  }),
}))

// The real tables render, so the column headers and cells the page builds are visible.
vi.mock('../../../components/velocity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/velocity')>()),
  VelocityControls: ({ extraControls }: { extraControls?: React.ReactNode }) => (
    <div data-testid="velocity-controls">{extraControls}</div>
  ),
}))

vi.mock('recharts', () => ({
  LineChart: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="line-chart" {...props}>
      {children as React.ReactNode}
    </div>
  ),
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  // Renders what the page's formatter makes of the combined series names.
  Legend: ({ formatter }: { formatter?: (name: string) => React.ReactNode }) => (
    <div data-testid="legend">
      {formatter && ['2026', '2025'].map((name) => <span key={name}>{formatter(name)}</span>)}
    </div>
  ),
  ResponsiveContainer: ({ children }: Record<string, unknown>) => (
    <div data-testid="responsive-container">{children as React.ReactNode}</div>
  ),
  ReferenceLine: ({ x, label }: { x?: number; label?: { value?: string } }) => (
    <div data-testid="reference-line" data-x={x}>
      {label?.value}
    </div>
  ),
  ReferenceArea: () => <div />,
  Brush: () => <div />,
}))

vi.mock('./PartialWeekDot', () => ({
  default: () => <div />,
}))

vi.mock('./phaseColors', () => ({
  PHASE_COLORS: {} as Record<string, string>,
}))

vi.mock('../../../utils/chartFormatters', () => ({
  PRIOR_YEAR_COLORS: ['#aaa'],
  GENDER_COLORS: { boys: '#00f', girls: '#f0f' },
  formatDateShort: (s: string) => s,
  priorYearDailyDateLabel: () => null,
}))

import { fireEvent, render, screen, within } from '@testing-library/react'
import VelocityPage from './VelocityPage'

describe('VelocityPage chart remount on year change (#752)', () => {
  it('renders chart containers successfully', () => {
    render(<VelocityPage />)

    const containers = screen.getAllByTestId('responsive-container')
    expect(containers.length).toBeGreaterThan(0)
  })

  it('remounts chart container when year changes (key-prop mechanism)', () => {
    // Render at year 2026 and capture the container DOM node
    const { rerender } = render(<VelocityPage />)
    const containerBefore = screen.getAllByTestId('responsive-container')[0]

    // Change year and rerender in-place — React reconciliation will see the
    // key change from "velocity-chart-2026" to "velocity-chart-2025" and
    // fully remount the ResponsiveContainer, preventing stale Line components
    mockCurrentYear.currentYear = 2025
    rerender(<VelocityPage />)
    const containerAfter = screen.getAllByTestId('responsive-container')[0]

    // A new DOM node confirms React remounted rather than reconciled in-place
    expect(containerAfter).not.toBe(containerBefore)

    // Reset for other tests
    mockCurrentYear.currentYear = 2026
  })
})

describe('VelocityPage cards when the prior year has no matching session', () => {
  it('labels the cards with the ticked prior year and shows dashes, never "null"', () => {
    mockControls.selectedPriorYears = [2025]
    try {
      render(<VelocityPage />)
      expect(screen.getByText('2025 at Wk 1')).toBeInTheDocument()
      expect(screen.getByText('vs 2025')).toBeInTheDocument()
      expect(screen.getByText('2025 Final')).toBeInTheDocument()
      expect(screen.getByText('2025 Cancelled at Wk 1')).toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(/null/)
    } finally {
      mockControls.selectedPriorYears = []
    }
  })
})

// ---------------------------------------------------------------------------
// #3209: one comparison year, same-point comparisons, TODAY line, legend totals
// ---------------------------------------------------------------------------

function wk(overrides: Partial<WeeklyDataPoint> = {}): WeeklyDataPoint {
  return { ...mockWeeklyPoint, ...overrides }
}

function sessionCurve(cmId: number, name: string, enrolled: number): VelocityCurve {
  return {
    year: 2026,
    session_cm_id: cmId,
    session_name: name,
    gender: null,
    daily: [],
    weekly: [wk({ enrolled })],
  }
}

function priorSummary(overrides: Partial<PriorYearSessionSummary>): PriorYearSessionSummary {
  return {
    year: 2025,
    session_name: 'Session 1',
    session_cm_id: 500,
    current_session_cm_id: 1,
    enrolled_at_current_week: 25,
    final_enrolled: 40,
    ...overrides,
  }
}

/** Current 2026 at Wk 1: net 100, gross 110. 2025 ends at net 130 / gross 150. */
const comparedData: VelocityResponse = {
  ...mockVelocityData,
  today_day_offset: 80,
  current_day_offset: 6,
  prior_years: [
    {
      year: 2024,
      daily: [],
      weekly: [wk({ enrolled: 60 }), wk({ week_number: 2, enrolled: 70 })],
      at_current_point: 55,
    },
    {
      year: 2025,
      daily: [],
      weekly: [
        wk({ enrolled: 90, gross_enrolled: 95 }),
        wk({ week_number: 2, enrolled: 130, gross_enrolled: 150 }),
      ],
      at_current_point: 95,
    },
  ],
}

function useComparison(selected: number[], comparisonYear: number | null) {
  mockControls.selectedPriorYears = selected
  mockChart.comparisonYear = comparisonYear
  mockState.data = comparedData
}

function cardValue(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent
}

describe('VelocityPage compares with one year at the same point (#3209)', () => {
  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockChart.sortedBySession = []
    mockChart.priorSessionMap = new Map()
    mockState.data = mockVelocityData
  })

  it('cards read the comparison year, at the same registration day', () => {
    // Ticked 2024 and 2025; the response lists 2024 first. Cards must follow 2025.
    useComparison([2024, 2025], 2025)
    render(<VelocityPage />)
    expect(cardValue('2025 at Wk 1')).toBe('95')
    expect(cardValue('vs 2025')).toBe('+5')
    expect(cardValue('2025 Final')).toBe('130')
  })

  it('captions the Enrolled card "camper-sessions"', () => {
    useComparison([2025], 2025)
    render(<VelocityPage />)
    const card = screen.getByText('Enrolled (2026, Wk 1)').parentElement
    expect(card).toHaveTextContent('camper-sessions')
  })

  it('By Session names the year and compares with the prior same point', () => {
    useComparison([2025], 2025)
    mockChart.sortedBySession = [sessionCurve(1, 'Session 1', 30), sessionCurve(2, 'Session 2', 12)]
    mockChart.priorSessionMap = new Map([[1, priorSummary({})]])
    render(<VelocityPage />)

    expect(screen.getByRole('columnheader', { name: '2025 (Wk 1)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '2025 Final' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'vs 2025' })).toBeInTheDocument()

    const matched = screen.getByText('Session 1').closest('tr')!
    // 30 now vs 25 at the same point last year — not 30 vs the 40 final.
    expect(within(matched).getByText('+5')).toBeInTheDocument()
    expect(within(matched).getByText('40')).toBeInTheDocument()
  })

  it('marks a session with no prior match "new"', () => {
    useComparison([2025], 2025)
    mockChart.sortedBySession = [sessionCurve(1, 'Session 1', 30), sessionCurve(2, 'Session 2', 12)]
    mockChart.priorSessionMap = new Map([[1, priorSummary({})]])
    render(<VelocityPage />)

    const unmatched = screen.getByText('Session 2').closest('tr')!
    expect(within(unmatched).getByText('new')).toBeInTheDocument()
    expect(within(unmatched).getAllByText('—')).toHaveLength(2)
  })

  it('draws a TODAY line at the day offset on the daily chart while live', () => {
    useComparison([2025], 2025)
    render(<VelocityPage />)
    expect(screen.getByText('TODAY')).toHaveAttribute('data-x', '80')
  })

  it('draws the TODAY line at the week number on the Weekly Delta chart', () => {
    useComparison([2025], 2025)
    render(<VelocityPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Weekly Delta' }))
    expect(screen.getByText('TODAY')).toHaveAttribute('data-x', '12')
  })

  it('draws no TODAY line once the season is over', () => {
    useComparison([2025], 2025)
    mockState.data = { ...comparedData, today_day_offset: null }
    render(<VelocityPage />)
    expect(screen.queryByText('TODAY')).not.toBeInTheDocument()
  })

  it('legend totals follow the line mode, "at Wk N" while live', () => {
    useComparison([2025], 2025)
    render(<VelocityPage />)
    const legend = screen.getByTestId('legend')
    expect(legend).toHaveTextContent('2026 (100 at Wk 1)')
    expect(legend).toHaveTextContent('2025 (130 final)')

    fireEvent.click(screen.getByRole('button', { name: 'Gross Cumulative' }))
    expect(screen.getByTestId('legend')).toHaveTextContent('2026 (110 at Wk 1)')
    expect(screen.getByTestId('legend')).toHaveTextContent('2025 (150 final)')
  })

  it('legend reads "final" for the current year once the season is over', () => {
    useComparison([2025], 2025)
    mockState.data = { ...comparedData, today_day_offset: null }
    render(<VelocityPage />)
    expect(screen.getByTestId('legend')).toHaveTextContent('2026 (100 final)')
  })
})

describe('VelocityPage priority-day note (decision 45)', () => {
  const NOTE =
    'Counts the opening day and the next day: in 2023 and 2025 CampMinder dated most opening-day sign-ups the following day.'

  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockState.data = mockVelocityData
  })

  it('notes the two-day priority day when the same point is the priority date', () => {
    useComparison([2025], 2025)
    mockState.data = {
      ...comparedData,
      today_day_offset: 0,
      current_day_offset: 0,
      prior_day_offset: 1,
    }
    render(<VelocityPage />)
    expect(screen.getByText(NOTE)).toBeInTheDocument()
    const label = screen.getByText(
      (_, el) => el?.tagName === 'P' && el.textContent === '2025 at Wk 11'
    )
    expect(label.querySelector('sup')).toHaveTextContent('1')
  })

  it('notes it on an early or open date too, without the "updates tomorrow" wait', () => {
    useComparison([2025], 2025)
    mockState.data = {
      ...comparedData,
      today_day_offset: 7,
      current_day_offset: 7,
      prior_day_offset: 8,
    }
    render(<VelocityPage />)
    expect(screen.getByText(NOTE)).toBeInTheDocument()
    expect(cardValue('vs 2025')).not.toBe('updates tomorrow')
  })

  it('shows no note on any later day', () => {
    useComparison([2025], 2025)
    render(<VelocityPage />)
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })

  describe('on the priority date the delta reads "updates tomorrow" (ruling 9)', () => {
    afterEach(() => {
      mockChart.sortedBySession = []
      mockChart.priorSessionMap = new Map()
    })

    it('replaces the vs card value and keeps the numbered note', () => {
      useComparison([2025], 2025)
      mockState.data = {
        ...comparedData,
        today_day_offset: 0,
        current_day_offset: 0,
        prior_day_offset: 1,
      }
      render(<VelocityPage />)
      expect(cardValue('vs 2025')).toBe('updates tomorrow')
      expect(cardValue('2025 Final')).toBe('130')
      expect(screen.getByText(NOTE)).toBeInTheDocument()
    })

    it('replaces the By Session delta, and an unmatched session still reads "new"', () => {
      useComparison([2025], 2025)
      mockState.data = {
        ...comparedData,
        today_day_offset: 0,
        current_day_offset: 0,
        prior_day_offset: 1,
      }
      mockChart.sortedBySession = [
        sessionCurve(1, 'Session 1', 30),
        sessionCurve(2, 'Session 2', 12),
      ]
      mockChart.priorSessionMap = new Map([[1, priorSummary({})]])
      render(<VelocityPage />)

      const matched = screen.getByText('Session 1').closest('tr')!
      expect(within(matched).getByText('updates tomorrow')).toBeInTheDocument()
      expect(within(matched).queryByText('+5')).not.toBeInTheDocument()
      const unmatched = screen.getByText('Session 2').closest('tr')!
      expect(within(unmatched).getByText('new')).toBeInTheDocument()
    })

    it('shows the delta on any later day', () => {
      useComparison([2025], 2025)
      mockState.data = { ...comparedData, current_day_offset: 1 }
      render(<VelocityPage />)
      expect(cardValue('vs 2025')).toBe('+5')
      expect(screen.queryByText('updates tomorrow')).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Decision 43 (#3207): one number format
// ---------------------------------------------------------------------------
describe('VelocityPage number format', () => {
  const bigData: VelocityResponse = {
    ...comparedData,
    combined: {
      ...comparedData.combined,
      weekly: [
        wk({
          enrolled: 1293,
          gross_enrolled: 1300,
          delta: -1200,
          weekly_new: 1234,
          weekly_cancelled: 2345,
        }),
      ],
    },
    prior_years: [
      {
        year: 2025,
        daily: [],
        weekly: [wk({ enrolled: 1543, gross_enrolled: 1600, delta: -56 })],
        at_current_point: 1543,
      },
    ],
  }

  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockChart.priorWeekMap = null
    mockState.data = mockVelocityData
  })

  it('separates the card counts and writes the delta with a true minus', () => {
    mockControls.selectedPriorYears = [2025]
    mockChart.comparisonYear = 2025
    mockState.data = bigData
    render(<VelocityPage />)
    expect(cardValue('Enrolled (2026, Wk 1)')).toBe('1,293')
    expect(cardValue('2025 at Wk 1')).toBe('1,543')
    expect(cardValue('vs 2025')).toBe('−250')
  })

  it('separates the legend totals', () => {
    mockControls.selectedPriorYears = [2025]
    mockChart.comparisonYear = 2025
    mockState.data = bigData
    render(<VelocityPage />)
    expect(screen.getByTestId('legend')).toHaveTextContent('2026 (1,293 at Wk 1)')
    expect(screen.getByTestId('legend')).toHaveTextContent('2025 (1,543 final)')
  })

  it('writes the weekly delta table counts with separators and true minus signs', () => {
    mockControls.selectedPriorYears = [2025]
    mockChart.comparisonYear = 2025
    mockChart.priorWeekMap = new Map([
      [1, wk({ enrolled: 1543, gross_enrolled: 1600, delta: -56 })],
    ])
    mockState.data = bigData
    render(<VelocityPage />)
    const row = screen.getByText('+1,234').closest('tr')!
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(
      expect.arrayContaining(['+1,234', '2,345', '−1,200', '1,293', '1,300', '1,543', '−56'])
    )
  })
})

// ---------------------------------------------------------------------------
// K13 (#3207): label the two bases, driven per point from data_source
// ---------------------------------------------------------------------------

describe('VelocityPage labels stored and rebuilt lines (K13)', () => {
  function day(date: string, data_source: 'snapshot' | 'reconstructed' | 'mixed') {
    return {
      date,
      day_offset: 0,
      gross_enrolled: 0,
      enrolled: 0,
      cancelled: 0,
      daily_new: 0,
      daily_cancelled: 0,
      daily_new_boys: null,
      daily_new_girls: null,
      daily_cancelled_boys: null,
      daily_cancelled_girls: null,
      gross_enrolled_boys: null,
      gross_enrolled_girls: null,
      enrolled_boys: null,
      enrolled_girls: null,
      data_source,
    }
  }

  const twoBases: VelocityResponse = {
    ...comparedData,
    snapshots_start: '2026-03-02',
    combined: {
      ...comparedData.combined,
      daily: [day('2026-03-01', 'reconstructed'), day('2026-03-02', 'snapshot')],
    },
    prior_years: comparedData.prior_years.map((py) => ({
      ...py,
      daily: [
        day(`${py.year - 1}-11-12`, 'reconstructed'),
        day(`${py.year}-08-20`, 'reconstructed'),
      ],
    })),
  }

  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockState.data = mockVelocityData
  })

  it('notes which line is stored and that 2025 and earlier are rebuilt', () => {
    useComparison([2024, 2025], 2025)
    mockState.data = twoBases
    render(<VelocityPage />)
    expect(
      screen.getByText(/2026 is the count Kindred stored each night from Mar 2, 2026/)
    ).toBeInTheDocument()
    expect(screen.getByText(/2025 and earlier seasons are rebuilt/)).toBeInTheDocument()
  })

  it('marks the legend lines and the same-point cards with the note number, never hover text', () => {
    useComparison([2025], 2025)
    mockState.data = twoBases
    const { container } = render(<VelocityPage />)
    expect(screen.getByTestId('legend')).toHaveTextContent('2026 (100 at Wk 1)¹')
    expect(screen.getByTestId('legend')).toHaveTextContent('2025 (130 final)¹')
    const label = screen.getByText(
      (_, el) => el?.tagName === 'P' && el.textContent === '2025 at Wk 11'
    )
    expect(label.querySelector('sup')).toHaveTextContent('1')
    expect(container.querySelectorAll('sup[title]')).toHaveLength(0)
  })

  it('shows no note when every line is rebuilt', () => {
    useComparison([2025], 2025)
    mockState.data = {
      ...twoBases,
      combined: { ...twoBases.combined, daily: [day('2026-03-01', 'reconstructed')] },
    }
    render(<VelocityPage />)
    expect(screen.queryByText(/stored each night/)).not.toBeInTheDocument()
  })
})
