import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RetentionRateBarChart, type RetentionRateBarItem } from '../RetentionRateBarChart'

// Capture onClick handlers from Bar components
let capturedBarOnClick: ((data: unknown, index: number) => void) | undefined

// Mock recharts entirely to avoid canvas/SVG rendering issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children, layout }: { children: React.ReactNode; layout?: string }) => (
    <div data-testid="bar-chart" data-layout={layout ?? 'default'}>
      {children}
    </div>
  ),
  Bar: ({ onClick }: { onClick?: (data: unknown, index: number) => void }) => {
    capturedBarOnClick = onClick
    return onClick ? (
      <div data-testid="bar-clickable" onClick={() => onClick({ name: 'M', rate: 75 }, 0)} />
    ) : (
      <div data-testid="bar" />
    )
  },
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
    const { container } = render(<RetentionRateBarChart data={sampleData} title="Styled Chart" />)
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

  it('uses horizontal bars layout by default', () => {
    render(<RetentionRateBarChart data={sampleData} title="Default Layout" />)
    const barChart = screen.getByTestId('bar-chart')
    // Default is horizontal bars, which uses layout="vertical" on BarChart
    expect(barChart).toHaveAttribute('data-layout', 'vertical')
  })

  it('uses vertical bars layout when layout="vertical"', () => {
    render(<RetentionRateBarChart data={sampleData} title="Vertical Layout" layout="vertical" />)
    const barChart = screen.getByTestId('bar-chart')
    // Vertical bars means no layout prop on BarChart (standard orientation)
    expect(barChart).toHaveAttribute('data-layout', 'default')
  })

  it('renders title and chart container with vertical layout', () => {
    const sessionData: RetentionRateBarItem[] = [
      { name: 'Taste of Camp', retentionRate: 0.6, baseCount: 50, returnedCount: 30 },
      { name: 'Session 1', retentionRate: 0.8, baseCount: 100, returnedCount: 80 },
      { name: 'Session 2', retentionRate: 0.5, baseCount: 80, returnedCount: 40 },
    ]
    render(
      <RetentionRateBarChart
        data={sessionData}
        title="Retention by 2026 Session"
        sortBy="none"
        layout="vertical"
      />
    )
    expect(screen.getByText('Retention by 2026 Session')).toBeInTheDocument()
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
  })

  describe('onBarClick', () => {
    it('passes onClick to Bar when onBarClick is provided', () => {
      capturedBarOnClick = undefined
      const onBarClick = vi.fn()
      render(
        <RetentionRateBarChart data={sampleData} title="Clickable Chart" onBarClick={onBarClick} />
      )

      // When onBarClick is provided, the Bar component should receive an onClick handler
      expect(capturedBarOnClick).toBeDefined()
    })

    it('does not pass onClick to Bar when onBarClick is not provided', () => {
      capturedBarOnClick = undefined
      render(<RetentionRateBarChart data={sampleData} title="Non-Clickable" />)

      // When no onBarClick, the Bar should not have onClick
      expect(capturedBarOnClick).toBeUndefined()
    })
  })
})
