import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendLineChart } from './TrendLineChart'
import { computeCoverageBands } from './cssChartUtils'
import type { YearMetrics } from '../../types/metrics'

let capturedStrokeLinecaps: string[] = []

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ strokeLinecap }: { strokeLinecap?: string }) => {
    if (strokeLinecap) capturedStrokeLinecaps.push(strokeLinecap)
    return <div data-testid="line" />
  },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  LabelList: () => null,
}))

const sampleData: YearMetrics[] = [
  {
    year: 2024,
    total_enrolled: 100,
    by_gender: [
      { gender: 'M', count: 50, percentage: 50 },
      { gender: 'F', count: 50, percentage: 50 },
    ],
    new_vs_returning: {
      new_count: 40,
      returning_count: 60,
      new_percentage: 40,
      returning_percentage: 60,
    },
    total_cancelled: 5,
    cancellation_rate: 5.0,
  },
  {
    year: 2025,
    total_enrolled: 120,
    by_gender: [
      { gender: 'M', count: 60, percentage: 50 },
      { gender: 'F', count: 60, percentage: 50 },
    ],
    new_vs_returning: {
      new_count: 50,
      returning_count: 70,
      new_percentage: 41.7,
      returning_percentage: 58.3,
    },
    total_cancelled: 8,
    cancellation_rate: 6.7,
  },
]

describe('TrendLineChart', () => {
  it('renders the title', () => {
    render(<TrendLineChart data={sampleData} title="Enrollment Trends" metric="total" />)
    expect(screen.getByText('Enrollment Trends')).toBeInTheDocument()
  })

  describe('animation', () => {
    beforeEach(() => {
      capturedStrokeLinecaps = []
    })

    it.each(['total', 'gender', 'new_vs_returning', 'cancellation_rate'] as const)(
      'passes strokeLinecap="round" to Line for %s metric',
      (metric) => {
        render(<TrendLineChart data={sampleData} title="Test" metric={metric} />)
        expect(capturedStrokeLinecaps.length).toBeGreaterThan(0)
        expect(capturedStrokeLinecaps.every((v) => v === 'round')).toBe(true)
      }
    )
  })
})

// ============================================================================
// #2443 — no-coverage years render a greyed band, not a fabricated zero.
//
// The x-axis is a categorical `point` scale with zero bandwidth (recharts
// ^3.10.1, combineRealScaleType for type:'category' inside LineChart), so a
// ReferenceArea drawn against it lands tick-to-tick, not slot-to-slot, and
// this chart's visible axis is drawn in the DOM by ChartCard, not by
// recharts -- see the issue body's build-risk analysis. This ships the
// named DOM-layer fallback instead: a band positioned by the SAME
// edge-aligned percentage math VerticalXAxis uses for the year labels
// (cssChartUtils.ts, edgeAligned branch: left = i/(n-1)*100%, with the
// same rightPadding reduction), so alignment is correct by construction
// rather than asserted from the SVG scale.
// ============================================================================

describe('computeCoverageBands', () => {
  it('returns no bands when every year has coverage', () => {
    expect(computeCoverageBands([true, true, true])).toEqual([])
  })

  it('returns no bands for fewer than 2 points', () => {
    expect(computeCoverageBands([false])).toEqual([])
    expect(computeCoverageBands([])).toEqual([])
  })

  it('covers a leading run of uncovered years, stopping halfway to the first covered year', () => {
    // 5 years, 2022-2025 uncovered (indices 0-3), 2026 covered (index 4).
    const bands = computeCoverageBands([false, false, false, false, true])
    expect(bands).toHaveLength(1)
    expect(bands[0]!.leftPct).toBeCloseTo(0, 5)
    // rightIndex = 3 + 0.5 = 3.5 of 4 -> 87.5%
    expect(bands[0]!.widthPct).toBeCloseTo(87.5, 5)
  })

  it('covers a trailing run of uncovered years', () => {
    const bands = computeCoverageBands([true, true, false, false])
    expect(bands).toHaveLength(1)
    // leftIndex = 2 - 0.5 = 1.5 of 3 -> 50%
    expect(bands[0]!.leftPct).toBeCloseTo(50, 5)
    // rightIndex = min(3, 3.5) = 3 -> 100%; width = 100-50 = 50
    expect(bands[0]!.widthPct).toBeCloseTo(50, 5)
  })

  it('covers a middle run bounded by coverage on both sides', () => {
    const bands = computeCoverageBands([true, false, false, true, true])
    expect(bands).toHaveLength(1)
    // leftIndex = 1-0.5=0.5 of 4 -> 12.5%; rightIndex = 2+0.5=2.5 of 4 -> 62.5%
    expect(bands[0]!.leftPct).toBeCloseTo(12.5, 5)
    expect(bands[0]!.widthPct).toBeCloseTo(50, 5)
  })

  it('returns one band per contiguous uncovered run', () => {
    const bands = computeCoverageBands([false, true, false, true])
    expect(bands).toHaveLength(2)
  })
})

describe('TrendLineChart — coverage band rendering (#2443)', () => {
  const coverageData: YearMetrics[] = [
    {
      year: 2022,
      total_enrolled: 0,
      by_gender: [],
      new_vs_returning: {
        new_count: 0,
        returning_count: 0,
        new_percentage: 0,
        returning_percentage: 0,
      },
      total_cancelled: 0,
      cancellation_rate: 0,
      has_cancellation_data: false,
    },
    {
      year: 2026,
      total_enrolled: 100,
      by_gender: [],
      new_vs_returning: {
        new_count: 40,
        returning_count: 60,
        new_percentage: 40,
        returning_percentage: 60,
      },
      total_cancelled: 276,
      cancellation_rate: 43.9,
      has_cancellation_data: true,
    },
  ]

  it('renders a coverage band for the cancellation_rate metric when a year lacks data', () => {
    render(
      <TrendLineChart data={coverageData} title="Cancellation Rate" metric="cancellation_rate" />
    )
    expect(screen.getAllByTestId('coverage-band').length).toBeGreaterThan(0)
  })

  it('renders no coverage band when every year has data', () => {
    const covered = coverageData.map((y) => ({ ...y, has_cancellation_data: true }))
    render(<TrendLineChart data={covered} title="Cancellation Rate" metric="cancellation_rate" />)
    expect(screen.queryByTestId('coverage-band')).not.toBeInTheDocument()
  })

  it('renders no coverage band for metrics other than cancellation_rate', () => {
    // total_enrolled has no coverage concept -- the band is scoped to cancellation data only.
    render(<TrendLineChart data={coverageData} title="Total Enrolled" metric="total" />)
    expect(screen.queryByTestId('coverage-band')).not.toBeInTheDocument()
  })
})
