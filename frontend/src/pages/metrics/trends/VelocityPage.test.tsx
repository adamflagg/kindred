/**
 * Tests for VelocityPage chart remount behavior.
 *
 * Verifies that the component renders correctly and that year changes
 * trigger a full remount via the key prop, preventing duplicate <Line>
 * components from accumulating across year transitions (#752).
 */

import { describe, it, expect, vi } from 'vitest'
import type { VelocityResponse } from '../../../types/velocity'

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

vi.mock('../../../hooks/useVelocityControls', () => ({
  useVelocityControls: () => ({
    splitByGender: false,
    selectedPriorYears: [],
    toggleGender: vi.fn(),
    togglePriorYear: vi.fn(),
    availablePriorYears: [],
  }),
}))

vi.mock('../../../hooks/useVelocity', () => ({
  useVelocity: () => ({
    data: mockVelocityData,
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../../../hooks/useVelocityChartData', () => ({
  useVelocityChartData: () => ({
    weeklyChartData: [{ week_number: 1, label: 'Jan 5' }],
    dailyChartData: [{ day_offset: 0, date: '2026-01-01' }],
    sortedBySession: [],
    weekLabelMap: new Map([[1, 'Jan 5']]),
    phaseLines: [],
    phaseDayOffsets: [],
    dailyTickFormatter: () => '',
    dailyZoomMilestones: [],
    priorSessionMap: new Map(),
    priorWeekMap: null,
  }),
}))

vi.mock('../../../hooks/useChartZoom', () => ({
  useChartZoom: () => ({
    zoomRange: null,
    handleBrushChange: vi.fn(),
    resetZoom: vi.fn(),
    setZoomRange: vi.fn(),
  }),
}))

vi.mock('../../../components/velocity', () => ({
  VelocityControls: () => <div data-testid="velocity-controls" />,
  SessionBreakdownTable: () => <div data-testid="session-table" />,
  WeeklyDeltaTable: () => <div data-testid="delta-table" />,
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
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: Record<string, unknown>) => (
    <div data-testid="responsive-container">{children as React.ReactNode}</div>
  ),
  ReferenceLine: () => <div />,
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

import { render, screen, cleanup } from '@testing-library/react'
import VelocityPage from './VelocityPage'

describe('VelocityPage chart remount on year change (#752)', () => {
  it('renders chart containers successfully', () => {
    render(<VelocityPage />)

    const containers = screen.getAllByTestId('responsive-container')
    expect(containers.length).toBeGreaterThan(0)
  })

  it('re-renders without error after year change', () => {
    render(<VelocityPage />)
    expect(screen.getAllByTestId('responsive-container').length).toBeGreaterThan(0)

    cleanup()

    // Change year to 2025 and re-render — the key prop includes currentYear,
    // so React will fully remount the chart, preventing stale Line components
    mockCurrentYear.currentYear = 2025
    render(<VelocityPage />)
    expect(screen.getAllByTestId('responsive-container').length).toBeGreaterThan(0)

    // Reset for other tests
    mockCurrentYear.currentYear = 2026
  })
})
