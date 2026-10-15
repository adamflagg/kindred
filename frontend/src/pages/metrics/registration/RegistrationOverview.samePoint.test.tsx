/**
 * Registration › Overview compares with the same point last year while registration is live, and
 * with last year's final after (decision 7, PR 7). It says which, with numbered notes (no hover).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RegistrationOverview from './RegistrationOverview'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import type { RegistrationMetrics } from '../../../types/metrics'

function metrics(year: number, over: Partial<RegistrationMetrics> = {}): RegistrationMetrics {
  return {
    year,
    total_enrolled: 1000,
    total_waitlisted: 90,
    total_cancelled: 50,
    by_gender: [],
    by_grade: [],
    by_session: [],
    by_years_at_camp: [],
    new_vs_returning: {
      new_count: 300,
      returning_count: 700,
      new_percentage: 30,
      returning_percentage: 70,
    },
    ...over,
  }
}

vi.mock('../../../hooks/useComparisonRegistrationData', () => ({
  useComparisonRegistrationData: vi.fn(),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2026 })),
}))
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: vi.fn(() => ({ setFilter: vi.fn(), DrilldownModal: () => null })),
}))
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(() => ({
    selectedSessionCmId: null,
    sessions: [],
    activeSessionTypes: ['main', 'embedded', 'ag'],
    compareYear: 2025,
    isComparing: true,
    durationParam: undefined,
    filterOptions: {},
  })),
}))

function withComparison(comparison: RegistrationMetrics) {
  vi.mocked(useComparisonRegistrationData).mockReturnValue({
    primary: { data: metrics(2026), isLoading: false, error: null },
    comparison: { data: comparison },
    isComparing: true,
  } as unknown as ReturnType<typeof useComparisonRegistrationData>)
}

const SAME_POINT = {
  total_enrolled: 960,
  total_waitlisted: null,
  total_cancelled: 30,
  prior_basis: 'same_point' as const,
  day_offset: 110,
  prior_day_offset: 110,
  as_of_date: '2025-03-02',
}

function card(title: string): HTMLElement {
  const label = screen.getByText(title, { selector: 'p' })
  return label.closest('.card-lodge') as HTMLElement
}

describe('RegistrationOverview — same point last year (decision 7)', () => {
  beforeEach(() => vi.mocked(useComparisonRegistrationData).mockReset())

  it('says it compares with the same point, and when that was', () => {
    withComparison(metrics(2025, SAME_POINT))
    render(<RegistrationOverview />)
    expect(screen.getByText('vs same point')).toBeInTheDocument()
    expect(
      screen.getByText(/Compared with 2025 as it stood on Mar 2, 2025, the same registration day/)
    ).toBeInTheDocument()
  })

  it('lists the rebuild note at the foot, numbered, with no hover text', () => {
    withComparison(metrics(2025, SAME_POINT))
    const { container } = render(<RegistrationOverview />)
    expect(
      screen.getByText(/2025 is rebuilt from each camper's registration date/)
    ).toBeInTheDocument()
    expect(container.querySelector('sup[title]')).toBeNull()
  })

  it('compares the cards with the same-point numbers', () => {
    withComparison(metrics(2025, SAME_POINT))
    render(<RegistrationOverview />)
    expect(card('Total Enrolled').textContent).toMatch(/40 vs 2025/)
    expect(card('Total Cancelled').textContent).toMatch(/20 vs 2025/)
  })

  it('gives Total Waitlisted no comparison, because a past waitlist cannot be rebuilt', () => {
    withComparison(metrics(2025, SAME_POINT))
    render(<RegistrationOverview />)
    expect(card('Total Waitlisted').textContent).not.toMatch(/vs 2025/)
  })

  it('reads "updates tomorrow" on the priority date itself (ruling 9)', () => {
    withComparison(
      metrics(2025, { ...SAME_POINT, day_offset: 0, prior_day_offset: 1, as_of_date: '2024-11-13' })
    )
    render(<RegistrationOverview />)
    expect(card('Total Enrolled').textContent).toMatch(/updates tomorrow/)
    expect(card('Total Enrolled').textContent).not.toMatch(/vs 2025/)
    expect(screen.getByText(/opening day and the next day/)).toBeInTheDocument()
  })

  it('says "vs final" once the season is over, and keeps the waitlist compare', () => {
    withComparison(
      metrics(2025, {
        total_enrolled: 1200,
        total_waitlisted: 80,
        prior_basis: 'final',
        day_offset: null,
        prior_day_offset: null,
        as_of_date: null,
      })
    )
    render(<RegistrationOverview />)
    expect(screen.getByText('vs final')).toBeInTheDocument()
    expect(screen.getByText("Compared with 2025's final numbers.")).toBeInTheDocument()
    expect(card('Total Waitlisted').textContent).toMatch(/10 vs 2025/)
    expect(screen.queryByText(/rebuilt from each camper's registration date/)).toBeNull()
  })
})
