/**
 * Retention compares with the same point last year (#3207 PR 11; decision 7, rulings #84–#88, #91).
 * While registration is live every figure reads against last year as it stood on the same
 * registration day; after it, final against final. Good / Low retires in both states.
 */
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RetentionOverview from './RetentionOverview'
import type { RetentionMetrics, RetentionRateBarItem } from '../../../types/metrics'

const empty = {
  by_gender: [],
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

const current: RetentionMetrics = {
  ...empty,
  base_year: 2025,
  compare_year: 2026,
  base_year_total: 1862,
  returned_count: 1220,
  overall_retention_rate: 0.655,
  by_gender: [
    { gender: 'Girl/woman', base_count: 900, returned_count: 600, retention_rate: 0.6667 },
    { gender: 'Non-binary', base_count: 18, returned_count: 10, retention_rate: 0.5556 },
  ],
  by_grade: [
    { grade: 5, base_count: 241, returned_count: 160, retention_rate: 0.664 },
    { grade: 2, base_count: 18, returned_count: 10, retention_rate: 0.556 },
  ],
  by_session: [
    {
      session_cm_id: 11,
      session_name: 'Taste of Camp 2',
      base_count: 100,
      returned_count: 70,
      retention_rate: 0.7,
    },
  ],
  by_first_summer_year: [
    { first_summer_year: 2025, base_count: 300, returned_count: 150, retention_rate: 0.5 },
  ],
  by_city: [{ city: 'Springfield', base_count: 50, returned_count: 30, retention_rate: 0.6 }],
}

const priorLive: RetentionMetrics = {
  ...empty,
  base_year: 2024,
  compare_year: 2025,
  base_year_total: 1801,
  returned_count: 1145,
  overall_retention_rate: 0.636,
  prior_basis: 'same_point',
  as_of_date: '2025-10-16',
  day_offset: -27,
  prior_day_offset: -27,
  by_gender: [
    { gender: 'Girl/woman', base_count: 880, returned_count: 560, retention_rate: 0.6364 },
    { gender: 'Non-binary', base_count: 15, returned_count: 7, retention_rate: 0.4667 },
  ],
  by_grade: [
    { grade: 5, base_count: 230, returned_count: 148, retention_rate: 0.642 },
    { grade: 2, base_count: 20, returned_count: 10, retention_rate: 0.495 },
  ],
  by_session: [
    {
      session_cm_id: 21,
      session_name: 'Session 2b',
      base_count: 90,
      returned_count: 45,
      retention_rate: 0.5,
    },
  ],
  by_first_summer_year: [
    { first_summer_year: 2024, base_count: 280, returned_count: 126, retention_rate: 0.45 },
  ],
  by_city: [{ city: 'Springfield', base_count: 45, returned_count: 25, retention_rate: 0.5556 }],
}

const priorFinal: RetentionMetrics = { ...priorLive, prior_basis: 'final' }
delete priorFinal.as_of_date

let prior: RetentionMetrics | undefined = priorLive
const useRetentionMetricsMock = vi.fn()
vi.mock('../../../hooks/useMetrics', () => ({
  useRetentionMetrics: (...args: unknown[]) => {
    useRetentionMetricsMock(...args)
    const samePoint = args[4] as { samePointOf?: number } | undefined
    if (samePoint?.samePointOf) return { data: prior, isLoading: prior === undefined, error: null }
    return { data: current, isLoading: false, error: null }
  },
}))
vi.mock('../../../hooks/useCompareYearFilter', () => ({
  useCompareYearFilter: (_p: number, _c: number, options: unknown) => options,
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
vi.mock('../../../hooks/useCurrentYear', () => ({ useCurrentYear: () => ({ currentYear: 2026 }) }))
vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: () => ({ setFilter: vi.fn(), DrilldownModal: () => null }),
}))
vi.mock('../../../components/metrics/BreakdownChart', () => ({ BreakdownChart: () => null }))

type ChartProps = { title: string; data: RetentionRateBarItem[]; compare?: { live: boolean } }
const charts = new Map<string, ChartProps>()
vi.mock('../../../components/metrics/CssVerticalRetentionBarChart', () => ({
  CssVerticalRetentionBarChart: (props: ChartProps) => {
    charts.set(props.title, props)
    return null
  },
}))
vi.mock('../../../components/metrics/RetentionRateLineChart', () => ({
  RetentionRateLineChart: (props: ChartProps) => {
    charts.set(props.title, props)
    return null
  },
}))
vi.mock('../../../components/metrics/RetentionNotableOutliers', () => ({
  OutlierSection: () => null,
}))

function card(title: RegExp): HTMLElement {
  return screen.getByText(title).closest('.card-lodge') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  charts.clear()
  prior = priorLive
})

describe('while registration is live (#84, #86, #87, #88)', () => {
  it("asks for last year's retention at this season's registration day", () => {
    render(<RetentionOverview />)
    expect(useRetentionMetricsMock).toHaveBeenCalledWith(2024, 2025, expect.anything(), false, {
      samePointOf: 2026,
    })
  })

  it('says the basis under the title, with the computed date', () => {
    render(<RetentionOverview />)
    expect(screen.getByText('vs same point last year.')).toBeInTheDocument()
    expect(screen.getByText(/Compared with 2025 as it stood on Oct 16, 2025/)).toBeInTheDocument()
  })

  it('replaces Good / Low with the change in points and its note mark', () => {
    render(<RetentionOverview />)
    const rate = card(/^Overall Retention Rate$/)
    expect(within(rate).getByText('▲ +1.9 pts')).toBeInTheDocument()
    expect(rate).toHaveTextContent('▲ +1.9 pts1')
    expect(screen.queryByText('Good')).not.toBeInTheDocument()
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })

  it('reads the Returned card so far, against last year by this day', () => {
    render(<RetentionOverview />)
    expect(screen.getByText('65.5% retention so far')).toBeInTheDocument()
    expect(screen.getByText('2025 had 1,145 by this day of 2025 (+75)')).toBeInTheDocument()
  })

  it('renames Did Not Return while campers still can (#88)', () => {
    render(<RetentionOverview />)
    expect(screen.getByText('Not yet returned')).toBeInTheDocument()
    expect(screen.getByText('Still can; registration is open')).toBeInTheDocument()
    expect(screen.queryByText('Did Not Return')).not.toBeInTheDocument()
    expect(screen.queryByText(/attrition/)).not.toBeInTheDocument()
  })

  it('lists the basis note first and the gender note after it', () => {
    render(<RetentionOverview />)
    expect(
      screen.getByText(/of the 1,862 campers enrolled in 2025, 1,220 are already enrolled for 2026/)
    ).toBeInTheDocument()
  })

  it('pairs every breakdown with last year (#87)', () => {
    render(<RetentionOverview />)
    const grade = charts.get('Retention by Grade')!
    expect(grade.compare?.live).toBe(true)
    expect(grade.data.find((b) => b.name === '5')?.priorRate).toBe(0.642)
    // a renamed session pairs through its alias
    expect(charts.get('Retention by 2026 Session')!.data[0]!.priorRate).toBe(0.5)
    // First Summer Year pairs by summers in
    expect(charts.get('Retention by First Summer Year')!.data[0]!.priorRate).toBe(0.45)
    expect(charts.get('Retention by City (Top 15)')!.data[0]!.priorRate).toBe(0.5556)
    expect(charts.get('Retention by Region')!.data[0]!.priorRate).toBeCloseTo(25 / 45, 5)
    for (const title of [
      'Retention by 2025 Session',
      'Retention by Summers at Camp',
      'Retention by School (Top 15)',
      'Retention by Synagogue (Top 15)',
    ]) {
      // only charts with rows render; any that do carry the compare
      const chart = charts.get(title)
      if (chart) expect(chart.compare).toBeDefined()
    }
  })

  it('puts the gender change in the Retention by Gender table, muted on a small row', () => {
    render(<RetentionOverview />)
    const table = screen
      .getByRole('heading', { name: 'Retention by Gender' })
      .closest('.card-lodge') as HTMLElement
    expect(within(table).getByText(/Change/)).toBeInTheDocument()
    expect(within(table).getByText('▲ +3.0 pts')).toBeInTheDocument()
    // the table shows the base, so the count is not restated (#91)
    const small = within(table).getByText('+8.9 pts')
    expect(small.className).toMatch(/text-muted-foreground/)
    // the All row carries the headline change
    expect(within(table).getByText('▲ +1.9 pts')).toBeInTheDocument()
  })

  it('reads "updates tomorrow" on the priority date itself (ruling 9)', () => {
    prior = { ...priorLive, day_offset: 0, prior_day_offset: 1, as_of_date: '2024-11-13' }
    render(<RetentionOverview />)
    expect(
      within(card(/^Overall Retention Rate$/)).getByText('updates tomorrow')
    ).toBeInTheDocument()
    expect(screen.getByText(/opening day and the next day/)).toBeInTheDocument()
  })
})

describe('after registration (#85)', () => {
  beforeEach(() => {
    prior = priorFinal
  })

  it("says vs last year's final and reads final against final", () => {
    render(<RetentionOverview />)
    expect(screen.getByText("vs last year's final.")).toBeInTheDocument()
    expect(screen.getByText("Compared with 2025's final numbers.")).toBeInTheDocument()
    expect(
      within(card(/^Overall Retention Rate$/)).getByText('▲ +1.9 pts vs final')
    ).toBeInTheDocument()
    expect(screen.queryByText('Good')).not.toBeInTheDocument()
  })

  it('goes back to Did Not Return with its attrition', () => {
    render(<RetentionOverview />)
    expect(screen.getByText('Did Not Return')).toBeInTheDocument()
    expect(screen.getByText('34.5% attrition')).toBeInTheDocument()
    expect(screen.getByText('65.5% retention rate')).toBeInTheDocument()
    expect(screen.queryByText(/by this day/)).not.toBeInTheDocument()
  })
})

describe('while the comparison loads', () => {
  it('shows no chip at all, and never Good / Low', () => {
    prior = undefined
    render(<RetentionOverview />)
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument()
    expect(screen.queryByText('Good')).not.toBeInTheDocument()
    expect(charts.get('Retention by Grade')!.compare).toBeUndefined()
  })
})
