/**
 * Registration › Overview: Total Cancelled carries the numbered note that says what it counts
 * (decision 11, #3207), never hover text, and the cards read with separators (decision 43).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RegistrationOverview from './RegistrationOverview'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'

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

describe('RegistrationOverview — busy cue and Try again (D-UNCOVERED)', () => {
  it('dims the previous numbers under "Loading 2026…" while the next season loads', () => {
    vi.mocked(useComparisonRegistrationData).mockReturnValueOnce({
      primary: {
        data: mockData,
        isLoading: false,
        error: null,
        isPlaceholderData: true,
        refetch: vi.fn(),
      },
      comparison: null,
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)
    render(<RegistrationOverview />)
    expect(screen.getByText('Loading 2026…')).toBeInTheDocument()
    expect(screen.getByText('1,134').closest('[inert]')).not.toBeNull()
  })

  it('offers Try again on an error, which refetches', () => {
    const refetch = vi.fn()
    vi.mocked(useComparisonRegistrationData).mockReturnValueOnce({
      primary: { data: undefined, isLoading: false, error: new Error('timeout'), refetch },
      comparison: null,
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)
    render(<RegistrationOverview />)
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
    vi.mocked(useComparisonRegistrationData).mockReturnValue({
      primary: {
        data: mockData,
        isLoading: false,
        error: null,
        isPlaceholderData: false,
        refetch: vi.fn(),
      },
      // The compare query keeps 2025's result on screen while 2024 loads
      comparison: { data: { ...mockData, year: 2025 }, isPlaceholderData: true },
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)
    render(<RegistrationOverview />)
    expect(screen.getByText('Loading 2024…')).toBeInTheDocument()
    expect(screen.getAllByText('1,134')[0]?.closest('[inert]')).not.toBeNull()
  })
})

describe('RegistrationOverview — one numbered note list in page order (decisions 11, 12)', () => {
  const footNotes = (container: HTMLElement) => {
    const lists = container.querySelectorAll('ol')
    return Array.from(lists).flatMap((ol) =>
      Array.from(ol.querySelectorAll('li')).map((li) => li.textContent)
    )
  }

  it('lists Cancelled as 1, the age chart as 2 and the Summers at Camp average as 3 in one list', () => {
    const by_age = ['5-7', '8-10', '11-13', '14-16', '17+', 'none'].map((band) => ({
      band,
      count: band === '8-10' ? 1134 : 0,
      percentage: band === '8-10' ? 100 : 0,
    }))
    vi.mocked(useComparisonRegistrationData).mockReturnValueOnce({
      primary: {
        data: { ...mockData, average_summers_at_camp: 2.6, by_age },
        isLoading: false,
        error: null,
      },
      comparison: null,
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)
    const { container } = render(<RegistrationOverview />)
    expect(container.querySelectorAll('ol')).toHaveLength(1)
    const notes = footNotes(container)
    expect(notes).toHaveLength(3)
    expect(notes[0]).toMatch(/^1\..*Cancelled now/)
    expect(notes[1]).toMatch(/^2\..*season year minus the birth year/)
    expect(notes[2]).toMatch(/^3\..*Years at Camp/)
  })

  it('leaves the average note out when there is no average', () => {
    const { container } = render(<RegistrationOverview />)
    const notes = footNotes(container)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/^1\..*Cancelled now/)
  })
})
