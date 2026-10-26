/**
 * Registration › Cancellations: its "cancelled" and its swaps are labelled with numbered notes
 * (decisions 11 and 46, #3207), never hover text, and its numbers read with separators.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CancellationAnalysis from './CancellationAnalysis'
import { useComparisonCancellationData } from '../../../hooks/useComparisonCancellationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import type { CancellationSessionBreakdown } from '../../../types/metrics'

const mockData = {
  year: 2026,
  total_cancelled: 1172,
  was_enrolled: 90,
  was_waitlisted: 40,
  was_applied: 0,
  other_prior_status: 0,
  has_other_sessions: 81,
  no_other_sessions: 1091,
  total_re_enrolled: 7,
  session_swap_count: 81,
  true_departure_count: 1091,
  avg_days_to_cancellation: 97.5,
  median_days_to_cancellation: 102,
  time_to_cancellation_buckets: [],
  by_registration_month: [],
  by_session: [],
  by_grade: [],
  by_gender: [],
}

vi.mock('../../../hooks/useComparisonCancellationData', () => ({
  useComparisonCancellationData: vi.fn(() => ({
    primary: { data: mockData, isLoading: false, error: null },
    comparison: null,
  })),
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
    compareYear: null,
    isComparing: false,
    durationParam: undefined,
    filterOptions: {},
  })),
}))

function noteMark(label: string): string | null | undefined {
  const title = screen.getByText(label, { exact: false, selector: 'p, div' })
  return title.querySelector('sup')?.textContent
}

describe('CancellationAnalysis — numbered notes (decisions 11, 46)', () => {
  it('marks Total Cancelled with note 1 and the swap and departure cards with note 2', () => {
    render(<CancellationAnalysis />)
    expect(noteMark('Total Cancelled')).toBe('1')
    expect(noteMark('Session Swaps')).toBe('2')
    expect(noteMark('True Departures')).toBe('2')
  })

  it('lists both notes at the foot with the cancelled and swap definitions', () => {
    render(<CancellationAnalysis />)
    expect(screen.getByText(/Cancelled, Withdrawn or Dismissed now/)).toBeInTheDocument()
    expect(screen.getByText(/however long after cancelling they enrolled/)).toBeInTheDocument()
  })

  it('uses no hover text for the definitions', () => {
    const { container } = render(<CancellationAnalysis />)
    expect(container.querySelector('sup[title]')).toBeNull()
  })

  it('reads counts with thousands separators', () => {
    render(<CancellationAnalysis />)
    expect(screen.getByText('1,172')).toBeInTheDocument()
    expect(screen.getAllByText('1,091').length).toBeGreaterThan(0)
  })
})

function sessionRow(
  overrides: Partial<CancellationSessionBreakdown>
): CancellationSessionBreakdown {
  return {
    session_cm_id: 1,
    session_name: 'Session 1',
    total_cancelled: 1500,
    was_enrolled: 1000,
    was_waitlisted: 400,
    was_applied: 50,
    other_prior_status: 25,
    has_other_sessions: 1234,
    no_other_sessions: 266,
    ...overrides,
  }
}

describe('CancellationAnalysis session table number format', () => {
  it('separates every count and writes a fall against the compare year with a true minus', () => {
    const withSessions = { ...mockData, by_session: [sessionRow({})] }
    vi.mocked(useComparisonCancellationData).mockReturnValue({
      primary: { data: withSessions, isLoading: false, error: null },
      comparison: {
        data: { ...mockData, by_session: [sessionRow({ total_cancelled: 2750 })] },
      },
    } as unknown as ReturnType<typeof useComparisonCancellationData>)
    vi.mocked(useMetricsSession).mockReturnValue({
      selectedSessionCmId: null,
      sessions: [],
      activeSessionTypes: ['main', 'embedded', 'ag'],
      compareYear: 2025,
      isComparing: true,
      durationParam: undefined,
      filterOptions: {},
    } as unknown as ReturnType<typeof useMetricsSession>)

    render(<CancellationAnalysis />)
    const table = screen.getByText('Session Details').closest('.card-lodge') as HTMLElement
    const row = within(table)
      .getByText('Session 1', { selector: 'td' })
      .closest('tr') as HTMLElement
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual([
      'Session 1',
      '1,000',
      '400',
      '50',
      '25',
      '25',
      '1,234',
      '266',
      '1,500',
      '2,750',
      '\u22121,250',
    ])
  })
})

describe('CancellationAnalysis — busy cue and Try again (D-UNCOVERED)', () => {
  it('dims the previous season under "Loading 2026…" while the next loads', () => {
    vi.mocked(useComparisonCancellationData).mockReturnValueOnce({
      primary: {
        data: mockData,
        isLoading: false,
        error: null,
        isPlaceholderData: true,
        refetch: vi.fn(),
      },
      comparison: null,
    } as unknown as ReturnType<typeof useComparisonCancellationData>)
    render(<CancellationAnalysis />)
    expect(screen.getByText('Loading 2026…')).toBeInTheDocument()
    expect(
      screen.getByText('Total Cancelled', { exact: false, selector: 'p' }).closest('[inert]')
    ).not.toBeNull()
  })

  it('offers Try again on an error, which refetches', async () => {
    const refetch = vi.fn()
    vi.mocked(useComparisonCancellationData).mockReturnValueOnce({
      primary: { data: undefined, isLoading: false, error: new Error('timeout'), refetch },
      comparison: null,
    } as unknown as ReturnType<typeof useComparisonCancellationData>)
    render(<CancellationAnalysis />)
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalledTimes(1)
  })
  it('dims the page under "Loading 2024…" while a newly picked compare year loads', () => {
    vi.mocked(useMetricsSession).mockReturnValue({
      selectedSessionCmId: null,
      sessions: [],
      activeSessionTypes: ['main', 'embedded', 'ag'],
      compareYear: 2024,
      isComparing: true,
      durationParam: undefined,
      filterOptions: {},
    } as unknown as ReturnType<typeof useMetricsSession>)
    vi.mocked(useComparisonCancellationData).mockReturnValue({
      primary: {
        data: mockData,
        isLoading: false,
        error: null,
        isPlaceholderData: false,
        refetch: vi.fn(),
      },
      // The compare query keeps 2025's result on screen while 2024 loads
      comparison: { data: { ...mockData, year: 2025 }, isPlaceholderData: true },
    } as unknown as ReturnType<typeof useComparisonCancellationData>)
    render(<CancellationAnalysis />)
    expect(screen.getByText('Loading 2024…')).toBeInTheDocument()
    expect(
      screen.getAllByText('Total Cancelled', { exact: false, selector: 'p' })[0]?.closest('[inert]')
    ).not.toBeNull()
  })
})

describe('CancellationAnalysis — same point last year (PM-8 A)', () => {
  const comparing = () =>
    vi.mocked(useMetricsSession).mockReturnValue({
      selectedSessionCmId: null,
      sessions: [],
      activeSessionTypes: ['main', 'embedded', 'ag'],
      compareYear: 2025,
      isComparing: true,
      durationParam: undefined,
      filterOptions: {},
    } as unknown as ReturnType<typeof useMetricsSession>)
  const withComparison = (comp: Record<string, unknown>) =>
    vi.mocked(useComparisonCancellationData).mockReturnValue({
      primary: { data: mockData, isLoading: false, error: null },
      comparison: { data: { ...mockData, year: 2025, ...comp } },
    } as unknown as ReturnType<typeof useComparisonCancellationData>)
  const samePoint = {
    prior_basis: 'same_point',
    day_offset: 110,
    prior_day_offset: 110,
    as_of_date: '2025-03-02',
    total_cancelled: 1000,
    has_other_sessions: 70,
  }
  const card = (title: string) =>
    screen.getByText(title, { exact: false, selector: 'p' }).closest('.card-lodge') as HTMLElement

  it('says it compares with the same registration day, in one line', () => {
    comparing()
    withComparison({ ...samePoint, was_enrolled: 50 })
    render(<CancellationAnalysis />)
    expect(screen.getByText('vs same point')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Compared with 2025 as it stood on Mar 2, 2025, the same registration day as today.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/cancellations dated by Mar 2, 2025/)).toBeInTheDocument()
  })

  it('compares the figures rebuilt for the day', () => {
    comparing()
    withComparison({ ...samePoint, was_enrolled: null })
    render(<CancellationAnalysis />)
    expect(within(card('Total Cancelled')).getByText(/vs 2025/)).toBeInTheDocument()
    expect(within(card('Has Other Sessions')).getByText(/vs 2025/)).toBeInTheDocument()
  })

  it('shows no comparison on the status figures the history cannot rebuild, and says why', () => {
    comparing()
    withComparison({
      ...samePoint,
      was_enrolled: null,
      was_waitlisted: null,
      was_applied: null,
      other_prior_status: null,
      total_re_enrolled: null,
    })
    render(<CancellationAnalysis />)
    for (const title of ['Was Enrolled', 'Was Waitlisted', 'Re-enrolled']) {
      expect(within(card(title)).queryByText(/vs 2025/)).toBeNull()
    }
    expect(screen.getByText(/Re-enrolled have no comparison/)).toBeInTheDocument()
  })

  it('reads "vs final" once the season is over', () => {
    comparing()
    withComparison({ prior_basis: 'final', was_enrolled: 50 })
    render(<CancellationAnalysis />)
    expect(screen.getByText('vs final')).toBeInTheDocument()
    expect(within(card('Was Enrolled')).getByText(/vs 2025/)).toBeInTheDocument()
  })
})
