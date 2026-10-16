/**
 * Registration › Overview: campers by age (epic #3207, owner ruling D-UNCOVERED). The chart sits
 * with the grade chart, its bars open the drill-down as the grade bars do, and the page's
 * numbered notes say how age is computed, in page order (Total Cancelled 1, age 2, Summers at
 * Camp 3).
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RegistrationOverview from './RegistrationOverview'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'

const setFilter = vi.fn()

const byAge = (counts: number[]) =>
  ['5-7', '8-10', '11-13', '14-16', '17+', 'none'].map((band, i) => ({
    band,
    count: counts[i] ?? 0,
    percentage: 0,
  }))

const mockData = {
  year: 2026,
  total_enrolled: 1291,
  total_waitlisted: 95,
  total_cancelled: 184,
  by_gender: [],
  by_grade: [{ grade: 5, count: 1291, percentage: 100 }],
  by_session: [],
  by_years_at_camp: [],
  new_vs_returning: {
    new_count: 300,
    returning_count: 991,
    new_percentage: 23.2,
    returning_percentage: 76.8,
  },
  by_summer_years: [{ summer_years: 1, count: 1291, percentage: 100 }],
  average_summers_at_camp: 2.6,
  by_age: byAge([22, 401, 545, 259, 64, 0]),
}

const compData = {
  ...mockData,
  year: 2025,
  total_enrolled: 1368,
  by_age: byAge([23, 437, 531, 309, 68, 0]),
}

vi.mock('../../../hooks/useComparisonRegistrationData', () => ({
  useComparisonRegistrationData: vi.fn(),
}))

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2026 })),
}))

vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: vi.fn(() => ({ setFilter, DrilldownModal: () => null })),
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(),
}))

const session = (compareYear: number | null) => ({
  selectedSessionCmId: null,
  sessions: [],
  activeSessionTypes: ['main', 'embedded', 'ag', 'quest', 'scit', 'tli'],
  compareYear,
  isComparing: compareYear !== null,
  durationParam: undefined,
  filterOptions: {},
})

beforeEach(() => {
  setFilter.mockClear()
  vi.mocked(useMetricsSession).mockReturnValue(
    session(null) as unknown as ReturnType<typeof useMetricsSession>
  )
  vi.mocked(useComparisonRegistrationData).mockReturnValue({
    primary: { data: mockData, isLoading: false, error: null },
    comparison: null,
  } as unknown as ReturnType<typeof useComparisonRegistrationData>)
})

function ageCard(title: string): HTMLElement {
  return screen.getByText(title).closest('.card-lodge') as HTMLElement
}

describe('RegistrationOverview — campers by age (D-UNCOVERED)', () => {
  it('shows Enrollment by Age with the six bands and their counts', () => {
    render(<RegistrationOverview />)
    const card = within(ageCard('Enrollment by Age'))
    for (const label of ['5–7', '8–10', '11–13', '14–16', '17+', 'None']) {
      expect(card.getByText(label)).toBeInTheDocument()
    }
    expect(card.getByText('545')).toBeInTheDocument()
    expect(card.getByText(/1,291 campers, each counted once\./)).toBeInTheDocument()
  })

  it('opens the drill-down for a band, as the grade bars do', () => {
    render(<RegistrationOverview />)
    fireEvent.click(within(ageCard('Enrollment by Age')).getByText('545').closest('button')!)
    expect(setFilter).toHaveBeenCalledWith({
      type: 'age_band',
      value: '11-13',
      label: 'Ages 11–13',
    })
  })

  it('numbers the age note 2, between Total Cancelled (1) and Summers at Camp (3), listed at the foot in page order', () => {
    const { container } = render(<RegistrationOverview />)
    const sup = within(ageCard('Enrollment by Age')).getByText('2', { selector: 'sup' })
    expect(sup).toBeInTheDocument()
    expect(screen.getByText(/summers per camper/).querySelector('sup')?.textContent).toBe('3')
    const items = Array.from(container.querySelectorAll('ol > li')).map((li) => li.textContent)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatch(/^1\.\s*Cancelled/)
    expect(items[1]).toMatch(/^2\.\s*Age is the season year minus the birth year/)
    expect(items[2]).toMatch(/^3\.\s*From CampMinder's Years at Camp/)
    expect(container.querySelector('sup[title]')).toBeNull()
  })

  it('compares two seasons side by side, each read in its own season, and the compare chart does not drill', () => {
    vi.mocked(useMetricsSession).mockReturnValue(
      session(2025) as unknown as ReturnType<typeof useMetricsSession>
    )
    vi.mocked(useComparisonRegistrationData).mockReturnValue({
      primary: { data: mockData, isLoading: false, error: null },
      comparison: { data: compData },
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)
    render(<RegistrationOverview />)
    expect(within(ageCard('2026 Age')).getByText('545')).toBeInTheDocument()
    const prior = within(ageCard('2025 Age'))
    expect(prior.getByText('531')).toBeInTheDocument()
    expect(prior.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Age Comparison')).toBeInTheDocument()
  })
})
