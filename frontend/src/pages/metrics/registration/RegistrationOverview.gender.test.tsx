/**
 * Registration › Overview reads gender identity (#2898): every label in the donuts and the comparison table, the
 * five groups in the stacked bars (#75 a) with the Another identity line, and ruling 58's Gender field count as a
 * visible line under each chart (#72 a) and a page-foot note, never at 0 (#73 a).
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RegistrationOverview from './RegistrationOverview'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'
import { useMetricsSession } from '../../../hooks/useMetricsSession'

const base = {
  total_waitlisted: 0,
  total_cancelled: 0,
  by_grade: [],
  by_session: [],
  by_years_at_camp: [],
  new_vs_returning: {
    new_count: 0,
    returning_count: 0,
    new_percentage: 0,
    returning_percentage: 0,
  },
}

const y2018 = {
  ...base,
  year: 2018,
  total_enrolled: 20,
  gender_fallback_count: 12,
  by_gender: [
    { gender: 'Girl/woman', count: 10, percentage: 50 },
    { gender: 'Boy/man', count: 7, percentage: 35 },
    { gender: 'Transgender boy/man', count: 2, percentage: 10 },
    { gender: 'not given', count: 1, percentage: 5 },
  ],
  by_gender_grade: [
    { grade: 5, total: 12, by_gender: { 'Girl/woman': 6, 'Boy/man': 5, 'Transgender boy/man': 1 } },
    {
      grade: 6,
      total: 8,
      by_gender: { 'Girl/woman': 4, 'Boy/man': 2, 'Transgender boy/man': 1, 'not given': 1 },
    },
  ],
  by_gender_by_session_length: [
    {
      length_category: '2-week',
      total: 20,
      by_gender: { 'Girl/woman': 10, 'Boy/man': 7, 'Transgender boy/man': 2, 'not given': 1 },
    },
  ],
}

const y2017 = {
  ...y2018,
  year: 2017,
  total_enrolled: 18,
  gender_fallback_count: 15,
  by_gender: [
    { gender: 'Girl/woman', count: 10, percentage: 55.6 },
    { gender: 'Boy/man', count: 8, percentage: 44.4 },
  ],
}

vi.mock('../../../hooks/useComparisonRegistrationData', () => ({
  useComparisonRegistrationData: vi.fn(),
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

function setup(compareYear: number | null, primary = y2018) {
  vi.mocked(useMetricsSession).mockReturnValue({
    selectedSessionCmId: null,
    sessions: [],
    activeSessionTypes: ['main', 'embedded', 'ag'],
    compareYear,
    isComparing: compareYear !== null,
    durationParam: undefined,
    filterOptions: {},
  } as unknown as ReturnType<typeof useMetricsSession>)
  vi.mocked(useComparisonRegistrationData).mockReturnValue({
    primary: { data: primary, isLoading: false, error: null, refetch: vi.fn() },
    comparison: compareYear === null ? null : { data: y2017, isPlaceholderData: false },
  } as unknown as ReturnType<typeof useComparisonRegistrationData>)
  return render(<RegistrationOverview />)
}

function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title })
  return heading.closest('.card-lodge') as HTMLElement
}

describe('Registration › gender identity (#2898)', () => {
  it('states the Gender field count under the gender chart, numbered, and defines Gender at the page foot', () => {
    setup(null)
    const line = within(card('Enrollment by Gender')).getByText(/with no gender identity answer/)
    expect(line.textContent).toBe(
      '2 12 campers with no gender identity answer are counted by the Gender field.'
    )
    expect(
      screen.getByText(/gender identity from CampMinder; a write-in counts as Self-described/)
        .textContent
    ).toContain('12 campers in 2018 with no gender identity answer are counted by the Gender field')
  })

  it('folds the stacked bars into the groups, Another identity listed under them', () => {
    setup(null)
    const grade = card('Gender by Grade')
    expect(within(grade).getByText('Another identity', { selector: 'span' })).toBeInTheDocument()
    expect(within(grade).getByText('No answer', { selector: 'span' })).toBeInTheDocument()
    expect(within(grade).queryByText('Transgender boy/man', { selector: 'span' })).toBeNull()
    const groupLine = [...grade.querySelectorAll('p')].find((p) =>
      p.textContent.startsWith('Another identity =')
    )
    expect(groupLine?.textContent).toContain('Another identity = Transgender boy/man 2.')
    expect(within(grade).getByText(/counted by the Gender field/).textContent).toContain(
      '12 campers'
    )
  })

  it('lists every label on the comparison table, with both seasons on its note line', () => {
    setup(2017)
    const table = card('Gender Comparison')
    expect(within(table).getByText('Transgender boy/man')).toBeInTheDocument()
    expect(within(table).getByText('Not given')).toBeInTheDocument()
    expect(within(table).getByText(/: campers with no gender identity answer/).textContent).toBe(
      '2 12 in 2018 and 15 in 2017: campers with no gender identity answer, counted by the Gender field.'
    )
  })

  it('draws no note line and no note when no camper fell back (#73 a)', () => {
    setup(null, { ...y2018, gender_fallback_count: 0 })
    expect(screen.queryByText(/counted by the Gender field/)).toBeNull()
  })
})
