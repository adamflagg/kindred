/**
 * Analytics › Today (#3207 PR 8): the page to the approved mock (round 4) and the owner's rulings.
 * Each card loads on its own and fails on its own, with "Try again" (D-UNCOVERED).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TodayPage from './TodayPage'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useRegistrationMetrics } from '../../../hooks/useMetrics'
import { useTodayRecent, useTodaySessions } from '../../../hooks/useToday'
import { useVelocity } from '../../../hooks/useVelocity'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { DELTA_INK } from '../../../utils/deltaTokens'
import type { RegistrationMetrics } from '../../../types/metrics'
import type { ApiRecentSignups, ApiTodaySessions } from '../../../types/api-types'

const setFilter = vi.fn()

vi.mock('../../../hooks/useComparisonRegistrationData', () => ({
  useComparisonRegistrationData: vi.fn(),
}))
vi.mock('../../../hooks/useMetrics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useMetrics')>()),
  useRegistrationMetrics: vi.fn(),
}))
vi.mock('../../../hooks/useToday', () => ({
  useTodaySessions: vi.fn(),
  useTodayRecent: vi.fn(),
}))
vi.mock('../../../hooks/useVelocity', () => ({ useVelocity: vi.fn() }))
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2027 })),
}))
vi.mock('../../../hooks/useRegistrationDates', () => ({
  usePriorityRegDate: vi.fn(() => '2026-11-11'),
}))
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: vi.fn(() => ({ setFilter, DrilldownModal: () => null })),
}))
vi.mock('../../../hooks/useMetricsSession', () => ({ useMetricsSession: vi.fn() }))

function session(over: Record<string, unknown> = {}) {
  return {
    selectedSessionCmId: null,
    selectedSession: undefined,
    sessions: [],
    activeSessionTypes: ['main', 'embedded', 'ag'],
    sessionTypesParam: 'main,embedded,ag',
    durationParam: undefined,
    filterOptions: { sessionTypes: 'main,embedded,ag' },
    ...over,
  } as unknown as ReturnType<typeof useMetricsSession>
}

function reg(year: number, over: Partial<RegistrationMetrics> = {}): RegistrationMetrics {
  return {
    year,
    total_enrolled: 880,
    total_waitlisted: 64,
    total_cancelled: 131,
    by_gender: [],
    by_grade: [],
    by_session: [],
    by_years_at_camp: [],
    new_vs_returning: {
      new_count: 188,
      returning_count: 692,
      new_percentage: 21,
      returning_percentage: 79,
    },
    ...over,
  }
}

const PRIOR_SAME_POINT = reg(2026, {
  total_enrolled: 902,
  total_waitlisted: null,
  total_cancelled: 122,
  prior_basis: 'same_point',
  day_offset: 90,
  prior_day_offset: 90,
  as_of_date: '2026-02-09',
})

function q<T>(data: T | undefined, over: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isPlaceholderData: false,
    ...over,
  }
}

function withHero({
  primary = reg(2027),
  prior = PRIOR_SAME_POINT,
  applied = 0,
  incomplete = 0,
  error = null as Error | null,
} = {}) {
  vi.mocked(useComparisonRegistrationData).mockReturnValue({
    primary: q(primary, { error }),
    comparison: q(prior),
    isComparing: true,
  } as unknown as ReturnType<typeof useComparisonRegistrationData>)
  vi.mocked(useRegistrationMetrics).mockImplementation(
    (_year, options) =>
      q(
        reg(2027, {
          total_enrolled: options?.statuses === 'applied' ? applied : incomplete,
        })
      ) as unknown as ReturnType<typeof useRegistrationMetrics>
  )
}

const SESSIONS: ApiTodaySessions = {
  year: 2027,
  prior_year: 2026,
  limited_threshold: 95,
  prior_basis: 'same_point',
  day_offset: 90,
  prior_day_offset: 90,
  as_of_date: '2026-02-09',
  rows: [
    {
      session_cm_id: 1000901,
      session_name: 'Taste of Camp',
      session_type: 'embedded',
      enrolled: 109,
      waitlisted: 6,
      beds: 120,
      goal: 115,
      prior: 104,
      parts: [
        { label: 'Girls', enrolled: 51, waitlisted: 2, beds: 54, prior: 50 },
        { label: 'Boys', enrolled: 47, waitlisted: 4, beds: 54, prior: 54 },
        { label: 'AG', enrolled: 11, waitlisted: 0, beds: 12, prior: 0 },
      ],
    },
    {
      session_cm_id: 1000200,
      session_name: 'Session 2',
      session_type: 'main',
      enrolled: 277,
      waitlisted: 28,
      beds: 288,
      goal: null,
      prior: 268,
      parts: [
        { label: 'Girls', enrolled: 134, waitlisted: 10, beds: 138, prior: 130 },
        { label: 'Boys', enrolled: 131, waitlisted: 16, beds: 138, prior: 126 },
        { label: 'AG', enrolled: 12, waitlisted: 2, beds: 12, prior: 12 },
      ],
    },
  ],
}

const RECENT: ApiRecentSignups = {
  year: 2027,
  since: '2027-02-03',
  today: '2027-02-09',
  enrollments: 9,
  lines: [
    {
      person_id: 1000002,
      first_name: 'Liam',
      last_name: 'Garcia',
      day: '2027-02-09',
      sessions: ['Taste of Camp', 'Session 4'],
      is_new: true,
      is_second: false,
    },
    {
      person_id: 1000003,
      first_name: 'Olivia',
      last_name: 'Chen',
      day: '2027-02-08',
      sessions: ['Session 2'],
      is_new: false,
      is_second: true,
    },
  ],
}

const VELOCITY = {
  year: 2027,
  season_start: '2026-11-11',
  combined: {
    year: 2027,
    weekly: [],
    daily: [
      { date: '2026-11-11', day_offset: 0, gross_enrolled: 500, enrolled: 500, cancelled: 0 },
      { date: '2027-02-09', day_offset: 90, gross_enrolled: 951, enrolled: 951, cancelled: 0 },
    ],
  },
  by_session: [],
  prior_years: [
    {
      year: 2026,
      daily: [
        { date: '2025-11-12', day_offset: 0, gross_enrolled: 480, enrolled: 480, cancelled: 0 },
        { date: '2026-02-09', day_offset: 90, gross_enrolled: 1109, enrolled: 1109, cancelled: 0 },
        { date: '2026-08-01', day_offset: 262, gross_enrolled: 1211, enrolled: 1211, cancelled: 0 },
      ],
      weekly: [],
    },
  ],
  phase_markers: [],
  current_day_offset: 90,
  prior_day_offset: 90,
  today_day_offset: 90,
}

function Where() {
  const loc = useLocation()
  return <span data-testid="where">{loc.search}</span>
}

function renderPage(path = '/analytics/today') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/analytics/today"
          element={
            <>
              <TodayPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  setFilter.mockReset()
  vi.mocked(useMetricsSession).mockReturnValue(session())
  withHero()
  vi.mocked(useTodaySessions).mockReturnValue(
    q(SESSIONS) as unknown as ReturnType<typeof useTodaySessions>
  )
  vi.mocked(useTodayRecent).mockReturnValue(
    q(RECENT) as unknown as ReturnType<typeof useTodayRecent>
  )
  vi.mocked(useVelocity).mockReturnValue(q(VELOCITY) as unknown as ReturnType<typeof useVelocity>)
})

const hero = () => screen.getByTestId('today-hero')
const fill = () => screen.getByTestId('today-fill')
const recent = () => screen.getByTestId('today-recent')

describe('Today › hero (enrolled campers)', () => {
  it('shows this summer, the registration day and the enrolled campers', () => {
    renderPage()
    expect(within(hero()).getByRole('heading', { name: 'Summer 2027' })).toBeInTheDocument()
    expect(hero()).toHaveTextContent('Registration day 91')
    expect(within(hero()).getByTestId('hero-figure')).toHaveTextContent('880')
  })

  it('compares with the same point last year, red when behind', () => {
    renderPage()
    const change = within(hero()).getByTestId('hero-change')
    expect(change).toHaveTextContent('▼ 22')
    expect(change.className).toContain(DELTA_INK.bad)
    expect(hero()).toHaveTextContent('vs same point 2026')
  })

  it('splits enrolled campers into Returning and New to camp, with last year marked', () => {
    renderPage()
    expect(hero()).toHaveTextContent('Returning 692')
    expect(hero()).toHaveTextContent('New to camp 188')
    expect(hero()).toHaveTextContent('same point 2026 902')
  })

  it('names one session in the title when the scope picks it', () => {
    vi.mocked(useMetricsSession).mockReturnValue(
      session({
        selectedSessionCmId: 1000200,
        selectedSession: { cm_id: 1000200, name: 'Session 2' },
      })
    )
    renderPage()
    expect(within(hero()).getByRole('heading', { name: 'Session 2, 2027' })).toBeInTheDocument()
  })

  it('never shows a "started" pill (owner, 2026-10-14)', () => {
    renderPage()
    expect(screen.queryByText(/started/i)).toBeNull()
  })
})

describe('Today › other statuses', () => {
  it('Cancelled turns red when it rises; Waitlisted has no comparison at the same point', () => {
    renderPage()
    const cancelled = within(hero()).getByTestId('status-Cancelled')
    expect(cancelled).toHaveTextContent('131')
    const change = within(cancelled).getByTestId('status-change')
    expect(change).toHaveTextContent('▲ 9')
    expect(change.className).toContain(DELTA_INK.bad)
    expect(within(hero()).getByTestId('status-Waitlisted')).toHaveTextContent('—')
  })

  it('shows Applied and Incomplete only when non-zero (decision 14)', () => {
    renderPage()
    expect(within(hero()).queryByTestId('status-Applied')).toBeNull()
    expect(within(hero()).queryByTestId('status-Incomplete')).toBeNull()
  })

  it('shows Applied as its own row, never added into Enrolled', () => {
    withHero({ applied: 3 })
    renderPage()
    expect(within(hero()).getByTestId('status-Applied')).toHaveTextContent('3')
    expect(within(hero()).getByTestId('hero-figure')).toHaveTextContent('880')
  })
})

describe('Today › Session fill', () => {
  it("lists this year's sessions in session order, each against its own match", () => {
    renderPage()
    const rows = within(fill()).getAllByRole('row')
    const names = rows.map((r) => within(r).queryAllByRole('cell')[0]?.textContent ?? '')
    expect(names).toEqual(['', 'Taste of Camp', 'Session 2', '2 sessions'])
    expect(within(rows[1]!).getAllByRole('cell').at(-1)).toHaveTextContent('▲ 5 · 104')
  })

  it('totals only matched sessions and compares the same way (ruling #15)', () => {
    renderPage()
    const total = within(fill()).getAllByRole('row').at(-1)!
    expect(total).toHaveTextContent('386') // 109 + 277
    expect(total).toHaveTextContent('▲ 14 · 372') // vs 104 + 268
  })

  it('a session new this year reads "new this year" and stays out of the total\'s comparison (ruling #15)', () => {
    vi.mocked(useTodaySessions).mockReturnValue(
      q({
        ...SESSIONS,
        rows: [
          ...SESSIONS.rows,
          {
            session_cm_id: 1000950,
            session_name: 'Session 5',
            session_type: 'main',
            enrolled: 20,
            waitlisted: 0,
            beds: 40,
            goal: null,
            prior: null,
            parts: [
              { label: 'Girls', enrolled: 10, waitlisted: 0, beds: 20, prior: null },
              { label: 'Boys', enrolled: 10, waitlisted: 0, beds: 20, prior: null },
            ],
          },
        ],
      }) as unknown as ReturnType<typeof useTodaySessions>
    )
    renderPage()
    const rows = within(fill()).getAllByRole('row')
    const s5 = rows.find((r) => within(r).queryAllByRole('cell')[0]?.textContent === 'Session 5')
    expect(within(s5!).getAllByRole('cell').at(-1)).toHaveTextContent('— new this year')
    const cells = within(rows.at(-1)!).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('3 sessions')
    expect(cells[1]).toHaveTextContent('406') // every session's enrolled: 109 + 277 + 20
    expect(cells.at(-1)).toHaveTextContent('▲ 14 · 372') // only the matched two: 386 vs 104 + 268
  })

  it('defaults to Fill: Bunk plan, with beds and open places', () => {
    renderPage()
    expect(within(fill()).getByRole('button', { name: 'Bunk plan' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(fill()).getByRole('columnheader', { name: /Beds/ })).toBeInTheDocument()
    expect(fill()).toHaveTextContent('AG full')
    expect(within(fill()).getByRole('link', { name: /Availability/ })).toHaveAttribute(
      'href',
      '/analytics/registration/availability'
    )
  })

  it('switches to Budget goal and keeps the switch in the URL', () => {
    renderPage()
    fireEvent.click(within(fill()).getByRole('button', { name: 'Budget goal' }))
    expect(screen.getByTestId('where')).toHaveTextContent('fill=goal')
    expect(within(fill()).getByRole('columnheader', { name: /Goal/ })).toBeInTheDocument()
    expect(within(fill()).getByRole('link', { name: /Forecast/ })).toBeInTheDocument()
  })

  it('a session with no goal reads "goal not set yet"', () => {
    renderPage('/analytics/today?fill=goal')
    const s2 = within(fill()).getAllByRole('row')[2]!
    expect(s2).toHaveTextContent('goal not set yet')
  })

  it('a failed load offers "Try again" in this card only (per-card isolation)', () => {
    const refetch = vi.fn()
    vi.mocked(useTodaySessions).mockReturnValue(
      q(undefined, { error: new Error('boom'), refetch }) as unknown as ReturnType<
        typeof useTodaySessions
      >
    )
    renderPage()
    fireEvent.click(within(fill()).getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    expect(within(hero()).getByTestId('hero-figure')).toHaveTextContent('880')
    expect(recent()).toHaveTextContent('Liam Garcia')
  })
})

describe('Today › Pace', () => {
  it('draws this year to today against last year at the same registration day', () => {
    renderPage()
    const pace = screen.getByTestId('today-pace')
    expect(pace).toHaveTextContent('951 today')
    expect(pace).toHaveTextContent('2026: 1,109')
    expect(pace).toHaveTextContent('2026 final 1,211')
    expect(within(pace).getByRole('link', { name: /Velocity/ })).toHaveAttribute(
      'href',
      '/analytics/trends/velocity'
    )
  })
})

describe('Today › Recent sign-ups', () => {
  it('lists one line per camper per day, newest first, with new and 2nd', () => {
    renderPage()
    const items = within(recent()).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Liam Garcia · Taste of Camp')
    expect(items[0]).toHaveTextContent('new')
    expect(items[0]).toHaveTextContent('today')
    expect(items[1]).toHaveTextContent('2nd')
    expect(items[1]).toHaveTextContent('Feb 8')
  })

  it('"+N more" opens the rest of the day on click', () => {
    renderPage()
    fireEvent.click(within(recent()).getByRole('button', { name: '+1 more' }))
    expect(within(recent()).getAllByRole('listitem')[0]).toHaveTextContent(
      'Taste of Camp, Session 4'
    )
  })

  it('"View all" opens the drill-down at Enrollments for the window', () => {
    renderPage()
    fireEvent.click(within(recent()).getByRole('button', { name: /View all 9 enrollments/ }))
    expect(setFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status',
        value: 'enrolled',
        initialRows: 'enrollments',
        enrolledSince: '2027-02-03',
      })
    )
  })

  it('folds away when nobody enrolled in the last 7 days', () => {
    vi.mocked(useTodayRecent).mockReturnValue(
      q({ ...RECENT, lines: [], enrollments: 0 }) as unknown as ReturnType<typeof useTodayRecent>
    )
    renderPage()
    expect(screen.queryByTestId('today-recent')).toBeNull()
  })
})

describe('Today › notes', () => {
  it('lists the numbered notes at the foot, never on hover', () => {
    const { container } = renderPage()
    expect(screen.getByText(/campers with a summer enrollment in this scope/)).toBeInTheDocument()
    expect(screen.getByText(/not offered this year is not counted/)).toBeInTheDocument()
    expect(container.querySelector('sup[title]')).toBeNull()
  })
})

describe('Today › a finished season', () => {
  it('every change reads "vs 2026 final", the hero and Session fill alike', () => {
    const final = {
      prior_basis: 'final',
      day_offset: null,
      prior_day_offset: null,
      as_of_date: null,
    }
    withHero({
      prior: reg(2026, { ...PRIOR_SAME_POINT, ...final } as Partial<RegistrationMetrics>),
    })
    vi.mocked(useTodaySessions).mockReturnValue(
      q({ ...SESSIONS, ...final }) as unknown as ReturnType<typeof useTodaySessions>
    )
    renderPage()
    expect(hero()).toHaveTextContent('vs 2026 final')
    expect(hero()).not.toHaveTextContent('same point')
    expect(within(fill()).getByRole('columnheader', { name: /vs 2026 final/ })).toBeInTheDocument()
  })
})

describe('Today › the priority date itself (ruling 9)', () => {
  it('the same-point change reads "updates tomorrow"', () => {
    withHero({
      prior: reg(2026, { ...PRIOR_SAME_POINT, day_offset: 0, prior_day_offset: 1 }),
    })
    renderPage()
    expect(within(hero()).getByTestId('hero-change')).toHaveTextContent('updates tomorrow')
  })
})
