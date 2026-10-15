/**
 * Registration › Overview: Total Cancelled carries the numbered note that says what it counts
 * (decision 11, #3207), never hover text, and the cards read with separators (decision 43).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RegistrationOverview from './RegistrationOverview'

const mockData = {
  year: 2026,
  total_enrolled: 1134,
  total_waitlisted: 95,
  total_cancelled: 1172,
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

describe('RegistrationOverview — Total Cancelled note and formatting (decisions 11, 43)', () => {
  it('marks Total Cancelled with note 1 and lists the final-status definition at the foot', () => {
    const { container } = render(<RegistrationOverview />)
    const title = screen.getByText('Total Cancelled', { selector: 'p' })
    expect(title.querySelector('sup')?.textContent).toBe('1')
    expect(screen.getByText(/whose status in CampMinder is Cancelled now/)).toBeInTheDocument()
    expect(container.querySelector('sup[title]')).toBeNull()
  })

  it('reads the cards with thousands separators', () => {
    render(<RegistrationOverview />)
    expect(screen.getByText('1,134')).toBeInTheDocument()
    expect(screen.getByText('1,172')).toBeInTheDocument()
  })
})
