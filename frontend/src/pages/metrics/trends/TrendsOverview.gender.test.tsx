/**
 * Trends reads gender identity (#2898): the line chart, the composition bars and the Year-by-Year table use the
 * five groups (#75 a), and ruling 58's Gender field count is note 4 (after the table's own three), listed per season above 0 (#74 a).
 */
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import TrendsOverview from './TrendsOverview'
import { useHistoricalTrends } from '../../../hooks/useMetrics'
import { useRetentionTrends } from '../../../hooks/useRetentionTrends'

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => ({
    activeSessionTypes: ['main', 'embedded'],
    scopeHasTeens: false,
    includeTeenPipeline: false,
    setIncludeTeenPipeline: vi.fn(),
    expandedRetention: false,
    filterOptions: { sessionTypes: 'main,embedded' },
    selectedSessionCmId: null,
  }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: 2018,
    availableYears: [2017, 2018],
    isTransitioning: false,
    isYearReady: true,
  }),
}))

function year(y: number, fallback: number, byGender: Array<[string, number]>) {
  const total = byGender.reduce((s, [, n]) => s + n, 0)
  return {
    year: y,
    total_enrolled: total,
    total_cancelled: 0,
    cancellation_rate: 0,
    gender_fallback_count: fallback,
    new_vs_returning: {
      new_count: 1,
      returning_count: total - 1,
      new_percentage: 10,
      returning_percentage: 90,
    },
    by_gender: byGender.map(([gender, count]) => ({ gender, count, percentage: 0 })),
    by_grade: [],
    by_summer_years: [],
    by_first_summer_year: [],
    by_city: [],
    by_school: [],
    by_synagogue: [],
  }
}

const years = [
  year(2017, 798, [
    ['Girl/woman', 600],
    ['Boy/man', 530],
    ['Non-binary', 9],
  ]),
  year(2018, 762, [
    ['Girl/woman', 596],
    ['Boy/man', 548],
    ['Non-binary', 20],
    ['Transgender boy/man', 5],
    ['not given', 2],
  ]),
]

vi.mock('../../../hooks/useMetrics', () => ({
  useHistoricalTrends: vi.fn(() => ({ data: { years }, isLoading: false, error: null })),
  useRegistrationMetrics: vi.fn(() => ({ data: undefined })),
}))
vi.mock('../../../hooks/useCompareYearFilter', () => ({
  useCompareYearFilter: (_p: number, _c: number | null, options: unknown) => options,
}))
vi.mock('../../../hooks/useRetentionTrends', () => ({
  useRetentionTrends: vi.fn(() => ({
    data: {
      years: [],
      enrollment_by_year: years.map((y) => ({
        year: y.year,
        total: y.total_enrolled,
        gender_fallback_count: y.gender_fallback_count,
        by_gender: y.by_gender.map(({ gender, count }) => ({ gender, count })),
        by_grade: [],
        by_city: [],
      })),
    },
    isLoading: false,
    error: null,
  })),
}))
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: ({ name }: { name: string }) => <span data-testid="line">{name}</span>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: () => null,
  LabelList: () => null,
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TrendsOverview />
    </QueryClientProvider>
  )
}

function card(title: RegExp | string): HTMLElement {
  return screen.getByRole('heading', { name: title }).closest('.card-lodge') as HTMLElement
}

describe('Trends › gender identity (#2898)', () => {
  it('draws one line per group, Another identity and No answer included', () => {
    renderPage()
    const lines = [...card('Enrollment by Gender').querySelectorAll('[data-testid="line"]')].map(
      (l) => l.textContent
    )
    expect(lines).toEqual(['Girl/woman', 'Boy/man', 'Non-binary', 'Another identity', 'No answer'])
  })

  it('lists the seasons that fell back under the line chart, numbered 4', () => {
    renderPage()
    expect(card('Enrollment by Gender').textContent).toContain(
      '4 Campers with no gender identity answer, counted by the Gender field: 2017: 798 of 1,139 · 2018: 762 of 1,171.'
    )
  })

  it('heads the Year-by-Year table with the groups, and marks each season that fell back', () => {
    renderPage()
    const table = card('Year-by-Year Summary')
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual([
      'Year↑',
      'Total↕',
      'vs final1↕',
      'New↕',
      'Returning↕',
      'New %↕',
      'Girl/woman↕',
      'Boy/man↕',
      'Non-binary↕',
      'Another identity↕',
      'No answer↕',
      'Cancelled2↕',
      'Cancel %3↕',
    ])

    const row2018 = [...table.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent.startsWith('2018')
    )
    expect(row2018?.querySelector('td')?.textContent).toBe('20184')
    expect(row2018?.textContent).toContain('596548205') // girl/woman, boy/man, non-binary, another identity
  })

  it('lists only the seasons the Gender Composition card draws under it', () => {
    // Five seasons on the page, the last three on the composition card (#3273 scan, ruling #72's own count).
    const five = [
      year(2014, 400, [['Girl/woman', 500]]),
      year(2015, 0, [['Girl/woman', 500]]),
      year(2016, 0, [['Girl/woman', 500]]),
      year(2017, 0, [['Girl/woman', 500]]),
      year(2018, 30, [['Girl/woman', 500]]),
    ]
    const historical = vi.mocked(useHistoricalTrends)
    const retention = vi.mocked(useRetentionTrends)
    const historicalBefore = historical.getMockImplementation()
    const retentionBefore = retention.getMockImplementation()
    historical.mockImplementation(
      () => ({ data: { years: five }, isLoading: false, error: null }) as never
    )
    retention.mockImplementation(
      () =>
        ({
          data: {
            years: [],
            enrollment_by_year: five.map((y) => ({
              year: y.year,
              total: y.total_enrolled,
              gender_fallback_count: y.gender_fallback_count,
              by_gender: y.by_gender.map(({ gender, count }) => ({ gender, count })),
              by_grade: [],
              by_city: [],
            })),
          },
          isLoading: false,
          error: null,
        }) as never
    )
    try {
      renderPage()
      expect(card('Enrollment by Gender').textContent).toContain(
        '2014: 400 of 500 · 2018: 30 of 500.'
      )
      const composition = card(/Gender Composition/).textContent
      expect(composition).toContain('counted by the Gender field: 2018: 30 of 500.')
      expect(composition).not.toContain('2014')
    } finally {
      historical.mockImplementation(historicalBefore!)
      retention.mockImplementation(retentionBefore!)
    }
  })

  it('adds the Gender note as note 4 under the table', () => {
    renderPage()
    expect(screen.getByText(/gender identity from CampMinder/).textContent).toContain(
      '798 campers in 2017 and 762 in 2018 with no gender identity answer are counted by the Gender field'
    )
  })
})
