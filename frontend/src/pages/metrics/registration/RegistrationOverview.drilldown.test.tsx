/**
 * Registration › Overview (epic #3207 PR 6, decision 43): Total Waitlisted and Total Cancelled open the
 * waitlist and cancellation lists, with Enrolled In, titled as on the Waitlist and Cancellations pages.
 * Each list counts what its card counts: the Overview's Total Cancelled is status Cancelled only, so its
 * list asks for that status (the Cancellations page's Total also counts withdrawn and dismissed).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RegistrationOverview from './RegistrationOverview'

const mockData = {
  year: 2026,
  total_enrolled: 1134,
  total_waitlisted: 95,
  total_cancelled: 172,
  by_gender: [],
  by_grade: [],
  by_session: [],
  by_years_at_camp: [],
  new_vs_returning: {
    new_count: 300,
    returning_count: 834,
    new_percentage: 26.5,
    returning_percentage: 73.5,
  },
}

const mockSetFilter = vi.fn()

vi.mock('../../../hooks/useComparisonRegistrationData', () => ({
  useComparisonRegistrationData: vi.fn(() => ({
    primary: { data: mockData, isLoading: false, error: null },
    comparison: null,
  })),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2026 })),
}))
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: vi.fn(() => ({ setFilter: mockSetFilter, DrilldownModal: () => null })),
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

function clickCard(title: string) {
  const card = screen
    .getAllByText(title)
    .map((el) => el.closest('[role="button"]'))
    .find(Boolean)
  expect(card).toBeTruthy()
  fireEvent.click(card!)
}

describe('RegistrationOverview — status cards open the same lists as the pages (decision 43)', () => {
  beforeEach(() => mockSetFilter.mockClear())

  it('Total Waitlisted opens the waitlist list, as the Waitlist page Total does', () => {
    render(<RegistrationOverview />)
    clickCard('Total Waitlisted')
    expect(mockSetFilter).toHaveBeenCalledWith({
      type: 'waitlist_total',
      value: 'all',
      label: 'Total Waitlisted',
    })
  })

  it('Total Cancelled opens the cancellation list, scoped to the status its card counts', () => {
    render(<RegistrationOverview />)
    clickCard('Total Cancelled')
    expect(mockSetFilter).toHaveBeenCalledWith({
      type: 'cancellation_total',
      value: 'all',
      label: 'Total Cancelled',
      statusOverride: ['cancelled'],
    })
  })
})
