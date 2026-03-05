/**
 * TDD Tests for CssVerticalBarChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * Generic single-bar-per-column CSS chart.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import type { CssVerticalBarItem } from './CssVerticalBarChart'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const sampleData: CssVerticalBarItem[] = [
  { name: 'Alpha', value: 40 },
  { name: 'Beta', value: 70 },
  { name: 'Gamma', value: 100 },
]

const singleItem: CssVerticalBarItem[] = [{ name: 'Solo', value: 50 }]

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart exports', () => {
  it('should export CssVerticalBarChart as a named function', async () => {
    const mod = await import('./CssVerticalBarChart')
    expect(typeof mod.CssVerticalBarChart).toBe('function')
  })

  it('should export the CssVerticalBarItem type (compile-time check)', () => {
    // If this file compiles, the type export works.
    const item: CssVerticalBarItem = { name: 'Test', value: 42 }
    expect(item.name).toBe('Test')
  })
})

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart rendering', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should render the title when provided', () => {
    render(<CssVerticalBarChart data={sampleData} title="My Chart" />)
    expect(screen.getByText('My Chart')).toBeInTheDocument()
  })

  it('should render without a title when not provided', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} />)
    const headings = container.querySelectorAll<HTMLElement>('h3')
    expect(headings.length).toBe(0)
  })

  it('should wrap in card-lodge class', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} />)
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} className="my-custom" />)
    expect(container.querySelector('.my-custom')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart empty state', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should show "No data available" when data is empty', () => {
    render(<CssVerticalBarChart data={[]} />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should still wrap in card-lodge when empty', () => {
    const { container } = render(<CssVerticalBarChart data={[]} />)
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Bar rendering
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart bar rendering', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should render one column per data item', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} />)
    // Each column is a flex-col child of the bars area
    const bars = container.querySelectorAll<HTMLElement>('.flex-col.items-center')
    expect(bars.length).toBe(sampleData.length)
  })

  it('should render bars with rounded-t class', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} />)
    const roundedBars = container.querySelectorAll<HTMLElement>('.rounded-t')
    expect(roundedBars.length).toBe(sampleData.length)
  })

  it('should render bars with transition-all duration-300', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} />)
    const transitionBars = container.querySelectorAll<HTMLElement>('.transition-all.duration-300')
    expect(transitionBars.length).toBe(sampleData.length)
  })

  it('should apply default blue color when no colorFn provided', () => {
    const { container } = render(<CssVerticalBarChart data={singleItem} />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    // jsdom converts hsl(200, 70%, 50%) to rgb(38, 157, 217)
    expect(bar.style.backgroundColor).toBe('rgb(38, 157, 217)')
  })

  it('should apply custom color from colorFn', () => {
    const colorFn = (item: CssVerticalBarItem) => (item.value > 50 ? 'red' : 'green')
    const { container } = render(<CssVerticalBarChart data={sampleData} colorFn={colorFn} />)
    const bars = container.querySelectorAll<HTMLElement>('.rounded-t')
    // Alpha: 40 => green, Beta: 70 => red, Gamma: 100 => red
    expect(bars[0]!.style.backgroundColor).toBe('green')
    expect(bars[1]!.style.backgroundColor).toBe('red')
    expect(bars[2]!.style.backgroundColor).toBe('red')
  })

  it('should set minHeight 4px for non-zero values', () => {
    const { container } = render(<CssVerticalBarChart data={singleItem} />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    expect(bar.style.minHeight).toBe('4px')
  })

  it('should set minHeight 0px for zero-value items', () => {
    const zeroData: CssVerticalBarItem[] = [{ name: 'Zero', value: 0 }]
    const { container } = render(<CssVerticalBarChart data={zeroData} />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    expect(bar.style.minHeight).toBe('0px')
  })
})

// ---------------------------------------------------------------------------
// Y-axis
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart Y-axis', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should use fixed yAxisTicks when provided', () => {
    render(
      <CssVerticalBarChart
        data={sampleData}
        yAxisTicks={[0, 25, 50, 75, 100]}
        yAxisFormat={(t) => `${t}%`}
      />
    )
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('should auto-compute ticks via getNiceTicks when yAxisTicks not provided', () => {
    // Data max is 100, so getNiceTicks(100) should produce ticks including 0
    render(<CssVerticalBarChart data={sampleData} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should use default yAxisWidth w-8', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} />)
    const yAxis = container.querySelector('.w-8')
    expect(yAxis).toBeInTheDocument()
  })

  it('should use custom yAxisWidth when provided', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} yAxisWidth="w-10" />)
    const yAxis = container.querySelector('.w-10')
    expect(yAxis).toBeInTheDocument()
  })

  it('should use yAxisMax when provided to scale bars', () => {
    // With yAxisMax=200, a value of 100 should be at half the drawing height
    render(
      <CssVerticalBarChart
        data={[{ name: 'A', value: 100 }]}
        yAxisMax={200}
        yAxisTicks={[0, 100, 200]}
      />
    )
    expect(screen.getByText('200')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// X-axis labels
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart X-axis', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should render X-axis labels from data names', () => {
    render(<CssVerticalBarChart data={sampleData} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('should rotate labels when rotateLabels is true', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} rotateLabels />)
    // Rotated mode sets height: 72px on the x-axis container
    const xAxisWrapper = container.querySelector('[style*="height: 72px"]')
    expect(xAxisWrapper).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Labels above bars
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart label format', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should show value as default label above each bar', () => {
    // Use a value unlikely to appear in auto-computed Y-axis ticks
    const data: CssVerticalBarItem[] = [{ name: 'Item', value: 37 }]
    render(<CssVerticalBarChart data={data} />)
    // Default label: String(value)
    expect(screen.getByText('37')).toBeInTheDocument()
  })

  it('should use custom labelFormat when provided', () => {
    render(<CssVerticalBarChart data={singleItem} labelFormat={(item) => `${item.value}%`} />)
    expect(screen.getByText('50%')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart tooltip', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should not render tooltip content initially', () => {
    render(
      <CssVerticalBarChart
        data={sampleData}
        renderTooltip={(item) => <span data-testid="tt">{item.name}</span>}
      />
    )
    expect(screen.queryByTestId('tt')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Click handling
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart click handling', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should add cursor-pointer class when onBarClick is provided', () => {
    const onClick = vi.fn()
    const { container } = render(<CssVerticalBarChart data={singleItem} onBarClick={onClick} />)
    const column = container.querySelector('.cursor-pointer')
    expect(column).toBeInTheDocument()
  })

  it('should not have cursor-pointer when onBarClick is not provided', () => {
    const { container } = render(<CssVerticalBarChart data={singleItem} />)
    const column = container.querySelector('.cursor-pointer')
    expect(column).toBeNull()
  })

  it('should call onBarClick with the correct item when a column is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(<CssVerticalBarChart data={singleItem} onBarClick={onClick} />)
    const column = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(column)
    expect(onClick).toHaveBeenCalledWith(singleItem[0])
  })
})

// ---------------------------------------------------------------------------
// Column sizing integration
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart column sizing', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should apply maxWidth to columns in sparse mode (<=4 items)', () => {
    const sparseData: CssVerticalBarItem[] = [
      { name: 'A', value: 10 },
      { name: 'B', value: 20 },
      { name: 'C', value: 15 },
    ]
    const { container } = render(<CssVerticalBarChart data={sparseData} />)
    // Scope to bars area (border-l) to exclude x-axis labels
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columns = barsArea.querySelectorAll<HTMLElement>(':scope > [style*="max-width: 120px"]')
    expect(columns.length).toBe(sparseData.length)
  })

  it('should have no flex gap in sparse mode (gap absorbed into column padding for contiguous hover)', () => {
    const sparseData: CssVerticalBarItem[] = [
      { name: 'A', value: 10 },
      { name: 'B', value: 20 },
    ]
    const { container } = render(<CssVerticalBarChart data={sparseData} />)
    const barsArea = container.querySelector('.border-l') as HTMLElement
    expect(barsArea.style.gap).toBe('')
  })

  it('should have no flex gap in normal mode (gap absorbed into column padding for contiguous hover)', () => {
    const normalData: CssVerticalBarItem[] = Array.from({ length: 6 }, (_, i) => ({
      name: `Item ${i}`,
      value: 10 + i,
    }))
    const { container } = render(<CssVerticalBarChart data={normalData} />)
    const barsArea = container.querySelector('.border-l') as HTMLElement
    expect(barsArea.style.gap).toBe('')
  })

  it('should have no flex gap in dense mode (gap absorbed into column padding for contiguous hover)', () => {
    const denseData: CssVerticalBarItem[] = Array.from({ length: 12 }, (_, i) => ({
      name: `D${i}`,
      value: 10 + i,
    }))
    const { container } = render(<CssVerticalBarChart data={denseData} />)
    const barsArea = container.querySelector('.border-l') as HTMLElement
    expect(barsArea.style.gap).toBe('')
  })

  it('should not apply maxWidth in normal mode (5-9 items)', () => {
    const normalData: CssVerticalBarItem[] = Array.from({ length: 6 }, (_, i) => ({
      name: `Item ${i}`,
      value: 10 + i,
    }))
    const { container } = render(<CssVerticalBarChart data={normalData} />)
    const columnsWithMaxWidth = container.querySelectorAll<HTMLElement>(
      '[style*="max-width: 120px"]'
    )
    expect(columnsWithMaxWidth.length).toBe(0)
  })

  it('should not render ColumnHoverOverlay in sparse mode', () => {
    const sparseData: CssVerticalBarItem[] = [
      { name: 'A', value: 10 },
      { name: 'B', value: 20 },
    ]
    const { container } = render(<CssVerticalBarChart data={sparseData} />)
    // ColumnHoverOverlay uses bg-foreground/[0.06] — should not be present in sparse
    const overlay = container.querySelector('.bg-foreground\\/\\[0\\.06\\]')
    expect(overlay).toBeNull()
  })

  it('should highlight column on hover in sparse mode', () => {
    const sparseData: CssVerticalBarItem[] = [
      { name: 'A', value: 10 },
      { name: 'B', value: 20 },
    ]
    const { container } = render(<CssVerticalBarChart data={sparseData} />)
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columns = barsArea.querySelectorAll(':scope > [style*="max-width"]')
    fireEvent.mouseEnter(columns[0]!)
    expect(columns[0]!.className).toContain('bg-foreground/[0.06]')
    expect(columns[1]!.className).not.toContain('bg-foreground/[0.06]')
  })
})

// ---------------------------------------------------------------------------
// Bar width percent
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart barWidthPercent', () => {
  let CssVerticalBarChart: typeof import('./CssVerticalBarChart').CssVerticalBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalBarChart')
    CssVerticalBarChart = mod.CssVerticalBarChart
  })

  it('should default to 100% width (w-full) when barWidthPercent is not provided', () => {
    const { container } = render(<CssVerticalBarChart data={singleItem} />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    expect(bar.classList.contains('w-full')).toBe(true)
    expect(bar.style.width).toBe('')
  })

  it('should set bar width style when barWidthPercent is provided', () => {
    const { container } = render(<CssVerticalBarChart data={singleItem} barWidthPercent={60} />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    expect(bar.style.width).toBe('60%')
    expect(bar.classList.contains('w-full')).toBe(false)
  })

  it('should center bars within column when barWidthPercent is set', () => {
    const { container } = render(<CssVerticalBarChart data={singleItem} barWidthPercent={70} />)
    // The column should still have items-center for horizontal centering
    const column = container.querySelector('.flex-col.items-center')
    expect(column).toBeInTheDocument()
  })

  it('should apply barWidthPercent to all bars', () => {
    const { container } = render(<CssVerticalBarChart data={sampleData} barWidthPercent={55} />)
    const bars = container.querySelectorAll<HTMLElement>('.rounded-t')
    expect(bars.length).toBe(sampleData.length)
    for (const bar of bars) {
      expect(bar.style.width).toBe('55%')
    }
  })
})

// ---------------------------------------------------------------------------
// Extra fields pass-through
// ---------------------------------------------------------------------------
describe('CssVerticalBarChart extra fields', () => {
  it('should allow extra fields on CssVerticalBarItem for tooltip access', () => {
    const dataWithExtras: CssVerticalBarItem[] = [
      { name: 'Test', value: 80, retentionRate: 0.8, baseCount: 100 },
    ]
    // Compile-time check: extra fields are allowed via index signature
    expect(dataWithExtras[0]!['retentionRate']).toBe(0.8)
    expect(dataWithExtras[0]!['baseCount']).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// CssVerticalRetentionBarChart as thin wrapper
// ---------------------------------------------------------------------------
describe('CssVerticalRetentionBarChart wrapper', () => {
  it('should still export CssVerticalRetentionBarChart', async () => {
    const mod = await import('./CssVerticalRetentionBarChart')
    expect(typeof mod.CssVerticalRetentionBarChart).toBe('function')
  })

  it('should render title for retention chart', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const retentionData = [
      { name: 'City A', retentionRate: 0.75, baseCount: 100, returnedCount: 75 },
      { name: 'City B', retentionRate: 0.45, baseCount: 80, returnedCount: 36 },
    ]
    render(<CssVerticalRetentionBarChart data={retentionData} title="Retention Test" />)
    expect(screen.getByText('Retention Test')).toBeInTheDocument()
  })

  it('should render empty state for retention chart', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    render(<CssVerticalRetentionBarChart data={[]} title="Empty Retention" />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should apply green color for high retention rates', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'High', retentionRate: 0.8, baseCount: 100, returnedCount: 80 }]
    const { container } = render(<CssVerticalRetentionBarChart data={data} title="Colors" />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    // Green hsl(160, 100%, 35%) -> rgb(0, 179, 119) in jsdom
    expect(bar.style.backgroundColor).toBe('rgb(0, 179, 119)')
  })

  it('should apply amber color for medium retention rates', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'Medium', retentionRate: 0.5, baseCount: 100, returnedCount: 50 }]
    const { container } = render(<CssVerticalRetentionBarChart data={data} title="Colors" />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    // Amber hsl(42, 92%, 50%) -> rgb(245, 174, 10) in jsdom
    expect(bar.style.backgroundColor).toBe('rgb(245, 174, 10)')
  })

  it('should apply red color for low retention rates', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'Low', retentionRate: 0.3, baseCount: 100, returnedCount: 30 }]
    const { container } = render(<CssVerticalRetentionBarChart data={data} title="Colors" />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    // Red hsl(350, 70%, 50%) -> rgb(217, 38, 68) in jsdom
    expect(bar.style.backgroundColor).toBe('rgb(217, 38, 68)')
  })

  it('should show percentage Y-axis labels', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    // Use a rate that won't produce a label matching a Y-axis tick (e.g. 65%)
    const data = [{ name: 'A', retentionRate: 0.65, baseCount: 100, returnedCount: 65 }]
    render(<CssVerticalRetentionBarChart data={data} title="Y-Axis" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('should show rate label without counts by default', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    // Use a rate that doesn't collide with Y-axis ticks (0/25/50/75/100)
    const data = [{ name: 'Test', retentionRate: 0.83, baseCount: 100, returnedCount: 83 }]
    render(<CssVerticalRetentionBarChart data={data} title="Labels" />)
    expect(screen.getByText('83%')).toBeInTheDocument()
  })

  it('should show rate label with counts when showCounts is true', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'Test', retentionRate: 0.75, baseCount: 100, returnedCount: 75 }]
    render(<CssVerticalRetentionBarChart data={data} title="Labels" showCounts />)
    expect(screen.getByText('75% (75/100)')).toBeInTheDocument()
  })

  it('should call onBarClick with the original RetentionRateBarItem', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const onClick = vi.fn()
    const data = [{ name: 'Click Me', retentionRate: 0.6, baseCount: 50, returnedCount: 30 }]
    const { container } = render(
      <CssVerticalRetentionBarChart data={data} title="Click" onBarClick={onClick} />
    )
    const column = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(column)
    expect(onClick).toHaveBeenCalledTimes(1)
    // The callback should receive the original RetentionRateBarItem
    const arg = onClick.mock.calls[0]![0]
    expect(arg.name).toBe('Click Me')
    expect(arg.retentionRate).toBe(0.6)
    expect(arg.baseCount).toBe(50)
    expect(arg.returnedCount).toBe(30)
  })

  it('should use w-10 yAxisWidth for percentage labels', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'A', retentionRate: 0.5, baseCount: 100, returnedCount: 50 }]
    const { container } = render(<CssVerticalRetentionBarChart data={data} title="Width" />)
    expect(container.querySelector('.w-10')).toBeInTheDocument()
  })

  it('should apply custom className', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'A', retentionRate: 0.5, baseCount: 100, returnedCount: 50 }]
    const { container } = render(
      <CssVerticalRetentionBarChart data={data} title="Class" className="extra-class" />
    )
    expect(container.querySelector('.extra-class')).toBeInTheDocument()
  })

  it('should pass barWidthPercent through to CssVerticalBarChart', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [
      { name: 'A', retentionRate: 0.5, baseCount: 100, returnedCount: 50 },
      { name: 'B', retentionRate: 0.7, baseCount: 80, returnedCount: 56 },
    ]
    const { container } = render(
      <CssVerticalRetentionBarChart data={data} title="Thin" barWidthPercent={60} />
    )
    const bars = container.querySelectorAll<HTMLElement>('.rounded-t')
    for (const bar of bars) {
      expect(bar.style.width).toBe('60%')
    }
  })

  it('should default to full-width bars when barWidthPercent is not provided', async () => {
    const { CssVerticalRetentionBarChart } = await import('./CssVerticalRetentionBarChart')
    const data = [{ name: 'A', retentionRate: 0.5, baseCount: 100, returnedCount: 50 }]
    const { container } = render(<CssVerticalRetentionBarChart data={data} title="Default" />)
    const bar = container.querySelector('.rounded-t') as HTMLElement
    expect(bar.classList.contains('w-full')).toBe(true)
  })
})
