import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { StackedSegment, StackedBarDataItem } from './CssStackedHorizontalBarChart'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const segments: StackedSegment[] = [
  { key: 'enrolled', label: 'Enrolled', color: '#4CAF50' },
  { key: 'waitlisted', label: 'Waitlisted', color: '#FFC107' },
]

const sampleData: StackedBarDataItem[] = [
  { name: 'Session A', total: 80, enrolled: 60, waitlisted: 20 },
  { name: 'Session B', total: 50, enrolled: 30, waitlisted: 20 },
  { name: 'Session C', total: 120, enrolled: 100, waitlisted: 20 },
]

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
describe('CssStackedHorizontalBarChart exports', () => {
  it('should export CssStackedHorizontalBarChart as a named function', async () => {
    const mod = await import('./CssStackedHorizontalBarChart')
    expect(typeof mod.CssStackedHorizontalBarChart).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------
describe('CssStackedHorizontalBarChart rendering', () => {
  let CssStackedHorizontalBarChart: typeof import('./CssStackedHorizontalBarChart').CssStackedHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssStackedHorizontalBarChart')
    CssStackedHorizontalBarChart = mod.CssStackedHorizontalBarChart
  })

  it('should render the title when provided', () => {
    render(
      <CssStackedHorizontalBarChart data={sampleData} segments={segments} title="Stacked Test" />
    )
    expect(screen.getByText('Stacked Test')).toBeInTheDocument()
  })

  it('should render without a title when not provided', () => {
    const { container } = render(
      <CssStackedHorizontalBarChart data={sampleData} segments={segments} />
    )
    expect(container.querySelectorAll('h3').length).toBe(0)
  })

  it('should render one row per data item', () => {
    render(<CssStackedHorizontalBarChart data={sampleData} segments={segments} title="Rows" />)
    expect(screen.getByText('Session A')).toBeInTheDocument()
    expect(screen.getByText('Session B')).toBeInTheDocument()
    expect(screen.getByText('Session C')).toBeInTheDocument()
  })

  it('should display total labels', () => {
    const { container } = render(
      <CssStackedHorizontalBarChart data={sampleData} segments={segments} title="Totals" />
    )
    const valueSpans = container.querySelectorAll('.tabular-nums')
    const values = Array.from(valueSpans).map((el) => el.textContent?.trim())
    expect(values).toContain('80')
    expect(values).toContain('50')
    expect(values).toContain('120')
  })

  it('should show empty state when data is empty', () => {
    render(<CssStackedHorizontalBarChart data={[]} segments={segments} title="Empty" />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <CssStackedHorizontalBarChart data={sampleData} segments={segments} className="custom" />
    )
    expect(container.querySelector('.custom')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
describe('CssStackedHorizontalBarChart legend', () => {
  let CssStackedHorizontalBarChart: typeof import('./CssStackedHorizontalBarChart').CssStackedHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssStackedHorizontalBarChart')
    CssStackedHorizontalBarChart = mod.CssStackedHorizontalBarChart
  })

  it('should render legend items for active segments only', () => {
    render(<CssStackedHorizontalBarChart data={sampleData} segments={segments} />)
    expect(screen.getByText('Enrolled')).toBeInTheDocument()
    expect(screen.getByText('Waitlisted')).toBeInTheDocument()
  })

  it('should omit legend items for segments with zero values across all data', () => {
    const dataNoWaitlist: StackedBarDataItem[] = [
      { name: 'A', total: 10, enrolled: 10, waitlisted: 0 },
    ]
    render(<CssStackedHorizontalBarChart data={dataNoWaitlist} segments={segments} />)
    expect(screen.getByText('Enrolled')).toBeInTheDocument()
    expect(screen.queryByText('Waitlisted')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------------------
describe('CssStackedHorizontalBarChart click', () => {
  let CssStackedHorizontalBarChart: typeof import('./CssStackedHorizontalBarChart').CssStackedHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssStackedHorizontalBarChart')
    CssStackedHorizontalBarChart = mod.CssStackedHorizontalBarChart
  })

  it('should call onBarClick with the data item', () => {
    const onClick = vi.fn()
    const data: StackedBarDataItem[] = [
      { name: 'Click Me', total: 40, enrolled: 30, waitlisted: 10 },
    ]
    const { container } = render(
      <CssStackedHorizontalBarChart data={data} segments={segments} onBarClick={onClick} />
    )
    const row = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
    expect(onClick.mock.calls[0]![0]).toMatchObject({
      name: 'Click Me',
      total: 40,
    })
  })

  it('should not be clickable when onBarClick is not provided', () => {
    const { container } = render(
      <CssStackedHorizontalBarChart data={sampleData} segments={segments} />
    )
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Stacked segment rendering
// ---------------------------------------------------------------------------
describe('CssStackedHorizontalBarChart segments', () => {
  let CssStackedHorizontalBarChart: typeof import('./CssStackedHorizontalBarChart').CssStackedHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssStackedHorizontalBarChart')
    CssStackedHorizontalBarChart = mod.CssStackedHorizontalBarChart
  })

  it('should render colored segment divs within each bar', () => {
    const data: StackedBarDataItem[] = [{ name: 'Mixed', total: 100, enrolled: 70, waitlisted: 30 }]
    const { container } = render(<CssStackedHorizontalBarChart data={data} segments={segments} />)
    const segDivs = container.querySelectorAll(
      '[style*="background-color"]'
    ) as NodeListOf<HTMLElement>
    // Should have at least the 2 segment divs (enrolled + waitlisted) + legend swatches
    const barSegments = Array.from(segDivs).filter((el) => el.classList.contains('h-full'))
    expect(barSegments.length).toBe(2)
  })

  it('should not render segment divs for zero-value segments', () => {
    const data: StackedBarDataItem[] = [
      { name: 'Only Enrolled', total: 50, enrolled: 50, waitlisted: 0 },
    ]
    const { container } = render(<CssStackedHorizontalBarChart data={data} segments={segments} />)
    const barSegments = Array.from(
      container.querySelectorAll('[style*="background-color"]') as NodeListOf<HTMLElement>
    ).filter((el) => el.classList.contains('h-full'))
    expect(barSegments.length).toBe(1)
  })
})
