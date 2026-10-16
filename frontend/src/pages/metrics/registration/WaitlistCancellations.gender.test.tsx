/**
 * Registration › Waitlist and › Cancellations read gender identity (#2898): ruling 58's Gender field count sits
 * in a visible numbered line under each gender donut (#72 a) and in the page-foot Gender note, never at 0
 * (#73 a); the comparison table's line names both seasons. Waitlist's Gender note is 1 (the tab had no notes);
 * Cancellations' is 3, after Total Cancelled and Session Swaps.
 */
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WaitlistAnalysis from './WaitlistAnalysis'
import CancellationAnalysis from './CancellationAnalysis'
import { useComparisonWaitlistData } from '../../../hooks/useComparisonWaitlistData'
import { useComparisonCancellationData } from '../../../hooks/useComparisonCancellationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'

const byGender = [
  { gender: 'Girl/woman', count: 6, percentage: 60, no_enrollment: 4, has_enrollment: 2 },
  { gender: 'Boy/man', count: 3, percentage: 30, no_enrollment: 3, has_enrollment: 0 },
  { gender: 'not given', count: 1, percentage: 10, no_enrollment: 1, has_enrollment: 0 },
]

const waitlist = (year: number, fallback: number) => ({
  year,
  gender_fallback_count: fallback,
  total_waitlisted: 10,
  waitlisted_no_enrollment: 8,
  waitlisted_has_enrollment: 2,
  total_accepted: 0,
  total_declined: 0,
  by_session: [],
  by_grade: [],
  by_gender: byGender,
})

const cancellations = (year: number, fallback: number) => ({
  year,
  gender_fallback_count: fallback,
  total_cancelled: 10,
  was_enrolled: 0,
  was_waitlisted: 0,
  was_applied: 0,
  other_prior_status: 0,
  has_other_sessions: 0,
  no_other_sessions: 10,
  total_re_enrolled: 0,
  session_swap_count: 0,
  true_departure_count: 10,
  avg_days_to_cancellation: null,
  median_days_to_cancellation: null,
  time_to_cancellation_buckets: [],
  by_registration_month: [],
  by_session: [],
  by_grade: [],
  by_gender: byGender,
})

vi.mock('../../../hooks/useComparisonWaitlistData', () => ({
  useComparisonWaitlistData: vi.fn(),
}))
vi.mock('../../../hooks/useComparisonCancellationData', () => ({
  useComparisonCancellationData: vi.fn(),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2018 })),
}))
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: vi.fn(() => ({ setFilter: vi.fn(), DrilldownModal: () => null })),
}))
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(),
}))

function setup(compareYear: number | null, fallback = 7, compFallback = 9) {
  vi.mocked(useMetricsSession).mockReturnValue({
    selectedSessionCmId: null,
    sessions: [],
    activeSessionTypes: ['main', 'embedded', 'ag'],
    compareYear,
    isComparing: compareYear !== null,
    durationParam: undefined,
    filterOptions: {},
  } as unknown as ReturnType<typeof useMetricsSession>)
  const pair = <T,>(make: (y: number, f: number) => T) => ({
    primary: { data: make(2018, fallback), isLoading: false, error: null, refetch: vi.fn() },
    comparison:
      compareYear === null
        ? null
        : { data: make(compareYear, compFallback), isPlaceholderData: false },
  })
  vi.mocked(useComparisonWaitlistData).mockReturnValue(
    pair(waitlist) as unknown as ReturnType<typeof useComparisonWaitlistData>
  )
  vi.mocked(useComparisonCancellationData).mockReturnValue(
    pair(cancellations) as unknown as ReturnType<typeof useComparisonCancellationData>
  )
}

function card(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title }).closest('.card-lodge') as HTMLElement
}

function footNote(): string | null | undefined {
  return screen.getByText(/gender identity from CampMinder; a write-in counts as Self-described/)
    .textContent
}

describe.each([
  ['Waitlist', () => render(<WaitlistAnalysis />), 1],
  ['Cancellations', () => render(<CancellationAnalysis />), 3],
] as const)('%s › gender identity (#2898)', (_tab, renderTab, n) => {
  beforeEach(() => vi.clearAllMocks())

  it('lists every label by its display name in the donut legend', () => {
    setup(null)
    renderTab()
    expect(within(card('Gender Distribution')).getByText('Not given')).toBeInTheDocument()
  })

  it('states the Gender field count under the donut, numbered, and defines Gender at the page foot', () => {
    setup(null)
    renderTab()
    expect(
      within(card('Gender Distribution')).getByText(/with no gender identity answer/).textContent
    ).toBe(`${n} 7 campers with no gender identity answer are counted by the Gender field.`)
    expect(footNote()).toContain(
      '7 campers in 2018 with no gender identity answer are counted by the Gender field'
    )
  })

  it('puts both seasons on the comparison table line, and a line under each donut', () => {
    setup(2017)
    renderTab()
    expect(
      within(card('Gender Distribution Comparison')).getByText(/: campers with no gender identity/)
        .textContent
    ).toBe(
      `${n} 7 in 2018 and 9 in 2017: campers with no gender identity answer, counted by the Gender field.`
    )
    expect(
      within(card('2017 Gender Distribution')).getByText(/with no gender identity answer/)
        .textContent
    ).toContain('9 campers')
  })

  it('draws no line and no Gender note when no camper fell back (#73 a)', () => {
    setup(2017, 0, 0)
    renderTab()
    expect(screen.queryByText(/counted by the Gender field/)).toBeNull()
    expect(screen.queryByText(/gender identity from CampMinder/)).toBeNull()
  })
})
