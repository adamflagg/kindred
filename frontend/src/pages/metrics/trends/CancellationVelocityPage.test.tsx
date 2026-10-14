/**
 * Tests for CancellationVelocityPage prior-year labels.
 *
 * Verifies the card labels fall back to the requested prior year.
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
    isZoomedIn: false,
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

import { render, screen } from '@testing-library/react'
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
