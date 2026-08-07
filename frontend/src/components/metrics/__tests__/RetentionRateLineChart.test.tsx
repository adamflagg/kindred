import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RetentionRateLineChart } from '../RetentionRateLineChart'
import type { RetentionRateBarItem } from '../../../types/metrics'

// Capture activeDot click handler
let capturedActiveDotClick: ((props: unknown) => void) | undefined
let capturedStrokeLinecap: string | undefined

// Mock recharts to avoid canvas/SVG rendering in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({
    activeDot,
    strokeLinecap,
  }: {
    activeDot?: { onClick?: (props: unknown) => void }
    strokeLinecap?: string
  }) => {
    capturedActiveDotClick = activeDot?.onClick
    capturedStrokeLinecap = strokeLinecap
    return activeDot?.onClick ? (
      // Real <button> stand-in for recharts' clickable dot — not a <div>
      // with a bolted-on onClick, per house style.
      <button
        type="button"
        data-testid="line-dot-clickable"
        onClick={() =>
          activeDot.onClick!({
            payload: { name: 'Grade 5', rate: 75, baseCount: 80, returnedCount: 60 },
          })
        }
      />
    ) : (
      <div data-testid="line-dot" />
    )
  },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  LabelList: () => null,
}))

const sampleData: RetentionRateBarItem[] = [
  { name: 'Grade 5', retentionRate: 0.75, baseCount: 80, returnedCount: 60 },
  { name: 'Grade 3', retentionRate: 0.65, baseCount: 100, returnedCount: 65 },
  { name: 'Grade 8', retentionRate: 0.55, baseCount: 60, returnedCount: 33 },
  { name: 'Grade 12', retentionRate: 0.4, baseCount: 40, returnedCount: 16 },
]

describe('RetentionRateLineChart', () => {
  beforeEach(() => {
    capturedActiveDotClick = undefined
    capturedStrokeLinecap = undefined
  })

  it('renders the title', () => {
    render(<RetentionRateLineChart data={sampleData} title="Retention by Grade" />)
    expect(screen.getByText('Retention by Grade')).toBeInTheDocument()
  })

  it('renders empty state when data is empty', () => {
    render(<RetentionRateLineChart data={[]} title="Empty Chart" />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('renders a line chart (not bar chart) when data is provided', () => {
    render(<RetentionRateLineChart data={sampleData} title="Test Chart" />)
    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument()
  })

  it('wraps in card-lodge styling', () => {
    const { container } = render(<RetentionRateLineChart data={sampleData} title="Styled Chart" />)
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('renders responsive container', () => {
    render(<RetentionRateLineChart data={sampleData} title="Responsive" />)
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
  })

  describe('onDotClick', () => {
    it('passes activeDot onClick to Line when onDotClick is provided', () => {
      const onDotClick = vi.fn()
      render(
        <RetentionRateLineChart data={sampleData} title="Clickable Line" onDotClick={onDotClick} />
      )

      // When onDotClick is provided, the Line should have activeDot.onClick
      expect(capturedActiveDotClick).toBeDefined()
    })

    it('does not set activeDot click handler when onDotClick is not provided', () => {
      render(<RetentionRateLineChart data={sampleData} title="Non-Clickable" />)

      // When no onDotClick, the Line should not have activeDot.onClick
      expect(capturedActiveDotClick).toBeUndefined()
    })
  })

  describe('animation', () => {
    it('passes strokeLinecap="round" to Line for flicker prevention', () => {
      render(<RetentionRateLineChart data={sampleData} title="Animation Test" />)
      expect(capturedStrokeLinecap).toBe('round')
    })
  })
})
