/**
 * TDD Tests for CssVerticalStackedBarChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * Generic vertical stacked bar chart using segments prop.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import type { VerticalStackedSegment } from './CssVerticalStackedBarChart'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const segments: VerticalStackedSegment[] = [
  { key: 'female_count', label: 'Female', color: 'hsl(350, 70%, 50%)' },
  { key: 'male_count', label: 'Male', color: 'hsl(200, 70%, 50%)' },
]

const sampleData = [
  { name: 'Grade 3', total: 20, male_count: 12, female_count: 8, grade: 3 },
  { name: 'Grade 4', total: 30, male_count: 18, female_count: 12, grade: 4 },
  { name: 'Grade 5', total: 25, male_count: 10, female_count: 15, grade: 5 },
]

const singleItem = [{ name: 'Solo', total: 10, male_count: 6, female_count: 4 }]

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart exports', () => {
  it('should export CssVerticalStackedBarChart as a named function', async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    expect(typeof mod.CssVerticalStackedBarChart).toBe('function')
  })

  it('should export the VerticalStackedSegment type (compile-time check)', () => {
    const seg: VerticalStackedSegment = { key: 'test', label: 'Test', color: 'red' }
    expect(seg.key).toBe('test')
  })
})

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart rendering', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should render the title when provided', () => {
    render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} title="My Chart" />
    )
    expect(screen.getByText('My Chart')).toBeInTheDocument()
  })

  it('should render without a title when not provided', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    const headings = container.querySelectorAll('h3')
    expect(headings.length).toBe(0)
  })

  it('should wrap in card-lodge class', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <CssVerticalStackedBarChart
        data={sampleData}
        segments={segments}
        className="my-custom"
      />
    )
    expect(container.querySelector('.my-custom')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart empty state', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should show "No data available" when data is empty', () => {
    render(<CssVerticalStackedBarChart data={[]} segments={segments} />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should still wrap in card-lodge when empty', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={[]} segments={segments} />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Stacked bar rendering
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart bar rendering', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should render one column per data item', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    // Each column container has flex-col and items-center classes
    const columns = container.querySelectorAll('.flex-col.items-center')
    expect(columns.length).toBe(sampleData.length)
  })

  it('should render segment divs with correct background colors', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={singleItem} segments={segments} />
    )
    // Find the stacked bar container (has flex-col and overflow-hidden and rounded-t)
    const stackedBar = container.querySelector('.rounded-t.overflow-hidden') as HTMLElement
    expect(stackedBar).not.toBeNull()
    // Should have children divs for each segment with data
    const segmentDivs = stackedBar.querySelectorAll(':scope > div')
    expect(segmentDivs.length).toBe(2) // both female_count and male_count are > 0
  })

  it('should use flex proportional sizing for segments', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={singleItem} segments={segments} />
    )
    const stackedBar = container.querySelector('.rounded-t.overflow-hidden') as HTMLElement
    const segmentDivs = stackedBar.querySelectorAll(':scope > div') as NodeListOf<HTMLElement>
    // Each segment should have a flex value
    for (const div of segmentDivs) {
      expect(div.style.flex).not.toBe('')
    }
  })

  it('should skip segments with zero value', () => {
    const zeroData = [{ name: 'Test', total: 10, male_count: 10, female_count: 0 }]
    const { container } = render(
      <CssVerticalStackedBarChart data={zeroData} segments={segments} />
    )
    const stackedBar = container.querySelector('.rounded-t.overflow-hidden') as HTMLElement
    const segmentDivs = stackedBar.querySelectorAll(':scope > div')
    expect(segmentDivs.length).toBe(1) // only male_count > 0
  })

  it('should set minHeight 4px for non-zero total', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={singleItem} segments={segments} />
    )
    const stackedBar = container.querySelector('.rounded-t.overflow-hidden') as HTMLElement
    expect(stackedBar.style.minHeight).toBe('4px')
  })

  it('should set minHeight 0px for zero-total items', () => {
    const zeroData = [{ name: 'Zero', total: 0, male_count: 0, female_count: 0 }]
    const { container } = render(
      <CssVerticalStackedBarChart data={zeroData} segments={segments} />
    )
    const stackedBar = container.querySelector('.rounded-t.overflow-hidden') as HTMLElement
    expect(stackedBar.style.minHeight).toBe('0px')
  })
})

// ---------------------------------------------------------------------------
// Y-axis
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart Y-axis', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should auto-compute ticks via getNiceTicks in normal mode', () => {
    render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    // Data max total is 30, getNiceTicks should produce ticks including 0
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should use default w-8 Y-axis width', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    const yAxis = container.querySelector('.w-8')
    expect(yAxis).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Percent mode
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart percent mode', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should show percentage ticks in percent mode', () => {
    render(
      <CssVerticalStackedBarChart
        data={sampleData}
        segments={segments}
        percentMode
      />
    )
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('should not show total labels by default in percent mode', () => {
    const data = [{ name: 'Grade 3', total: 17, male_count: 10, female_count: 7 }]
    const { container } = render(
      <CssVerticalStackedBarChart
        data={data}
        segments={segments}
        percentMode
      />
    )
    // Total label (17) should NOT appear
    const labels = container.querySelectorAll('.tabular-nums')
    // The tabular-nums elements should only be Y-axis ticks, not bar labels
    let foundTotal = false
    labels.forEach((el) => {
      if (el.textContent === '17') foundTotal = true
    })
    expect(foundTotal).toBe(false)
  })

  it('should show total labels in percent mode when showTotalLabel is true', () => {
    const data = [{ name: 'Grade 3', total: 17, male_count: 10, female_count: 7 }]
    render(
      <CssVerticalStackedBarChart
        data={data}
        segments={segments}
        percentMode
        showTotalLabel
      />
    )
    expect(screen.getByText('17')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Labels above bars
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart labels', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should show total as default label above each bar in normal mode', () => {
    const data = [{ name: 'Item', total: 37, male_count: 20, female_count: 17 }]
    render(
      <CssVerticalStackedBarChart data={data} segments={segments} />
    )
    expect(screen.getByText('37')).toBeInTheDocument()
  })

  it('should use custom labelFormat when provided', () => {
    render(
      <CssVerticalStackedBarChart
        data={singleItem}
        segments={segments}
        labelFormat={(item) => `N=${item['total']}`}
      />
    )
    expect(screen.getByText('N=10')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// X-axis labels
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart X-axis', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should render X-axis labels from data names', () => {
    render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    expect(screen.getByText('Grade 3')).toBeInTheDocument()
    expect(screen.getByText('Grade 4')).toBeInTheDocument()
    expect(screen.getByText('Grade 5')).toBeInTheDocument()
  })

  it('should rotate labels when rotateLabels is true', () => {
    const { container } = render(
      <CssVerticalStackedBarChart
        data={sampleData}
        segments={segments}
        rotateLabels
      />
    )
    const xAxisWrapper = container.querySelector('[style*="height: 60px"]')
    expect(xAxisWrapper).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart legend', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should render legend with segment labels', () => {
    render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    expect(screen.getByText('Female')).toBeInTheDocument()
    expect(screen.getByText('Male')).toBeInTheDocument()
  })

  it('should not show legend entry for segments with zero values across all data items', () => {
    const threeSegments: VerticalStackedSegment[] = [
      { key: 'a', label: 'Active', color: 'green' },
      { key: 'b', label: 'Inactive', color: 'red' },
      { key: 'c', label: 'Empty', color: 'gray' },
    ]
    const data = [
      { name: 'Cat 1', total: 10, a: 7, b: 3, c: 0 },
      { name: 'Cat 2', total: 8, a: 5, b: 3, c: 0 },
    ]
    render(<CssVerticalStackedBarChart data={data} segments={threeSegments} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    // 'Empty' has 0 across all items — should NOT appear in legend
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  })

  it('should show segment in legend if it has a non-zero value in any data item', () => {
    const threeSegments: VerticalStackedSegment[] = [
      { key: 'a', label: 'Active', color: 'green' },
      { key: 'b', label: 'Sparse', color: 'blue' },
    ]
    const data = [
      { name: 'Cat 1', total: 10, a: 10, b: 0 },
      { name: 'Cat 2', total: 5, a: 2, b: 3 }, // b is non-zero here
    ]
    render(<CssVerticalStackedBarChart data={data} segments={threeSegments} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Sparse')).toBeInTheDocument() // has data in Cat 2
  })
})

// ---------------------------------------------------------------------------
// Legend spacing (rotated vs straight labels)
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart legend spacing', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should use mt-3 on legend when rotateLabels is true', () => {
    render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} rotateLabels />
    )
    // ChartLegend renders a flex wrapper — find it by the legend items
    const femaleLabel = screen.getByText('Female')
    // Walk up to the ChartLegend wrapper (parent with mt-3)
    const legendWrapper = femaleLabel.closest('.mt-3')
    expect(legendWrapper).toBeInTheDocument()
  })

  it('should use mt-1 on legend when rotateLabels is false', () => {
    render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    const femaleLabel = screen.getByText('Female')
    const legendWrapper = femaleLabel.closest('.mt-1')
    expect(legendWrapper).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Click handling
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart click handling', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should add cursor-pointer class when onBarClick is provided', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssVerticalStackedBarChart
        data={singleItem}
        segments={segments}
        onBarClick={onClick}
      />
    )
    const column = container.querySelector('.cursor-pointer')
    expect(column).toBeInTheDocument()
  })

  it('should not have cursor-pointer when onBarClick is not provided', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={singleItem} segments={segments} />
    )
    const column = container.querySelector('.cursor-pointer')
    expect(column).toBeNull()
  })

  it('should call onBarClick with the item record when a column is clicked', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssVerticalStackedBarChart
        data={singleItem}
        segments={segments}
        onBarClick={onClick}
      />
    )
    const column = container.querySelector('.cursor-pointer') as HTMLElement
    fireEvent.click(column)
    expect(onClick).toHaveBeenCalledTimes(1)
    const arg = onClick.mock.calls[0]![0]
    expect(arg['name']).toBe('Solo')
    expect(arg['total']).toBe(10)
    expect(arg['male_count']).toBe(6)
    expect(arg['female_count']).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart tooltip', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should not render tooltip content initially', () => {
    render(
      <CssVerticalStackedBarChart
        data={sampleData}
        segments={segments}
        renderTooltip={(item) => <span data-testid="tt">{String(item['name'])}</span>}
      />
    )
    expect(screen.queryByTestId('tt')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Column sizing integration
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart column sizing', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should pass column sizing to x-axis in sparse mode for alignment', () => {
    const sparseData = [
      { name: 'A', total: 10, male_count: 6, female_count: 4 },
      { name: 'B', total: 15, male_count: 8, female_count: 7 },
      { name: 'C', total: 12, male_count: 5, female_count: 7 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={sparseData} segments={segments} />
    )
    // X-axis should use justify-center to match sparse bar layout
    const xAxisWrapper = container.querySelector('.border-t.justify-center')
    expect(xAxisWrapper).toBeInTheDocument()
    // X-axis labels should have maxWidth matching columns
    const xAxisLabels = xAxisWrapper?.querySelectorAll('[style*="max-width: 120px"]')
    expect(xAxisLabels?.length).toBe(3)
  })

  it('should use border-foreground/40 for y-axis line', () => {
    const { container } = render(
      <CssVerticalStackedBarChart data={sampleData} segments={segments} />
    )
    const yAxis = container.querySelector('.border-foreground\\/40.border-l')
    expect(yAxis).toBeInTheDocument()
  })

  it('should apply maxWidth to columns in sparse mode (<=4 items)', () => {
    const sparseData = [
      { name: 'A', total: 10, male_count: 6, female_count: 4 },
      { name: 'B', total: 15, male_count: 8, female_count: 7 },
      { name: 'C', total: 12, male_count: 5, female_count: 7 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={sparseData} segments={segments} />
    )
    // Sparse mode columns (in bars area, which has border-l) should have maxWidth style
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columns = barsArea.querySelectorAll(':scope > [style*="max-width: 120px"]')
    expect(columns.length).toBe(sparseData.length)
  })

  it('should use zero gap in sparse mode (padding provides spacing)', () => {
    const sparseData = [
      { name: 'A', total: 10, male_count: 6, female_count: 4 },
      { name: 'B', total: 15, male_count: 8, female_count: 7 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={sparseData} segments={segments} />
    )
    // Sparse mode uses padding instead of gap to avoid tooltip dead zones
    const barsArea = container.querySelector('.border-l') as HTMLElement
    expect(barsArea.style.gap).toBe('0px')
  })

  it('should not apply maxWidth in normal mode (5-9 items)', () => {
    const normalData = Array.from({ length: 6 }, (_, i) => ({
      name: `Item ${i}`,
      total: 10 + i,
      male_count: 5 + i,
      female_count: 5,
    }))
    const { container } = render(
      <CssVerticalStackedBarChart data={normalData} segments={segments} />
    )
    // Normal mode should NOT have maxWidth on columns
    const columnsWithMaxWidth = container.querySelectorAll('[style*="max-width: 120px"]')
    expect(columnsWithMaxWidth.length).toBe(0)
  })

  it('should not render ColumnHoverOverlay in sparse mode', () => {
    const sparseData = [
      { name: 'A', total: 10, male_count: 6, female_count: 4 },
      { name: 'B', total: 15, male_count: 8, female_count: 7 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={sparseData} segments={segments} />
    )
    // ColumnHoverOverlay uses pointer-events-none absolute — should not be present in sparse
    const overlay = container.querySelector('.pointer-events-none.absolute')
    expect(overlay).toBeNull()
  })

  it('should highlight column on hover in sparse mode', () => {
    const sparseData = [
      { name: 'A', total: 10, male_count: 6, female_count: 4 },
      { name: 'B', total: 15, male_count: 8, female_count: 7 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={sparseData} segments={segments} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columns = barsArea.querySelectorAll(':scope > [style*="max-width"]') as NodeListOf<HTMLElement>
    // Hover over first column
    fireEvent.mouseEnter(columns[0]!)
    expect(columns[0]!.className).toContain('bg-foreground/[0.06]')
    // Second column should not be highlighted
    expect(columns[1]!.className).not.toContain('bg-foreground/[0.06]')
  })
})

// ---------------------------------------------------------------------------
// Tooltip zero filtering
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart tooltip zero filtering', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should not show zero-value segments in default tooltip', () => {
    // Data where one segment is zero
    const dataWithZero = [
      { name: 'Test', total: 10, male_count: 10, female_count: 0 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={dataWithZero} segments={segments} />
    )
    // Trigger tooltip by hovering over a column
    const column = container.querySelector('.flex-1.flex-col.items-center') as HTMLElement
    if (column) {
      fireEvent.mouseEnter(column)
      fireEvent.mouseMove(column, { clientX: 100, clientY: 100 })
    }
    // If tooltip renders, Female segment (value 0) should not be shown
    // The tooltip should only show Male (value 10)
    const tooltipLabels = container.querySelectorAll('.text-muted-foreground.text-sm')
    const labelTexts = Array.from(tooltipLabels).map((el) => el.textContent)
    // Should NOT find "Female:" with "0 (0%)" in tooltip
    const hasFemaleZero = labelTexts.some((t) => t?.includes('Female:') && t?.includes('0 (0%)'))
    expect(hasFemaleZero).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// maxColumnWidth prop
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart maxColumnWidth prop', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should constrain and center columns when maxColumnWidth is provided', () => {
    const normalData = Array.from({ length: 5 }, (_, i) => ({
      name: `Y${i}`,
      total: 10 + i,
      male_count: 6 + i,
      female_count: 4,
    }))
    const { container } = render(
      <CssVerticalStackedBarChart data={normalData} segments={segments} maxColumnWidth={100} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    // Should have maxWidth on columns
    const columns = barsArea.querySelectorAll(':scope > [style*="max-width: 100px"]')
    expect(columns.length).toBe(5)
    // Should center columns (sparse-like behavior)
    expect(barsArea.className).toContain('justify-center')
  })

  it('should not constrain columns when maxColumnWidth is not provided', () => {
    const normalData = Array.from({ length: 5 }, (_, i) => ({
      name: `Y${i}`,
      total: 10 + i,
      male_count: 6 + i,
      female_count: 4,
    }))
    const { container } = render(
      <CssVerticalStackedBarChart data={normalData} segments={segments} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const columns = barsArea.querySelectorAll(':scope > [style*="max-width"]')
    // Normal mode (5 items) has no maxWidth by default
    expect(columns.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// No imports from GenderByGradeBreakdown or DrilldownFilter
// ---------------------------------------------------------------------------
describe('CssVerticalStackedBarChart is generic (no hardcoded types)', () => {
  let CssVerticalStackedBarChart: typeof import('./CssVerticalStackedBarChart').CssVerticalStackedBarChart

  beforeAll(async () => {
    const mod = await import('./CssVerticalStackedBarChart')
    CssVerticalStackedBarChart = mod.CssVerticalStackedBarChart
  })

  it('should accept data with arbitrary segment keys', () => {
    const customSegments: VerticalStackedSegment[] = [
      { key: 'apples', label: 'Apples', color: 'green' },
      { key: 'oranges', label: 'Oranges', color: 'orange' },
    ]
    const customData = [
      { name: 'January', total: 100, apples: 60, oranges: 40 },
      { name: 'February', total: 80, apples: 30, oranges: 50 },
    ]
    const { container } = render(
      <CssVerticalStackedBarChart data={customData} segments={customSegments} />
    )
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
    expect(screen.getByText('January')).toBeInTheDocument()
    expect(screen.getByText('February')).toBeInTheDocument()
    expect(screen.getByText('Apples')).toBeInTheDocument()
    expect(screen.getByText('Oranges')).toBeInTheDocument()
  })
})
