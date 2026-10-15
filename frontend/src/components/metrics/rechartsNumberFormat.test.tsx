/**
 * Decision 43 (#3207): the tooltips and labels Recharts draws use the shared number format.
 * Recharts paints nothing in jsdom, so these stand in for the two props that carry numbers: the
 * tooltip content and the label formatter.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

import { WaitlistGenderChart } from './WaitlistGenderChart'
import { CancellationGenderChart } from './CancellationGenderChart'
import { TrendLineChart } from './TrendLineChart'
import type { YearMetrics } from '../../types/metrics'

let tooltipPayload: unknown[] = []

vi.mock('recharts', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: passthrough,
    PieChart: passthrough,
    LineChart: passthrough,
    Line: passthrough,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    LabelList: () => null,
    Tooltip: ({ content }: { content: ReactElement }) =>
      cloneElement(content as ReactElement<Record<string, unknown>>, {
        active: true,
        payload: tooltipPayload,
        label: '2026',
      }),
  }
})

const gender = [
  { gender: 'M', count: 1293, percentage: 64.65 },
  { gender: 'F', count: 707, percentage: 35.35 },
]

describe('gender donut tooltips', () => {
  it.each([
    ['WaitlistGenderChart', WaitlistGenderChart],
    ['CancellationGenderChart', CancellationGenderChart],
  ])('%s writes the count with a separator and the share to one decimal', (_n, Chart) => {
    tooltipPayload = [{ value: 1000, payload: { name: 'M - Some', value: 1000, gender: 'M' } }]
    render(<Chart data={gender} />)
    expect(screen.getByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
  })
})

function year(overrides: Partial<YearMetrics>): YearMetrics {
  return {
    year: 2026,
    total_enrolled: 1293,
    by_gender: [],
    new_vs_returning: {
      new_count: 0,
      returning_count: 0,
      new_percentage: 0,
      returning_percentage: 0,
    },
    ...overrides,
  }
}

describe('TrendLineChart tooltip', () => {
  it('separates a count', () => {
    tooltipPayload = [{ name: 'Total Enrolled', value: 1293, color: 'red' }]
    render(<TrendLineChart data={[year({})]} title="Total" metric="total" />)
    expect(screen.getByText('1,293')).toBeInTheDocument()
  })

  it('writes a cancellation rate as a one-decimal percentage', () => {
    tooltipPayload = [{ name: 'Cancellation Rate', value: 5.2345, color: 'red' }]
    render(
      <TrendLineChart
        data={[year({ cancellation_rate: 5.2345 })]}
        title="Rate"
        metric="cancellation_rate"
      />
    )
    expect(screen.getByText('5.2%')).toBeInTheDocument()
  })
})
