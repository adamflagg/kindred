import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { BreakdownChart } from './BreakdownChart'

// Recharts draws nothing in jsdom, so stand in for the two props that carry numbers: the pie
// label renderer and the tooltip content.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Pie: ({
    data,
    label,
  }: {
    data: Array<Record<string, unknown>>
    label: (props: Record<string, unknown>) => React.ReactNode
  }) => (
    <svg>
      {data.map((d) => (
        <g key={String(d['name'])} data-testid={`label-${String(d['name'])}`}>
          {label({
            payload: d,
            name: d['name'],
            midAngle: 0,
            outerRadius: 80,
            cx: 0,
            cy: 0,
          })}
        </g>
      ))}
    </svg>
  ),
  Tooltip: ({ content }: { content: ReactElement }) =>
    cloneElement(content as ReactElement<Record<string, unknown>>, {
      active: true,
      payload: [{ payload: { name: 'Girls', value: 1293, percentage: 67.94 } }],
    }),
}))

const data = [
  { name: 'Girls', value: 1293, percentage: 67.94 },
  { name: 'Boys', value: 12, percentage: 32.06 },
]

describe('BreakdownChart number format', () => {
  it('labels a slice with a separated count and a one-decimal percentage', () => {
    render(<BreakdownChart data={data} title="Gender" showPercentage />)
    expect(screen.getByTestId('label-Girls')).toHaveTextContent('Girls: 1,293 (67.9%)')
    expect(screen.getByTestId('label-Boys')).toHaveTextContent('Boys: 12 (32.1%)')
  })

  it('labels a slice with a separated count when no percentage is shown', () => {
    render(<BreakdownChart data={data} title="Gender" />)
    expect(screen.getByTestId('label-Girls')).toHaveTextContent('Girls: 1,293')
  })

  it('writes the tooltip count with a separator and the percentage to one decimal', () => {
    render(<BreakdownChart data={data} title="Gender" />)
    expect(screen.getByText('1,293')).toBeInTheDocument()
    expect(screen.getByText('67.9%')).toBeInTheDocument()
  })
})

describe('BreakdownChart footer (#2898)', () => {
  it('renders the footer under the chart', () => {
    render(
      <BreakdownChart
        data={[{ name: 'Girl/woman', value: 3, percentage: 100 }]}
        title="2018 Gender"
        footer={<p>a note line</p>}
      />
    )
    expect(screen.getByText('a note line')).toBeInTheDocument()
  })
})
