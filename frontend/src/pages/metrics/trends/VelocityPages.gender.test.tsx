/**
 * Velocity and Cancellation Velocity split by the Gender field or by gender identity (#2898 owner answer #78).
 * The Gender picker shows while Split by gender is on (default Gender field). On the Gender field the lines
 * are Boys and Girls with a visible line saying they are the Gender field; on gender identity there is one line
 * per group, a visible line saying how the lines are built, what Another identity holds, and ruling 58's
 * Gender field count (numbered, with its page-foot note; nothing at 0). By Session follows the same columns.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import VelocityPage from './VelocityPage'
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
}

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, availableYears: [2026] }),
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
    selectedPriorYears: [],
    priorYearOptions: [],
    togglePriorYear: vi.fn(),
    handleGenderToggle: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useVelocity', () => ({
  useVelocity: () => ({ data: state.data, isLoading: false, error: null }),
}))
// PR 5b: no sync known, so no live point
vi.mock('../../../hooks/useLiveSync', () => ({
  useLiveSync: () => ({ sync: { at: null, failed: false, nightly: false }, now: 0 }),
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

function lines(): string[] {
  return [...document.querySelectorAll('[data-line]')].map((el) => el.getAttribute('data-line')!)
}

function bySession(): HTMLElement {
  return screen.getByRole('heading', { name: /by session$/i }).closest('.card-lodge') as HTMLElement
}

describe.each([
  ['Velocity', () => <VelocityPage />, 'enrolled', 'rebuilt from registration records'],
  [
    'Cancellation Velocity',
    () => <CancellationVelocityPage />,
    'cancelled',
    'read each cancellation’s camper',
  ],
] as const)('%s › gender split (#78)', (_page, Page, prefix, howBuilt) => {
  beforeEach(() => {
    state.splitByGender = true
    state.genderBasis = 'field'
    state.data = response('field')
  })
  const show = () =>
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    )

  it('shows the Gender picker beside Split by gender, Gender field lit', () => {
    show()
    const picker = screen.getByRole('group', { name: 'Gender' })
    expect(within(picker).getByRole('button', { name: 'Gender field' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('draws Boys and Girls on the Gender field and says they are the Gender field', () => {
    show()
    expect(lines()).toContain(`${prefix}_boys`)
    expect(lines()).toContain(`${prefix}_girls`)
    expect(screen.getAllByText(/Boys and Girls here are the Gender field/).length).toBeGreaterThan(
      0
    )
    expect(within(bySession()).getByRole('columnheader', { name: 'Boys' })).toBeInTheDocument()
  })

  it('draws one line per identity group on gender identity, with the visible lines', () => {
    state.genderBasis = 'identity'
    state.data = response('identity')
    show()
    expect(lines()).toEqual(
      expect.arrayContaining([
        `${prefix}_girl_woman`,
        `${prefix}_boy_man`,
        `${prefix}_another_identity`,
      ])
    )
    expect(lines()).not.toContain(`${prefix}_boys`)
    expect(screen.getAllByText(new RegExp(howBuilt)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Another identity/, { selector: 'b' }).length).toBeGreaterThan(0)
    const fallback = screen.getAllByText(/: campers with no gender identity answer/)[0]!
    expect(fallback.textContent).toMatch(
      /^\d+ 3 in 2026: campers with no gender identity answer, counted by the Gender field\.$/
    )
    const n = fallback.textContent.split(' ')[0]
    const note = screen.getByText(/gender identity from CampMinder/).closest('li') as HTMLElement
    expect(note.textContent.startsWith(`${n}.`)).toBe(true)
    const table = bySession()
    expect(within(table).getByRole('columnheader', { name: 'Girl/woman' })).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Another identity' })
    ).toBeInTheDocument()
    const row = within(table).getByText('Session 2').closest('tr') as HTMLElement
    expect(within(row).getByText('48')).toBeInTheDocument()
  })

  it('has no Gender field count line or note at 0 (#73 a)', () => {
    state.genderBasis = 'identity'
    state.data = response('identity', 0)
    show()
    expect(screen.queryByText(/campers with no gender identity answer/)).toBeNull()
    expect(screen.queryByText(/gender identity from CampMinder/)).toBeNull()
  })

  it('shows no picker and no gender lines while the split is off', () => {
    state.splitByGender = false
    show()
    expect(screen.queryByRole('group', { name: 'Gender' })).toBeNull()
    expect(screen.queryByText(/Boys and Girls here are the Gender field/)).toBeNull()
  })
})
