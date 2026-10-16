/**
 * Cancellation Velocity, split by gender: campers already cancelled when the dashboard first saw them are in the
 * total but on no gender line. A numbered note under the chart says how many (never at 0), per season; a season
 * with no day-by-day history says so in place of the empty lines and keeps its total. Both picker modes.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import CancellationVelocityPage from './CancellationVelocityPage'
import type { VelocityCurve, VelocityResponse, WeeklyDataPoint } from '../../../types/velocity'

const point = (over: Partial<WeeklyDataPoint> = {}): WeeklyDataPoint => ({
  week_start: '2026-01-05',
  week_end: '2026-01-11',
  week_label: 'Jan 5',
  week_number: 1,
  enrolled: 100,
  delta: 10,
  data_source: 'snapshot',
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
  ...over,
})

const curve = (over: Partial<VelocityCurve>): VelocityCurve => ({
  year: 2026,
  session_cm_id: null,
  session_name: null,
  gender: null,
  daily: [],
  weekly: [point()],
  ...over,
})

function response(basis: 'field' | 'identity', fallback = 3): VelocityResponse {
  const groups = basis === 'field' ? ['M', 'F'] : ['Girl/woman', 'Boy/man', 'Another identity']
  return {
    year: 2026,
    season_start: '2026-01-01',
    combined: curve({}),
    by_session: [
      curve({ session_cm_id: 1001, session_name: 'Session 2' }),
      curve({ session_cm_id: 1002, session_name: 'Session 3' }),
    ],
    by_gender: groups.map((gender) => curve({ gender })),
    prior_years: [],
    prior_year_by_gender: [],
    phase_markers: [],
    session_gender_breakdown: [
      {
        session_cm_id: 1001,
        session_name: 'Session 2',
        boys_enrolled: 40,
        girls_enrolled: 50,
        ...(basis === 'identity'
          ? { by_identity: { 'Girl/woman': 48, 'Boy/man': 39, 'Another identity': 2 } }
          : {}),
      },
    ],
    cancelled_to_date: null,
    prior_year_cancelled_to_date: [],
    prior_year_session_summaries: [],
    prior_year_season_starts: {},
    daily: [],
    weekly: [point()],
    warnings: [],
    gender_basis: basis,
    gender_fallback_count: basis === 'identity' ? fallback : 0,
    prior_year_gender_fallback_counts: {},
  }
}

const state = {
  data: response('field'),
  splitByGender: true,
  genderBasis: 'field' as 'field' | 'identity',
  priorYears: [] as number[],
}

const GAP = (n: number) =>
  `The gender lines count each cancellation on the day the dashboard first saw it. ${n} this season were already cancelled when the dashboard first saw them, so they're in the total but not in these lines.`
const NO_HISTORY =
  'No day-by-day cancellation history for this season: the dashboard first saw every cancellation already made.'

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, availableYears: [2025, 2026] }),
}))
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => ({
    selectedSessionCmId: null,
    sessions: [],
    sessionTypesParam: 'main',
    durationParam: null,
  }),
}))
vi.mock('../../../hooks/useVelocityControls', () => ({
  useVelocityControls: () => ({
    splitByGender: state.splitByGender,
    genderBasis: state.genderBasis,
    setGenderBasis: vi.fn(),
    selectedPriorYears: state.priorYears,
    priorYearOptions: [],
    togglePriorYear: vi.fn(),
    handleGenderToggle: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useVelocity', () => ({
  useVelocity: () => ({ data: state.data, isLoading: false, error: null }),
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
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    LineChart: Pass,
    ResponsiveContainer: Pass,
    Line: ({ dataKey, name }: { dataKey: string; name: string }) => (
      <div data-line={dataKey}>{name}</div>
    ),
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ReferenceLine: () => null,
    ReferenceArea: () => null,
    Brush: () => null,
  }
})
vi.mock('./PartialWeekDot', () => ({ default: () => null }))

const show = () =>
  render(
    <MemoryRouter>
      <CancellationVelocityPage />
    </MemoryRouter>
  )

const withGaps = (
  basis: 'field' | 'identity',
  gaps: Array<{ year: number; unseen_count: number; no_history: boolean }>
): VelocityResponse => ({ ...response(basis, 0), gender_history_gaps: gaps })

describe.each(['field', 'identity'] as const)(
  'Cancellation Velocity › history gap (%s)',
  (basis) => {
    beforeEach(() => {
      state.splitByGender = true
      state.genderBasis = basis
      state.priorYears = []
    })

    it('shows the numbered note with N when cancellations are missing from the lines', () => {
      state.data = withGaps(basis, [{ year: 2026, unseen_count: 75, no_history: false }])
      show()
      const note = screen.getByText(GAP(75)).closest('li') as HTMLElement
      expect(note.textContent).toMatch(/^\d+\. /)
      expect(screen.queryByText(NO_HISTORY)).toBeNull()
    })

    it('shows no note at 0', () => {
      state.data = withGaps(basis, [{ year: 2026, unseen_count: 0, no_history: false }])
      show()
      expect(screen.queryByText(/already cancelled when the dashboard first saw them/)).toBeNull()
      expect(screen.queryByText(NO_HISTORY)).toBeNull()
    })

    it('says there is no history in place of empty lines, and keeps the total', () => {
      state.data = {
        ...withGaps(basis, [{ year: 2026, unseen_count: 233, no_history: true }]),
        by_gender: [],
      }
      show()
      expect(screen.getByText(NO_HISTORY)).toBeInTheDocument()
      expect(screen.queryByText(/already cancelled when the dashboard first saw them/)).toBeNull()
      // The total keeps its column in the weekly table; only the gender lines are replaced.
      expect(screen.getAllByRole('columnheader', { name: 'Total' }).length).toBeGreaterThan(0)
    })

    it('names the season when more than one season is drawn', () => {
      state.priorYears = [2025]
      state.data = withGaps(basis, [
        { year: 2026, unseen_count: 75, no_history: false },
        { year: 2025, unseen_count: 233, no_history: true },
      ])
      show()
      expect(screen.getByText(`2026: ${GAP(75)}`)).toBeInTheDocument()
      expect(screen.getByText(`2025: ${NO_HISTORY}`)).toBeInTheDocument()
    })

    it('leaves the season unnamed when only one drawn season has words', () => {
      state.priorYears = [2025]
      state.data = withGaps(basis, [
        { year: 2026, unseen_count: 75, no_history: false },
        { year: 2025, unseen_count: 0, no_history: false },
      ])
      show()
      expect(screen.getByText(GAP(75))).toBeInTheDocument()
    })

    it('shows nothing while the split is off', () => {
      state.splitByGender = false
      state.data = withGaps(basis, [{ year: 2026, unseen_count: 75, no_history: false }])
      show()
      expect(screen.queryByText(/already cancelled when the dashboard first saw them/)).toBeNull()
    })
  }
)
