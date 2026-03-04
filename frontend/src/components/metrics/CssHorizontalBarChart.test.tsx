import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const sampleData = [
  { name: 'Alpha', value: 40 },
  { name: 'Beta', value: 70 },
  { name: 'Gamma', value: 100 },
]

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
describe('CssHorizontalBarChart exports', () => {
  it('should export CssHorizontalBarChart as a named function', async () => {
    const mod = await import('./CssHorizontalBarChart')
    expect(typeof mod.CssHorizontalBarChart).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------
describe('CssHorizontalBarChart rendering', () => {
  let CssHorizontalBarChart: typeof import('./CssHorizontalBarChart').CssHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssHorizontalBarChart')
    CssHorizontalBarChart = mod.CssHorizontalBarChart
  })

  it('should render the title when provided', () => {
    render(<CssHorizontalBarChart data={sampleData} title="Test Chart" />)
    expect(screen.getByText('Test Chart')).toBeInTheDocument()
  })

  it('should render without a title when not provided', () => {
    const { container } = render(<CssHorizontalBarChart data={sampleData} />)
    expect(container.querySelectorAll('h3').length).toBe(0)
  })

  it('should render one row per data item', () => {
    render(<CssHorizontalBarChart data={sampleData} title="Rows" />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('should display value labels in the value column', () => {
    const { container } = render(<CssHorizontalBarChart data={sampleData} title="Values" />)
    // Value labels are in the tabular-nums spans at the end of each row
    const valueSpans = container.querySelectorAll('.tabular-nums')
    const values = Array.from(valueSpans).map((el) => el.textContent?.trim())
    expect(values).toContain('40')
    expect(values).toContain('70')
    expect(values).toContain('100')
  })

  it('should show empty state when data is empty', () => {
    render(<CssHorizontalBarChart data={[]} title="Empty" />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <CssHorizontalBarChart data={sampleData} className="extra" />
    )
    expect(container.querySelector('.extra')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Bar sizing
// ---------------------------------------------------------------------------
describe('CssHorizontalBarChart bar sizing', () => {
  let CssHorizontalBarChart: typeof import('./CssHorizontalBarChart').CssHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssHorizontalBarChart')
    CssHorizontalBarChart = mod.CssHorizontalBarChart
  })

  it('should scale bar widths relative to max value', () => {
    const data = [
      { name: 'Half', value: 50 },
      { name: 'Full', value: 100 },
    ]
    const { container } = render(<CssHorizontalBarChart data={data} title="Scale" />)
    const fills = container.querySelectorAll('.rounded.transition-all') as NodeListOf<HTMLElement>
    // The "Full" bar should be wider than the "Half" bar
    const halfWidth = parseFloat(fills[0]?.style.width || '0')
    const fullWidth = parseFloat(fills[1]?.style.width || '0')
    expect(fullWidth).toBeGreaterThan(halfWidth)
  })

  it('should use custom label and value widths', () => {
    const { container } = render(
      <CssHorizontalBarChart data={sampleData} labelWidth={120} valueWidth={60} />
    )
    const labels = container.querySelectorAll('.truncate') as NodeListOf<HTMLElement>
    expect(labels[0]?.style.width).toBe('120px')
  })
})

// ---------------------------------------------------------------------------
// Click handler
// ---------------------------------------------------------------------------
describe('CssHorizontalBarChart click', () => {
  let CssHorizontalBarChart: typeof import('./CssHorizontalBarChart').CssHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssHorizontalBarChart')
    CssHorizontalBarChart = mod.CssHorizontalBarChart
  })

  it('should call onBarClick with drilldown filter when both onBarClick and breakdownType are set', () => {
    const onClick = vi.fn()
    const data = [{ name: 'Test City', value: 50, id: 'city-1' }]
    const { container } = render(
      <CssHorizontalBarChart
        data={data}
        title="Click"
        breakdownType="city"
        onBarClick={onClick}
      />
    )
    const row = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
    expect(onClick.mock.calls[0]![0]).toMatchObject({
      type: 'city',
      value: 'city-1',
      label: 'Test City',
    })
  })

  it('should not be clickable when onBarClick is missing', () => {
    const { container } = render(
      <CssHorizontalBarChart data={sampleData} breakdownType="city" />
    )
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })

  it('should not be clickable when breakdownType is missing', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssHorizontalBarChart data={sampleData} onBarClick={onClick} />
    )
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })

  it('should use item.name as value when item.id is undefined', () => {
    const onClick = vi.fn()
    const data = [{ name: 'No Id', value: 30 }]
    const { container } = render(
      <CssHorizontalBarChart data={data} breakdownType="school" onBarClick={onClick} />
    )
    fireEvent.click(container.querySelector('.cursor-pointer')!)
    expect(onClick.mock.calls[0]![0]).toMatchObject({
      type: 'school',
      value: 'No Id',
    })
  })
})

// ---------------------------------------------------------------------------
// X-axis ticks
// ---------------------------------------------------------------------------
describe('CssHorizontalBarChart x-axis', () => {
  let CssHorizontalBarChart: typeof import('./CssHorizontalBarChart').CssHorizontalBarChart

  beforeAll(async () => {
    const mod = await import('./CssHorizontalBarChart')
    CssHorizontalBarChart = mod.CssHorizontalBarChart
  })

  it('should render x-axis tick labels', () => {
    render(<CssHorizontalBarChart data={sampleData} title="Axis" />)
    // getNiceTicks(100) should include 0
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
