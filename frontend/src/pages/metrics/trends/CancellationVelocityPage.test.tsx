/**
 * Tests for CancellationVelocityPage prior-year labels.
 *
 * Verifies the card labels fall back to the requested prior year.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import type {
  PriorYearCancelledSummary,
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
  dailyChartData: [{ day_offset: 0, date: '2026-01-01' }] as Array<Record<string, unknown>>,
  sortedBySession: [] as VelocityCurve[],
  priorSessionMap: new Map<number | string, PriorYearSessionSummary>(),
}

vi.mock('../../../hooks/useVelocityChartData', () => ({
  useVelocityChartData: () => ({
    weeklyChartData: [{ week_number: 1, label: 'Jan 5' }],
    dailyChartData: mockChart.dailyChartData,
    sortedBySession: mockChart.sortedBySession,
    weekLabelMap: new Map([[1, 'Jan 5']]),
    phaseLines: [],
    phaseDayOffsets: [],
    dailyTickFormatter: () => '',
    dailyZoomMilestones: [],
    priorSessionMap: mockChart.priorSessionMap,
    priorWeekMap: null,
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
  VelocityControls: () => <div data-testid="velocity-controls" />,
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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CancellationVelocityPage from './CancellationVelocityPage'

describe('CancellationVelocityPage cards when the prior year has no matching session', () => {
  it('labels the cards with the ticked prior year and shows dashes, never "null"', () => {
    mockControls.selectedPriorYears = [2025]
    try {
      render(<CancellationVelocityPage />)
      expect(screen.getByText('2025 at Wk 1')).toBeInTheDocument()
      expect(screen.getByText('vs 2025')).toBeInTheDocument()
      expect(screen.getByText('2025 Final Cancelled')).toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(/null/)
    } finally {
      mockControls.selectedPriorYears = []
    }
  })
})

// ---------------------------------------------------------------------------
// #3209: one comparison year, no curve fallback, coverage pill, TODAY, legend
// ---------------------------------------------------------------------------

function wk(overrides: Partial<WeeklyDataPoint> = {}): WeeklyDataPoint {
  return { ...mockWeeklyPoint, ...overrides }
}

function cancelledSummary(
  overrides: Partial<PriorYearCancelledSummary>
): PriorYearCancelledSummary {
  return {
    year: 2025,
    cancelled_at_current_week: 60,
    cancelled_final: 140,
    has_cancellation_data: true,
    ...overrides,
  }
}

/** 2026 has 100 cancelled at Wk 1; the 2025 curve ends at 7 (a stand-in the cards must not use). */
const comparedData: VelocityResponse = {
  ...mockVelocityData,
  today_day_offset: 20,
  status_history_start: '2026-02-11',
  prior_years: [
    { year: 2025, daily: [], weekly: [wk({ enrolled: 3 }), wk({ week_number: 2, enrolled: 7 })] },
  ],
  prior_year_cancelled_to_date: [cancelledSummary({})],
}

function useComparison(data: VelocityResponse = comparedData) {
  mockControls.selectedPriorYears = [2025]
  mockChart.comparisonYear = data.prior_years.some((py) => py.year === 2025) ? 2025 : null
  mockState.data = data
}

function cardValue(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent
}

describe('CancellationVelocityPage compares with one year at the same point (#3209)', () => {
  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockChart.dailyChartData = [{ day_offset: 0, date: '2026-01-01' }]
    mockChart.sortedBySession = []
    mockChart.priorSessionMap = new Map()
    mockState.data = mockVelocityData
  })

  it('cards read the cancelled summary for the comparison year', () => {
    useComparison()
    render(<CancellationVelocityPage />)
    expect(cardValue('2025 at Wk 1')).toBe('60')
    expect(cardValue('vs 2025')).toBe('+40')
    expect(cardValue('2025 Final Cancelled')).toBe('140')
  })

  it('shows "—" rather than falling back to the curve when the summary has no value', () => {
    useComparison({
      ...comparedData,
      prior_year_cancelled_to_date: [
        cancelledSummary({ cancelled_at_current_week: null, cancelled_final: null }),
      ],
    })
    render(<CancellationVelocityPage />)
    expect(cardValue('2025 at Wk 1')).toBe('—')
    expect(cardValue('vs 2025')).toBe('—')
    expect(cardValue('2025 Final Cancelled')).toMatch(/^—/)
  })

  it('marks a year with no status history on the Final card', () => {
    // A year with no history has an empty curve, so the response may omit it from prior_years.
    useComparison({
      ...comparedData,
      prior_years: [],
      prior_year_cancelled_to_date: [
        cancelledSummary({
          cancelled_at_current_week: null,
          cancelled_final: null,
          has_cancellation_data: false,
        }),
      ],
    })
    render(<CancellationVelocityPage />)
    const card = screen.getByText('2025 Final Cancelled').parentElement!
    expect(within(card).getByText('—')).toBeInTheDocument()
    expect(within(card).getByText('no history before 11 Feb 2026')).toBeInTheDocument()
  })

  it('reads plain "no history" when the history start is unknown', () => {
    useComparison({
      ...comparedData,
      status_history_start: null,
      prior_year_cancelled_to_date: [
        cancelledSummary({ cancelled_final: null, has_cancellation_data: false }),
      ],
    })
    render(<CancellationVelocityPage />)
    expect(screen.getByText('no history')).toBeInTheDocument()
  })

  it('By Session names the year and compares with the prior same point', () => {
    useComparison()
    mockChart.sortedBySession = [
      {
        year: 2026,
        session_cm_id: 1,
        session_name: 'Session 1',
        gender: null,
        daily: [],
        weekly: [wk({ enrolled: 9 })],
      },
      {
        year: 2026,
        session_cm_id: 2,
        session_name: 'Session 2',
        gender: null,
        daily: [],
        weekly: [wk({ enrolled: 4 })],
      },
    ]
    mockChart.priorSessionMap = new Map([
      [
        1,
        {
          year: 2025,
          session_name: 'Session 1',
          session_cm_id: 500,
          current_session_cm_id: 1,
          enrolled_at_current_week: 6,
          final_enrolled: 15,
        },
      ],
    ])
    render(<CancellationVelocityPage />)

    expect(screen.getByRole('columnheader', { name: '2025 (Wk 1)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '2025 Final' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'vs 2025' })).toBeInTheDocument()

    const matched = screen.getByText('Session 1').closest('tr')!
    expect(within(matched).getByText('+3')).toBeInTheDocument()
    const unmatched = screen.getByText('Session 2').closest('tr')!
    expect(within(unmatched).getByText('new')).toBeInTheDocument()
  })

  it('draws a TODAY line at the day offset on the daily chart', () => {
    useComparison()
    render(<CancellationVelocityPage />)
    expect(screen.getByText('TODAY')).toHaveAttribute('data-x', '20')
  })

  it('draws the TODAY line at the week number on the weekly fallback chart', () => {
    useComparison()
    mockChart.dailyChartData = []
    render(<CancellationVelocityPage />)
    expect(screen.getByText('TODAY')).toHaveAttribute('data-x', '3')
  })

  it('legend totals show cumulative cancelled', () => {
    useComparison()
    render(<CancellationVelocityPage />)
    const legend = screen.getByTestId('legend')
    expect(legend).toHaveTextContent('2026 (100 at Wk 1)')
    expect(legend).toHaveTextContent('2025 (7 final)')
  })
})

describe('CancellationVelocityPage priority-day note (decision 45)', () => {
  const NOTE =
    'Counts the opening day and the next day: in 2023 and 2025 CampMinder dated most opening-day sign-ups the following day.'

  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockState.data = mockVelocityData
  })

  it('notes the two-day priority day when the same point is the priority date', () => {
    useComparison({
      ...comparedData,
      today_day_offset: 0,
      current_day_offset: 0,
      prior_day_offset: 1,
    })
    render(<CancellationVelocityPage />)
    expect(screen.getByText(NOTE)).toBeInTheDocument()
    const label = screen.getByText(
      (_, el) => el?.tagName === 'P' && el.textContent === '2025 at Wk 11'
    )
    expect(label.querySelector('sup')).toHaveTextContent('1')
  })

  it('notes it on an early or open date too, without the "updates tomorrow" wait', () => {
    useComparison({
      ...comparedData,
      today_day_offset: 7,
      current_day_offset: 7,
      prior_day_offset: 8,
    })
    render(<CancellationVelocityPage />)
    expect(screen.getByText(NOTE)).toBeInTheDocument()
    expect(cardValue('vs 2025')).not.toBe('updates tomorrow')
  })

  it('shows no note on any later day', () => {
    useComparison({ ...comparedData, current_day_offset: 20 })
    render(<CancellationVelocityPage />)
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })

  describe('on the priority date the delta reads "updates tomorrow" (ruling 9)', () => {
    afterEach(() => {
      mockChart.sortedBySession = []
      mockChart.priorSessionMap = new Map()
    })

    it('replaces the vs card value and keeps the numbered note', () => {
      useComparison({
        ...comparedData,
        today_day_offset: 0,
        current_day_offset: 0,
        prior_day_offset: 1,
      })
      render(<CancellationVelocityPage />)
      expect(cardValue('vs 2025')).toBe('updates tomorrow')
      expect(cardValue('2025 Final Cancelled')).toBe('140')
      expect(screen.getByText(NOTE)).toBeInTheDocument()
    })

    it('replaces the By Session delta', () => {
      useComparison({
        ...comparedData,
        today_day_offset: 0,
        current_day_offset: 0,
        prior_day_offset: 1,
      })
      mockChart.sortedBySession = [byCurve(1, 'Session 1', 9), byCurve(3, 'Session 3', 2)]
      mockChart.priorSessionMap = new Map([[1, priorSession({ enrolled_at_current_week: 6 })]])
      render(<CancellationVelocityPage />)
      const row = screen.getByText('Session 1').closest('tr')!
      expect(within(row).getByText('updates tomorrow')).toBeInTheDocument()
      expect(within(row).queryByText('+3')).not.toBeInTheDocument()
    })

    it('leaves the pending By Session delta empty in Copy and the CSV', async () => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
      useComparison({
        ...comparedData,
        today_day_offset: 0,
        current_day_offset: 0,
        prior_day_offset: 1,
      })
      mockChart.sortedBySession = [byCurve(1, 'Session 1', 9), byCurve(3, 'Session 3', 2)]
      mockChart.priorSessionMap = new Map([[1, priorSession({ enrolled_at_current_week: 6 })]])
      render(<CancellationVelocityPage />)
      const table = screen.getByText('Session 1').closest('table')!.parentElement!
      fireEvent.click(within(table).getByRole('button', { name: /^copy/i }))
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
      const [head, ...lines] = vi
        .mocked(navigator.clipboard.writeText)
        .mock.calls[0]![0].split('\n')
      const line = lines.find((l) => l.startsWith('Session 1'))
      const at = head!.split('\t').indexOf('vs 2025')
      expect(at).toBeGreaterThan(-1)
      expect(line!.split('\t')[at]).toBe('')
    })

    it('shows the delta on any later day', () => {
      useComparison({ ...comparedData, current_day_offset: 1 })
      render(<CancellationVelocityPage />)
      expect(cardValue('vs 2025')).toBe('+40')
    })
  })
})

function byCurve(cmId: number, name: string, cancelled: number): VelocityCurve {
  return {
    year: 2026,
    session_cm_id: cmId,
    session_name: name,
    gender: null,
    daily: [],
    weekly: [wk({ enrolled: cancelled })],
  }
}

function priorSession(overrides: Partial<PriorYearSessionSummary>): PriorYearSessionSummary {
  return {
    year: 2025,
    session_name: 'Session 1',
    session_cm_id: 500,
    current_session_cm_id: 1,
    enrolled_at_current_week: 6,
    final_enrolled: 15,
    ...overrides,
  }
}

describe('CancellationVelocityPage By Session with a comparison year that has no history', () => {
  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockChart.sortedBySession = []
    mockChart.priorSessionMap = new Map()
    mockState.data = mockVelocityData
  })

  it('reads "—" rather than "new" when the comparison year has no status history (ruling 6)', () => {
    useComparison({
      ...comparedData,
      prior_years: [{ year: 2025, daily: [], weekly: [] }],
      prior_year_cancelled_to_date: [
        cancelledSummary({
          cancelled_at_current_week: null,
          cancelled_final: null,
          has_cancellation_data: false,
        }),
      ],
    })
    mockChart.sortedBySession = [byCurve(2, 'Session 2', 4), byCurve(3, 'Session 3', 2)]
    render(<CancellationVelocityPage />)

    const row = screen.getByText('Session 2').closest('tr')!
    expect(within(row).queryByText('new')).not.toBeInTheDocument()
    expect(within(row).getAllByText('—')).toHaveLength(3)
  })

  it('reads "—" for a matched session before the comparison year\'s history starts (ruling 8)', () => {
    useComparison({
      ...comparedData,
      prior_year_cancelled_to_date: [cancelledSummary({ cancelled_at_current_week: null })],
    })
    mockChart.sortedBySession = [byCurve(1, 'Session 1', 9), byCurve(3, 'Session 3', 2)]
    mockChart.priorSessionMap = new Map([[1, priorSession({ enrolled_at_current_week: null })]])
    render(<CancellationVelocityPage />)

    expect(cardValue('2025 at Wk 1')).toBe('—')
    expect(screen.getByText('vs 2025', { selector: 'p' }).nextElementSibling).toHaveTextContent(
      /^—$/
    )
    const row = screen.getByText('Session 1').closest('tr')!
    expect(within(row).getAllByText('—')).toHaveLength(2)
    expect(within(row).getByText('15')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Decision 43 (#3207): one number format
// ---------------------------------------------------------------------------
describe('CancellationVelocityPage number format', () => {
  const bigData: VelocityResponse = {
    ...comparedData,
    cancelled_to_date: 2345,
    session_swap_count: 1234,
    combined: {
      ...comparedData.combined,
      weekly: [wk({ enrolled: 1293, delta: -1200 })],
    },
    prior_year_cancelled_to_date: [
      cancelledSummary({ cancelled_at_current_week: 1543, cancelled_final: 2600 }),
    ],
  }

  afterEach(() => {
    mockControls.selectedPriorYears = []
    mockChart.comparisonYear = null
    mockState.data = mockVelocityData
  })

  it('separates the card counts and writes the delta with a true minus', () => {
    useComparison(bigData)
    render(<CancellationVelocityPage />)
    expect(cardValue('2025 at Wk 1')).toBe('1,543')
    expect(cardValue('2025 Final Cancelled')).toBe('2,600')
    expect(cardValue('vs 2025')).toBe('−250')
  })

  it('writes the session-swap note with separated counts and a one-decimal share', () => {
    useComparison(bigData)
    render(<CancellationVelocityPage />)
    expect(
      screen.getByText(/1,234 of 2,345 cancellations \(52\.6%\) are session swaps/)
    ).toBeInTheDocument()
  })

  it('describes a swap with no time window (decision 46)', () => {
    useComparison(bigData)
    render(<CancellationVelocityPage />)
    expect(
      screen.getByText(/cancelled one session but are still enrolled in another this summer/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/within the same day/)).toBeNull()
  })

  it('writes the weekly change with separators and a true minus', () => {
    useComparison(bigData)
    render(<CancellationVelocityPage />)
    expect(screen.getByText('−1,200')).toBeInTheDocument()
    expect(screen.getAllByText('1,293').length).toBeGreaterThan(0)
  })
})
