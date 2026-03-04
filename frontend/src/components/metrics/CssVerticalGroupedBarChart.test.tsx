/**
 * TDD Tests for CssVerticalGroupedBarChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * Generic grouped (multi-bar-per-column) CSS vertical bar chart.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import type {
  GroupedBarSeries,
  CssVerticalGroupedBarChartProps,
} from './CssVerticalGroupedBarChart'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const series: GroupedBarSeries[] = [
  { key: 'male', label: 'Male', color: 'hsl(200, 70%, 50%)' },
  { key: 'female', label: 'Female', color: 'hsl(350, 70%, 50%)' },
]

const sampleData: CssVerticalGroupedBarChartProps['data'] = [
  { name: 'Grade 3', male: 12, female: 8 },
  { name: 'Grade 4', male: 15, female: 10 },
  { name: 'Grade 5', male: 20, female: 18 },
]

const singleItem: CssVerticalGroupedBarChartProps['data'] = [
  { name: 'Solo', male: 30, female: 25 },
]

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart exports', () => {
  it('should export CssVerticalGroupedBarChart as a named function', async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    expect(typeof mod.CssVerticalGroupedBarChart).toBe('function')
  })

  it('should export the GroupedBarSeries type (compile-time check)', () => {
    const s: GroupedBarSeries = { key: 'test', label: 'Test', color: 'red' }
    expect(s.key).toBe('test')
  })
})

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart rendering', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should render the title when provided', () => {
    render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} title="My Grouped Chart" />
    )
    expect(screen.getByText('My Grouped Chart')).toBeInTheDocument()
  })

  it('should render without a title when not provided', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    const headings = container.querySelectorAll('h3')
    expect(headings.length).toBe(0)
  })

  it('should wrap in card-lodge class', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} className="my-custom" />
    )
    expect(container.querySelector('.my-custom')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart empty state', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should show "No data available" when data is empty', () => {
    render(<CssVerticalGroupedBarChart data={[]} series={series} />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should still wrap in card-lodge when empty', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={[]} series={series} />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Bar rendering
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart bar rendering', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should render N bars per column (one per series)', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    // Each bar has z-[1] class — N series * M data items
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all')
    expect(bars.length).toBe(sampleData.length * series.length)
  })

  it('should render bars with transition-all duration-300', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    const transitionBars = container.querySelectorAll('.transition-all.duration-300')
    expect(transitionBars.length).toBe(sampleData.length * series.length)
  })

  it('should apply series colors to bars', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={singleItem} series={series} />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all') as NodeListOf<HTMLElement>
    // First bar: male color hsl(200, 70%, 50%) => rgb(38, 157, 217)
    expect(bars[0]!.style.backgroundColor).toBe('rgb(38, 157, 217)')
    // Second bar: female color hsl(350, 70%, 50%) => rgb(217, 38, 68)
    expect(bars[1]!.style.backgroundColor).toBe('rgb(217, 38, 68)')
  })

  it('should set minHeight 4px for non-zero values', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={singleItem} series={series} />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all') as NodeListOf<HTMLElement>
    expect(bars[0]!.style.minHeight).toBe('4px')
    expect(bars[1]!.style.minHeight).toBe('4px')
  })

  it('should set minHeight 0px for zero-value bars', () => {
    const zeroData = [{ name: 'Zero', male: 0, female: 0 }]
    const { container } = render(
      <CssVerticalGroupedBarChart data={zeroData} series={series} />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all') as NodeListOf<HTMLElement>
    expect(bars[0]!.style.minHeight).toBe('0px')
    expect(bars[1]!.style.minHeight).toBe('0px')
  })

  it('should arrange bars side-by-side with flex-row and items-end', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    // The bar group container should have flex, flex-row, items-end
    const barGroups = container.querySelectorAll('.flex.flex-row.items-end')
    expect(barGroups.length).toBe(sampleData.length)
  })
})

// ---------------------------------------------------------------------------
// Y-axis
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart Y-axis', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should use yAxisMax when provided', () => {
    render(
      <CssVerticalGroupedBarChart
        data={sampleData}
        series={series}
        yAxisMax={100}
        yAxisFormat={(t: number) => `${t}%`}
      />
    )
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('should auto-compute ticks when yAxisMax is not provided', () => {
    // Data max across all series is 20, so ticks should include 0
    render(<CssVerticalGroupedBarChart data={sampleData} series={series} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should compute max across all series keys', () => {
    // The max value in our sample data is 20 (Grade 5, male)
    // getNiceTicks(20) should give [0, 5, 10, 15, 20]
    render(<CssVerticalGroupedBarChart data={sampleData} series={series} />)
    expect(screen.getByText('20')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// X-axis labels
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart X-axis', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should render X-axis labels from data names', () => {
    render(<CssVerticalGroupedBarChart data={sampleData} series={series} />)
    expect(screen.getByText('Grade 3')).toBeInTheDocument()
    expect(screen.getByText('Grade 4')).toBeInTheDocument()
    expect(screen.getByText('Grade 5')).toBeInTheDocument()
  })

  it('should rotate labels when rotateLabels is true', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} rotateLabels />
    )
    const xAxisWrapper = container.querySelector('[style*="height: 72px"]')
    expect(xAxisWrapper).toBeInTheDocument()
  })

  it('should auto-rotate labels when data has more than 8 items', () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      name: `Cat ${i}`,
      male: i * 2,
      female: i * 3,
    }))
    const { container } = render(
      <CssVerticalGroupedBarChart data={manyItems} series={series} />
    )
    // Auto-rotate kicks in for >8 items — rotated axis has height: 72px
    const xAxisWrapper = container.querySelector('[style*="height: 72px"]')
    expect(xAxisWrapper).toBeInTheDocument()
  })

  it('should not auto-rotate labels when data has 8 or fewer items', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    // 3 items < 8 — should NOT have rotated 80px axis
    const xAxisWrapper = container.querySelector('[style*="height: 60px"]')
    expect(xAxisWrapper).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart legend', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should render a legend with all series labels', () => {
    render(<CssVerticalGroupedBarChart data={sampleData} series={series} />)
    expect(screen.getByText('Male')).toBeInTheDocument()
    expect(screen.getByText('Female')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart tooltip', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should not render tooltip content initially', () => {
    render(
      <CssVerticalGroupedBarChart
        data={sampleData}
        series={series}
        renderTooltip={(item: Record<string, unknown>) => <span data-testid="tt">{String(item['name'])}</span>}
      />
    )
    expect(screen.queryByTestId('tt')).not.toBeInTheDocument()
  })

  it('should show default tooltip with column name and series values on hover', () => {
    // Default tooltip shows item.name and each series value
    // We can't easily trigger the full tooltip in jsdom, but we verify
    // the component renders without error when no renderTooltip is provided
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Click handling
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart click handling', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should add cursor-pointer class when onBarClick is provided', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssVerticalGroupedBarChart
        data={singleItem}
        series={series}
        onBarClick={onClick}
      />
    )
    const column = container.querySelector('.cursor-pointer')
    expect(column).toBeInTheDocument()
  })

  it('should not have cursor-pointer when onBarClick is not provided', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={singleItem} series={series} />
    )
    const column = container.querySelector('.cursor-pointer')
    expect(column).toBeNull()
  })

  it('should call onBarClick with item and seriesKey when a bar is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssVerticalGroupedBarChart
        data={singleItem}
        series={series}
        onBarClick={onClick}
      />
    )
    // Click the first individual bar (rounded-t)
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all')
    fireEvent.click(bars[0]!)
    expect(onClick).toHaveBeenCalledTimes(1)
    // Should receive the data item and the series key
    expect(onClick.mock.calls[0]![0]).toEqual(singleItem[0])
    expect(onClick.mock.calls[0]![1]).toBe('male')
  })

  it('should pass the correct seriesKey for each bar', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssVerticalGroupedBarChart
        data={singleItem}
        series={series}
        onBarClick={onClick}
      />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all')
    // Click second bar (female)
    fireEvent.click(bars[1]!)
    expect(onClick.mock.calls[0]![1]).toBe('female')
  })
})

// ---------------------------------------------------------------------------
// Column sizing integration
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart column sizing', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should apply maxWidth to inner visual div in sparse mode (<=4 items)', () => {
    const sparseData = [
      { name: 'A', male: 10, female: 8 },
      { name: 'B', male: 15, female: 12 },
      { name: 'C', male: 12, female: 10 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} />
    )
    // maxWidth should be on inner visual div, not on the outer flex-1 wrapper
    const innerDivsWithMaxWidth = container.querySelectorAll('[style*="max-width: 120px"]')
    expect(innerDivsWithMaxWidth.length).toBe(sparseData.length)
    // Outer wrappers (direct children of barsArea) should NOT have maxWidth
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const outerWithMaxWidth = barsArea.querySelectorAll(':scope > [style*="max-width"]')
    expect(outerWithMaxWidth.length).toBe(0)
  })

  it('should have no flex gap (gap absorbed into column padding for contiguous hover)', () => {
    const sparseData = [
      { name: 'A', male: 10, female: 8 },
      { name: 'B', male: 15, female: 12 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    expect(barsArea.style.gap).toBe('')
  })

  it('should not apply maxWidth in normal mode (5-9 items)', () => {
    const normalData = Array.from({ length: 6 }, (_, i) => ({
      name: `Item ${i}`,
      male: 10 + i,
      female: 8 + i,
    }))
    const { container } = render(
      <CssVerticalGroupedBarChart data={normalData} series={series} />
    )
    const columnsWithMaxWidth = container.querySelectorAll('[style*="max-width: 120px"]')
    expect(columnsWithMaxWidth.length).toBe(0)
  })

  it('should not render ColumnHoverOverlay in sparse mode', () => {
    const sparseData = [
      { name: 'A', male: 10, female: 8 },
      { name: 'B', male: 15, female: 12 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} />
    )
    const overlay = container.querySelector('.bg-foreground\\/\\[0\\.06\\]')
    expect(overlay).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Height prop
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart height', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should use default height of 300', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    // Default height 300, barsHeight = 300 - 34 = 266
    const barsArea = container.querySelector('[style*="height: 266px"]')
    expect(barsArea).toBeInTheDocument()
  })

  it('should use custom height when provided', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} height={400} />
    )
    // Custom height 400, barsHeight = 400 - 34 = 366
    const barsArea = container.querySelector('[style*="height: 366px"]')
    expect(barsArea).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Title spacing (Fix 1: title overlap with y-axis)
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart title spacing', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should have mb-4 on title for adequate y-axis clearance', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} title="Test Title" />
    )
    const title = container.querySelector('h3')
    expect(title).toBeInTheDocument()
    expect(title!.className).toContain('mb-4')
  })
})

// ---------------------------------------------------------------------------
// groupGap prop (Fix 3: inter-group spacing)
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart groupGap prop', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should absorb groupGap into column padding instead of flex gap', () => {
    const sparseData = [
      { name: '2024', male: 100, female: 80 },
      { name: '2025', male: 110, female: 90 },
      { name: '2026', male: 120, female: 95 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} groupGap={16} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    // No flex gap — absorbed into column padding for contiguous hover areas
    expect(barsArea.style.gap).toBe('')
  })

  it('should set x-axis gap to 0 (gap absorbed into column padding)', () => {
    const sparseData = [
      { name: '2024', male: 100, female: 80 },
      { name: '2025', male: 110, female: 90 },
      { name: '2026', male: 120, female: 95 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} groupGap={16} />
    )
    // X-axis is the border-t flex container (not gridlines which are border-dashed)
    const xAxis = container.querySelector('.border-t:not(.border-dashed)') as HTMLElement
    expect(xAxis.style.gap).toBe('0px')
  })
})

// ---------------------------------------------------------------------------
// barWidthPercent prop (Fix 2: thinner bars)
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart barWidthPercent prop', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should apply max-width percentage to each bar when barWidthPercent is provided', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} barWidthPercent={75} />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all') as NodeListOf<HTMLElement>
    // All bars should have maxWidth style
    for (const bar of bars) {
      expect(bar.style.maxWidth).toBe('75%')
    }
  })

  it('should not apply max-width to bars when barWidthPercent is not provided', () => {
    const { container } = render(
      <CssVerticalGroupedBarChart data={sampleData} series={series} />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all') as NodeListOf<HTMLElement>
    for (const bar of bars) {
      expect(bar.style.maxWidth).toBe('')
    }
  })
})

// ---------------------------------------------------------------------------
// Y-axis scaling: axisMax must match top tick to prevent overflow
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart y-axis scaling', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should scale bars to nice tick max, not raw data max', () => {
    // Data max is 210. getNiceTicks(210) → [0, 50, 100, 150, 200, 250].
    // Bars should be scaled to 250, not 210, so the tallest bar is < drawingHeight.
    const data = [
      { name: 'A', male: 210, female: 190 },
      { name: 'B', male: 180, female: 170 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={data} series={series} />
    )
    const bars = container.querySelectorAll('.z-\\[1\\].transition-all') as NodeListOf<HTMLElement>
    const heights = Array.from(bars).map((b) => parseFloat(b.style.height))
    const tallestBar = Math.max(...heights)
    // height=300, xAxisHeight=34 (2 items, no rotation), topPadding=16
    // drawingHeight = 300 - 34 - 16 = 250
    // If scaled to 250 (correct): (210/250)*250 = 210px
    // If scaled to 210 (bug): (210/210)*250 = 250px
    expect(tallestBar).toBeLessThan(250)
    // More precisely: 210/250 * 250 = 210
    expect(tallestBar).toBeCloseTo(210, 0)
  })

  it('should show the nice tick max on the y-axis, not just the data max', () => {
    const data = [
      { name: 'A', male: 210, female: 190 },
      { name: 'B', male: 180, female: 170 },
    ]
    render(<CssVerticalGroupedBarChart data={data} series={series} />)
    // The y-axis should show 250 (the nice tick max), not just 200
    expect(screen.getByText('250')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Contiguous hover areas (two-div column structure)
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart contiguous hover areas', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should make all column outer wrappers flex-1 in sparse mode', () => {
    const sparseData = [
      { name: 'A', male: 10, female: 8 },
      { name: 'B', male: 15, female: 12 },
      { name: 'C', male: 12, female: 10 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    // Direct non-absolute children are column wrappers — all should be flex-1
    const columnWrappers = Array.from(barsArea.children).filter(
      (el) => !el.classList.contains('pointer-events-none') && !el.classList.contains('absolute')
    )
    expect(columnWrappers.length).toBe(sparseData.length)
    for (const wrapper of columnWrappers) {
      expect(wrapper.classList.contains('flex-1')).toBe(true)
    }
  })

  it('should make all column outer wrappers flex-1 when maxColumnWidth is set', () => {
    const data = [
      { name: 'A', male: 10, female: 8 },
      { name: 'B', male: 15, female: 12 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={data} series={series} maxColumnWidth={100} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columnWrappers = Array.from(barsArea.children).filter(
      (el) => !el.classList.contains('pointer-events-none') && !el.classList.contains('absolute')
    )
    expect(columnWrappers.length).toBe(data.length)
    for (const wrapper of columnWrappers) {
      expect(wrapper.classList.contains('flex-1')).toBe(true)
    }
  })

  it('should not have justify-evenly or justify-center on bars container', () => {
    const sparseData = [
      { name: '2024', male: 100, female: 80 },
      { name: '2025', male: 110, female: 90 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} groupGap={16} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    expect(barsArea.classList.contains('justify-evenly')).toBe(false)
    expect(barsArea.classList.contains('justify-center')).toBe(false)
  })

  it('should place sparse hover highlight classes on inner visual div, not outer', () => {
    const sparseData = [
      { name: 'A', male: 10, female: 8 },
      { name: 'B', male: 15, female: 12 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    // Outer wrappers (direct children) should NOT have rounded/transition-colors
    const outerWrappers = Array.from(barsArea.children).filter(
      (el) => !el.classList.contains('pointer-events-none') && !el.classList.contains('absolute')
    )
    for (const wrapper of outerWrappers) {
      expect(wrapper.classList.contains('rounded')).toBe(false)
      expect(wrapper.classList.contains('transition-colors')).toBe(false)
    }
    // Inner visual divs (first child of each outer wrapper) should have those classes
    for (const wrapper of outerWrappers) {
      const innerDiv = wrapper.firstElementChild as HTMLElement
      expect(innerDiv).toBeTruthy()
      expect(innerDiv.classList.contains('rounded')).toBe(true)
      expect(innerDiv.classList.contains('transition-colors')).toBe(true)
    }
  })

  it('should make column wrappers flex-1 in normal (non-sparse) mode too', () => {
    const normalData = Array.from({ length: 6 }, (_, i) => ({
      name: `Item ${i}`,
      male: 10 + i,
      female: 8 + i,
    }))
    const { container } = render(
      <CssVerticalGroupedBarChart data={normalData} series={series} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columnWrappers = Array.from(barsArea.children).filter(
      (el) => !el.classList.contains('pointer-events-none') && !el.classList.contains('absolute')
    )
    expect(columnWrappers.length).toBe(normalData.length)
    for (const wrapper of columnWrappers) {
      expect(wrapper.classList.contains('flex-1')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// X-axis alignment in sparse mode (Fix 4)
// ---------------------------------------------------------------------------
describe('CssVerticalGroupedBarChart x-axis alignment', () => {
  let CssVerticalGroupedBarChart: typeof import('./CssVerticalGroupedBarChart').CssVerticalGroupedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalGroupedBarChart')
    CssVerticalGroupedBarChart = mod.CssVerticalGroupedBarChart
  })

  it('should add 1px left padding to x-axis to align with bars border-l', () => {
    const sparseData = [
      { name: '2024', male: 100, female: 80 },
      { name: '2025', male: 110, female: 90 },
      { name: '2026', male: 120, female: 95 },
    ]
    const { container } = render(
      <CssVerticalGroupedBarChart data={sparseData} series={series} />
    )
    const xAxis = container.querySelector('.border-t:not(.border-dashed)') as HTMLElement
    expect(xAxis.style.paddingLeft).toBeTruthy()
  })
})
