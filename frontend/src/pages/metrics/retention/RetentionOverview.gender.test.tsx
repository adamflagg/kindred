/**
 * Retention reads gender identity (#2898): a Retention by Gender table listing every label, ruling 58's Gender
 * field count under the gender cards and at the page foot, and #82 (a, ruled): "Read with care" when more than a
 * quarter of the base season has no identity answer.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RetentionOverview from './RetentionOverview'
import type { RetentionMetrics } from '../../../types/metrics'

const base: RetentionMetrics = {
  base_year: 2017,
  compare_year: 2018,
  base_year_total: 1000,
  returned_count: 700,
  overall_retention_rate: 0.7,
  gender_fallback_count: 400,
  gender_fallback_returned_count: 224,
  by_gender: [
    { gender: 'Boy/man', base_count: 450, returned_count: 300, retention_rate: 0.667 },
    { gender: 'Girl/woman', base_count: 520, returned_count: 380, retention_rate: 0.731 },
    { gender: 'Non-binary', base_count: 20, returned_count: 15, retention_rate: 0.75 },
    { gender: 'not given', base_count: 10, returned_count: 5, retention_rate: 0.5 },
  ],
  by_grade: [],
  by_session: [],
  by_years_at_camp: [],
  by_summer_years: [],
  by_first_summer_year: [],
  by_prior_session: [],
  by_city: [],
  by_school: [],
  by_synagogue: [],
  session_flow: [],
  aged_out_count: 0,
}

const useRetentionMetricsMock = vi.fn()
vi.mock('../../../hooks/useMetrics', () => ({
  useRetentionMetrics: (...args: unknown[]) => useRetentionMetricsMock(...args),
}))
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => ({
    selectedSessionCmId: null,
    sessions: [],
    activeSessionTypes: ['main', 'embedded', 'ag'],
    durationParam: undefined,
    filterOptions: { sessionTypes: 'main,embedded,ag' },
    includeTeenPipeline: false,
    scopeHasTeens: false,
  }),
}))
// Last year's comparison maps the picked session onto its own list; no QueryClient here (#3207 PR 11)
vi.mock('../../../hooks/useCompareYearFilter', () => ({
  useCompareYearFilter: (_p: number, _c: number, options: unknown) => options,
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useCurrentYear: () => ({ currentYear: 2018 }) }))
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: () => ({ setFilter: vi.fn(), DrilldownModal: () => null }),
}))
vi.mock('../../../components/metrics/RetentionRateLineChart', () => ({
  RetentionRateLineChart: () => null,
}))
vi.mock('../../../components/metrics/CssVerticalRetentionBarChart', () => ({
  CssVerticalRetentionBarChart: () => null,
}))
vi.mock('../../../components/metrics/RetentionNotableOutliers', () => ({
  OutlierSection: () => null,
}))

function show(data: RetentionMetrics) {
  useRetentionMetricsMock.mockReturnValue({ data, isLoading: false, error: null })
  return render(<RetentionOverview />)
}

function table(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Retention by Gender' })
    .closest('.card-lodge') as HTMLElement
}

describe('Retention › gender identity (#2898)', () => {
  it('lists every label in the fixed order, with base, returned and rate', () => {
    show(base)
    const rows = [...table().querySelectorAll('tbody tr')].map((tr) => tr.textContent)
    expect(rows).toEqual([
      'Girl/woman52038073.1%',
      'Boy/man45030066.7%',
      'Non-binary201575.0%',
      'Not given10550.0%',
      'All1,00070070.0%',
    ])
  })

  it('states the Gender field count under the table and at the page foot', () => {
    show(base)
    expect(table().textContent).toContain(
      '400 campers with no gender identity answer are counted by the Gender field (2017 campers).'
    )
    expect(screen.getByText(/gender identity from CampMinder/).textContent).toContain(
      '400 campers in 2017 with no gender identity answer are counted by the Gender field'
    )
  })

  it("states the returning pie's own count under it: the campers who returned (#72 a)", () => {
    show(base)
    const pie = screen
      .getByRole('heading', { name: /Returning Campers by Gender/ })
      .closest('.card-lodge') as HTMLElement
    expect(pie.textContent).toContain(
      '224 campers with no gender identity answer are counted by the Gender field (2017 campers who returned).'
    )
  })

  it('reads with care when more than a quarter of the base season has no answer (#82 a)', () => {
    show(base)
    expect(table().textContent).toContain(
      'Read with care: 400 of 1,000 2017 campers have no identity answer.'
    )
    expect(table().textContent).toContain(
      '2017: 79% of campers with an answer returned, 56% of those without'
    )
  })

  it('does not at 25% or under, and shows no note at 0', () => {
    const first = show({ ...base, gender_fallback_count: 250, gender_fallback_returned_count: 100 })
    expect(table().textContent).not.toContain('Read with care')
    first.unmount()
    show({ ...base, gender_fallback_count: 0, gender_fallback_returned_count: 0 })
    expect(screen.queryByText(/counted by the Gender field/)).toBeNull()
  })
})
