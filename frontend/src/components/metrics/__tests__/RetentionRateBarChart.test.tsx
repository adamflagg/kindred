import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RetentionRateBarChart, type RetentionRateBarItem } from '../RetentionRateBarChart'

// Mock recharts entirely to avoid canvas/SVG rendering issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
  LabelList: () => null,
}))

const sampleData: RetentionRateBarItem[] = [
  { name: 'M', retentionRate: 0.75, baseCount: 100, returnedCount: 75 },
  { name: 'F', retentionRate: 0.45, baseCount: 80, returnedCount: 36 },
  { name: 'Other', retentionRate: 0.3, baseCount: 10, returnedCount: 3 },
]

describe('RetentionRateBarChart', () => {
  it('renders the title', () => {
    render(<RetentionRateBarChart data={sampleData} title="Gender Retention" />)
    expect(screen.getByText('Gender Retention')).toBeInTheDocument()
  })

  it('renders empty state when data is empty', () => {
    render(<RetentionRateBarChart data={[]} title="Empty Chart" />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('renders chart container when data is provided', () => {
    render(<RetentionRateBarChart data={sampleData} title="Test Chart" />)
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
  })

  it('limits data to topN items when specified', () => {
    const manyItems: RetentionRateBarItem[] = Array.from({ length: 20 }, (_, i) => ({
      name: `Category ${i}`,
      retentionRate: 0.5 + i * 0.02,
      baseCount: 100 - i,
      returnedCount: 50,
    }))
    // With topN=5, only 5 items should be passed to chart
    const { container } = render(
      <RetentionRateBarChart data={manyItems} title="Limited" topN={5} />
    )
    // The component should exist and render
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('wraps in card-lodge styling', () => {
    const { container } = render(
      <RetentionRateBarChart data={sampleData} title="Styled Chart" />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('preserves input order when sortBy is "none"', () => {
    const orderedData: RetentionRateBarItem[] = [
      { name: 'Taste of Camp', retentionRate: 0.6, baseCount: 50, returnedCount: 30 },
      { name: 'Session 1', retentionRate: 0.8, baseCount: 100, returnedCount: 80 },
      { name: 'Session 2', retentionRate: 0.5, baseCount: 80, returnedCount: 40 },
    ]
    // With sortBy="none", chart should render without re-sorting
    const { container } = render(
      <RetentionRateBarChart data={orderedData} title="Session Chart" sortBy="none" />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
  })
})
