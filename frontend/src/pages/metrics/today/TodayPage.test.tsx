/**
 * Analytics › Today (#3207 PR 8): the page to the approved mock (round 4) and the owner's rulings.
 * Each card loads on its own and fails on its own, with "Try again" (D-UNCOVERED).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
// PR 5b: the sync Pace's live point is dated by. None known by default: no live point.
const liveSync = {
  sync: { at: null as string | null, failed: false, nightly: false },
  now: new Date(2027, 1, 9, 14, 40).getTime(),
}
vi.mock('../../../hooks/useLiveSync', () => ({ useLiveSync: () => liveSync }))

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

describe('Today › Pace live point (PR 5b)', () => {
  // Stored 951 at 3:40 am; the 2:05 pm hourly sync counts 1,577.
  const LIVE = {
    ...VELOCITY,
    live: { enrolled: 1577, stored_at: new Date(2027, 1, 9, 3, 40).toISOString() },
  }
  function withLive(at: string | null) {
    vi.mocked(useVelocity).mockReturnValue(q(LIVE) as unknown as ReturnType<typeof useVelocity>)
    liveSync.sync = { at, failed: false, nightly: false }
  }
  afterEach(() => {
    liveSync.sync = { at: null, failed: false, nightly: false }
  })

  it('"N today" reads the live count, labelled by the sync, with what moved since 3 a.m.', () => {
    withLive(new Date(2027, 1, 9, 14, 5).toISOString())
    renderPage()
    const pace = screen.getByTestId('today-pace')
    expect(pace).toHaveTextContent('1,577 today')
    expect(pace).toHaveTextContent('as of 2:05 pm sync · 1,577')
    expect(pace).toHaveTextContent('+626 since 3 a.m.')
    // Last year's stored point on the same registration day, never a same-hour figure (#109)
    expect(pace).toHaveTextContent('2026: 1,109')
    expect(pace.querySelector('[data-live-dot="stored"]')).not.toBeNull()
    expect(pace.querySelector('[data-live-dot="live"]')).not.toBeNull()
  })

  // ub:PR#3283:5 / OD-48: a missed nightly leaves a days-old stored count; hidden point, so name its date.
  it('after a missed nightly, a hidden live point leaves the stored count named by its date', () => {
    vi.mocked(useVelocity).mockReturnValue(
      q({
        ...VELOCITY,
        // The stored point is the Feb 7 nightly's: the Feb 8 and Feb 9 runs never landed
        combined: {
          ...VELOCITY.combined,
          daily: [
            ...VELOCITY.combined.daily.slice(0, -1),
            { ...VELOCITY.combined.daily.at(-1)!, date: '2027-02-07', day_offset: 88 },
          ],
        },
        live: { enrolled: 1577, stored_at: new Date(2027, 1, 7, 3, 40).toISOString() },
      }) as unknown as ReturnType<typeof useVelocity>
    )
    liveSync.sync = {
      at: new Date(2027, 1, 9, 12, 30).toISOString(),
      failed: false,
      nightly: false,
    }
    renderPage()
    expect(screen.getByTestId('today-pace')).toHaveTextContent("951 · as of Feb 7's 3 a.m. count")
  })

  it('a sync more than 2 hours old leaves the 3 a.m. count (#111)', () => {
    withLive(new Date(2027, 1, 9, 12, 30).toISOString())
    renderPage()
    const pace = screen.getByTestId('today-pace')
    expect(pace).toHaveTextContent('951 today')
    expect(pace).not.toHaveTextContent('since 3 a.m.')
    expect(pace.querySelector('[data-live-dot="live"]')).toBeNull()
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

describe('Today › never "vs final" (PM-8 A)', () => {
  it('asks for last year at the same registration day all year, never its final', () => {
    withHero()
    renderPage()
    const calls = vi.mocked(useComparisonRegistrationData).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call[3]?.samePoint).toBe('allYear')
  })

  it('after the last session started, every change still reads "vs same point 2026"', () => {
    // Late October: the season is over, and last year is still read at the same day
    const late = { day_offset: 347, prior_day_offset: 347, as_of_date: '2026-10-24' }
    withHero({ prior: reg(2026, { ...PRIOR_SAME_POINT, ...late }) })
    vi.mocked(useTodaySessions).mockReturnValue(
      q({ ...SESSIONS, ...late }) as unknown as ReturnType<typeof useTodaySessions>
    )
    renderPage()
    expect(hero()).toHaveTextContent('vs same point 2026')
    expect(hero()).not.toHaveTextContent('final')
    expect(
      within(fill()).getByRole('columnheader', { name: /vs same point 2026/ })
    ).toBeInTheDocument()
  })

  it('with no anchor shows no comparison and says why, never a final in its place', () => {
    const none = {
      prior_basis: 'unavailable',
      prior_unavailable_reason: 'no_registration_anchor',
      day_offset: null,
      prior_day_offset: null,
      as_of_date: null,
      total_enrolled: 1211,
    }
    withHero({ prior: reg(2026, none as Partial<RegistrationMetrics>) })
    vi.mocked(useTodaySessions).mockReturnValue(
      q({
        ...SESSIONS,
        prior_basis: null,
        prior_unavailable_reason: 'no_registration_anchor',
        day_offset: null,
        prior_day_offset: null,
        as_of_date: null,
        rows: SESSIONS.rows.map((r) => ({ ...r, prior: null, prior_parts: null })),
        pace_prior: null,
      }) as unknown as ReturnType<typeof useTodaySessions>
    )
    renderPage()
    expect(screen.getByTestId('hero-change')).toHaveTextContent('—')
    expect(hero()).not.toHaveTextContent('1,211')
    expect(hero()).not.toHaveTextContent('same point')
    // Pace's curve keeps its end label ("2026 final N"): a line's end, not a comparison
    expect(screen.queryByText(/vs 2026 final/)).toBeNull()
    expect(screen.queryByText(/new this year/)).toBeNull()
    expect(
      screen.getByText(/there is no same registration day to read 2026 at/)
    ).toBeInTheDocument()
    // Owner call 2026-10-26 (item 6): no "vs" header over columns that compare with nothing
    expect(screen.queryByText(/^vs /)).toBeNull()
    expect(within(fill()).queryByRole('columnheader', { name: /^vs / })).toBeNull()
    expect(hero()).not.toHaveTextContent('vs 2026')
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

// PR 8b (#15, #50, #51): 2026's Taste of Camp 2 (58) and Session 2b (66) fold into 2026 Session 2 (268)
const S2_FOLDED = {
  ...SESSIONS.rows[1]!,
  prior: 392,
  prior_parts: [
    { name: 'Session 2', prior: 268 },
    { name: 'Taste of Camp 2', prior: 58 },
    { name: 'Session 2b', prior: 66 },
  ],
  parts: [
    {
      label: 'Girls' as const,
      enrolled: 134,
      waitlisted: 10,
      beds: 138,
      prior: 193,
      prior_parts: [
        { name: 'Session 2', prior: 130 },
        { name: 'Taste of Camp 2', prior: 30 },
        { name: 'Session 2b', prior: 33 },
      ],
    },
    {
      label: 'Boys' as const,
      enrolled: 131,
      waitlisted: 16,
      beds: 138,
      prior: 187,
      prior_parts: [
        { name: 'Session 2', prior: 126 },
        { name: 'Taste of Camp 2', prior: 28 },
        { name: 'Session 2b', prior: 33 },
      ],
    },
    { label: 'AG' as const, enrolled: 12, waitlisted: 2, beds: 12, prior: 12 },
  ],
}
const FOLDED: ApiTodaySessions = {
  ...SESSIONS,
  rows: [SESSIONS.rows[0]!, S2_FOLDED],
  pace_prior: [
    { day_offset: 0, enrolled: 300 },
    { day_offset: 90, enrolled: 496 },
    { day_offset: 262, enrolled: 540 },
  ],
}
const FOOT = 'Sessions with no 2027 match are added to the session that contains them. Today only.'

function withSessions(data: ApiTodaySessions | undefined, over: Record<string, unknown> = {}) {
  vi.mocked(useTodaySessions).mockReturnValue(
    q(data, over) as unknown as ReturnType<typeof useTodaySessions>
  )
}

describe('Today › the embedded add (PR 8b)', () => {
  it('a folded figure is dotted and opens its breakdown, the main session first (#50, wording A)', () => {
    withSessions(FOLDED)
    renderPage()
    const s2 = within(fill()).getAllByRole('row')[2]!
    expect(within(s2).getAllByRole('cell').at(-1)).toHaveTextContent('▼ 115 · 392')
    const trigger = within(s2).getByRole('button', { name: '392' })
    expect(trigger.className).toContain('decoration-dotted')
    fireEvent.focus(trigger)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('2026: Session 2 268 · Taste of Camp 2 58 · 2b 66')
    expect(tip).toHaveTextContent(FOOT)
  })

  it('a row with nothing folded in shows a plain figure', () => {
    withSessions(FOLDED)
    renderPage()
    const toc = within(fill()).getAllByRole('row')[1]!
    expect(within(toc).queryByRole('button')).toBeNull()
  })

  it('the total row breaks down into the matched sessions, then each folded one', () => {
    withSessions(FOLDED)
    renderPage()
    const total = within(fill()).getAllByRole('row').at(-1)!
    expect(total).toHaveTextContent('▼ 110 · 496') // 386 vs 104 + 392
    fireEvent.focus(within(total).getByRole('button', { name: '496' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      '2026: 2 matched sessions 372 · Taste of Camp 2 58 · 2b 66'
    )
  })

  it("one session's cabin groups and total carry their own breakdowns", () => {
    vi.mocked(useMetricsSession).mockReturnValue(
      session({
        selectedSessionCmId: 1000200,
        selectedSession: { cm_id: 1000200, name: 'Session 2' },
      })
    )
    withSessions({ ...FOLDED, rows: [S2_FOLDED], headline_prior: 380 })
    renderPage()
    const rows = within(fill()).getAllByRole('row')
    fireEvent.focus(within(rows[1]!).getByRole('button', { name: '193' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      '2026: Session 2 130 · Taste of Camp 2 30 · 2b 33'
    )
    expect(within(rows[3]!).queryByRole('button')).toBeNull() // AG: nothing folded in
    fireEvent.focus(within(rows.at(-1)!).getByRole('button', { name: '392' }))
    expect(screen.getAllByRole('tooltip').at(-1)).toHaveTextContent(
      '2026: Session 2 268 · Taste of Camp 2 58 · 2b 66'
    )
  })

  it('Pace compares what the fill total compares, with the same breakdown', () => {
    withSessions(FOLDED)
    renderPage()
    const pace = screen.getByTestId('today-pace')
    expect(pace).toHaveTextContent('2026: 496')
    expect(pace).toHaveTextContent('2026 final 540')
    fireEvent.focus(within(pace).getByRole('button', { name: '2026: 496' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      '2026: 2 matched sessions 372 · Taste of Camp 2 58 · 2b 66'
    )
  })

  it("Pace waits for Session fill's comparison while it loads", () => {
    withSessions(undefined, { isLoading: true })
    renderPage()
    expect(screen.getByTestId('today-pace')).toHaveTextContent('Loading pace')
  })

  // ti:P-36 / MR-PAR-23 (owner, 2026-10-25, option A) reverses the old fallback to Velocity's own prior:
  // "Pace shows an error if Session fill fails", rather than a comparison Session fill does not make.
  it('Pace shows an error when Session fill failed to load, and "Try again" re-asks it', () => {
    const refetch = vi.fn()
    withSessions(undefined, { error: new Error('boom'), refetch })
    renderPage()
    const pace = screen.getByTestId('today-pace')
    expect(pace).toHaveTextContent(/Failed to load pace data: boom/)
    expect(pace).not.toHaveTextContent('2026: 1,109')
    expect(pace).not.toHaveTextContent('today')
    fireEvent.click(within(pace).getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  // "Today's one-session hero shows an error when Session fill fails": never last year's unfolded count.
  it('one session picked: the hero shows an error when Session fill failed to load', () => {
    vi.mocked(useMetricsSession).mockReturnValue(
      session({
        selectedSessionCmId: 1000200,
        selectedSession: { cm_id: 1000200, name: 'Session 2' },
      })
    )
    const refetch = vi.fn()
    withSessions(undefined, { error: new Error('boom'), refetch })
    renderPage()
    expect(hero()).toHaveTextContent(/Failed to load enrollment data: boom/)
    expect(hero()).not.toHaveTextContent('902')
    expect(within(hero()).queryByTestId('hero-figure')).toBeNull()
    fireEvent.click(within(hero()).getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('no session picked: the hero does not depend on Session fill, so its failure leaves it as is', () => {
    withSessions(undefined, { error: new Error('boom') })
    renderPage()
    expect(within(hero()).getByTestId('hero-figure')).toHaveTextContent('880')
    expect(hero()).toHaveTextContent('same point 2026 902')
  })

  it('one session picked: the headline compares with its folded campers, each once (#51)', () => {
    vi.mocked(useMetricsSession).mockReturnValue(
      session({
        selectedSessionCmId: 1000200,
        selectedSession: { cm_id: 1000200, name: 'Session 2' },
      })
    )
    withSessions({ ...FOLDED, rows: [S2_FOLDED], headline_prior: 380 })
    renderPage()
    expect(hero()).toHaveTextContent('same point 2026 380')
    expect(within(hero()).getByTestId('hero-change')).toHaveTextContent('▲ 500') // 880 vs 380
  })

  it("one session picked: the headline is busy while Session fill still holds another session's figure", () => {
    vi.mocked(useMetricsSession).mockReturnValue(
      session({
        selectedSessionCmId: 1000200,
        selectedSession: { cm_id: 1000200, name: 'Session 2' },
      })
    )
    withSessions({ ...FOLDED, rows: [S2_FOLDED], headline_prior: 380 }, { isPlaceholderData: true })
    renderPage()
    expect(hero()).toHaveTextContent('Loading 2027')
  })

  it('a whole-scope headline is unchanged (#51)', () => {
    withSessions({ ...FOLDED, headline_prior: null })
    renderPage()
    expect(hero()).toHaveTextContent('same point 2026 902')
  })
})
