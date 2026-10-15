/**
 * Registration › Cancellations: its "cancelled" and its swaps are labelled with numbered notes
 * (decisions 11 and 46, #3207), never hover text, and its numbers read with separators.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CancellationAnalysis from './CancellationAnalysis'

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
