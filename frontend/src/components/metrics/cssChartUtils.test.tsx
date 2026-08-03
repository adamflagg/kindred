/**
 * TDD Tests for vertical chart utilities in cssChartUtils.
 *
 * Tests written FIRST before implementation (TDD).
 * Covers: calculateVerticalLayout, useVerticalColumnTooltip,
 * VerticalYAxis, VerticalXAxis, ColumnHoverOverlay, VerticalTooltipShell.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { type MouseEvent, createRef } from 'react'

// Existing exports (sanity check)
import { getNiceTicks, calculateBarSizing, useChartTooltip } from './cssChartUtils'

// New vertical exports
import {
  calculateVerticalLayout,
  calculateColumnSizing,
  useVerticalColumnTooltip,
  VerticalYAxis,
  VerticalXAxis,
  ColumnHoverOverlay,
  VerticalTooltipShell,
} from './cssChartUtils'
import type { VerticalChartLayout, ColumnSizing } from './cssChartUtils'

// ---------------------------------------------------------------------------
// calculateColumnSizing
// ---------------------------------------------------------------------------
describe('calculateColumnSizing', () => {
  it('should return sparse mode for 1 column', () => {
    const sizing = calculateColumnSizing(1)
    expect(sizing.mode).toBe('sparse')
    expect(sizing.maxWidth).toBe(120)
    expect(sizing.gap).toBe(0)
    expect(sizing.columnPadding).toBe(20)
  })

  it('should return sparse mode for 4 columns', () => {
    const sizing = calculateColumnSizing(4)
    expect(sizing.mode).toBe('sparse')
    expect(sizing.maxWidth).toBe(120)
    expect(sizing.gap).toBe(0)
    expect(sizing.columnPadding).toBe(20)
  })

  it('should return normal mode for 5 columns', () => {
    const sizing = calculateColumnSizing(5)
    expect(sizing.mode).toBe('normal')
    expect(sizing.maxWidth).toBeNull()
    expect(sizing.gap).toBe(4)
    expect(sizing.columnPadding).toBe(4)
  })

  it('should return normal mode for 9 columns', () => {
    const sizing = calculateColumnSizing(9)
    expect(sizing.mode).toBe('normal')
    expect(sizing.maxWidth).toBeNull()
    expect(sizing.gap).toBe(4)
    expect(sizing.columnPadding).toBe(4)
  })

  it('should return dense mode for 10 columns', () => {
    const sizing = calculateColumnSizing(10)
    expect(sizing.mode).toBe('dense')
    expect(sizing.maxWidth).toBeNull()
    expect(sizing.gap).toBe(2)
    expect(sizing.columnPadding).toBe(1)
  })

  it('should return dense mode for 20 columns', () => {
    const sizing = calculateColumnSizing(20)
    expect(sizing.mode).toBe('dense')
    expect(sizing.maxWidth).toBeNull()
    expect(sizing.gap).toBe(2)
    expect(sizing.columnPadding).toBe(1)
  })

  it('should handle 0 columns as sparse', () => {
    const sizing = calculateColumnSizing(0)
    expect(sizing.mode).toBe('sparse')
  })

  it('should satisfy the ColumnSizing interface', () => {
    const sizing: ColumnSizing = calculateColumnSizing(3)
    expect(sizing).toHaveProperty('mode')
    expect(sizing).toHaveProperty('maxWidth')
    expect(sizing).toHaveProperty('gap')
    expect(sizing).toHaveProperty('columnPadding')
  })
})

// ---------------------------------------------------------------------------
// calculateVerticalLayout
// ---------------------------------------------------------------------------
describe('calculateVerticalLayout', () => {
  it('should return correct layout with default options', () => {
    const layout = calculateVerticalLayout(300)
    // defaults: xAxisHeight=34, topPadding=16
    expect(layout.xAxisHeight).toBe(34)
    expect(layout.barsHeight).toBe(300 - 34) // 266
    expect(layout.drawingHeight).toBe(300 - 34 - 16) // 250
  })

  it('should accept custom xAxisHeight', () => {
    const layout = calculateVerticalLayout(300, { xAxisHeight: 60 })
    expect(layout.xAxisHeight).toBe(60)
    expect(layout.barsHeight).toBe(240) // 300 - 60
    expect(layout.drawingHeight).toBe(224) // 240 - 16
  })

  it('should accept custom topPadding', () => {
    const layout = calculateVerticalLayout(300, { topPadding: 20 })
    expect(layout.barsHeight).toBe(266) // 300 - 34
    expect(layout.drawingHeight).toBe(246) // 266 - 20
  })

  it('should accept both custom options', () => {
    const layout = calculateVerticalLayout(400, { xAxisHeight: 60, topPadding: 20 })
    expect(layout.xAxisHeight).toBe(60)
    expect(layout.barsHeight).toBe(340)
    expect(layout.drawingHeight).toBe(320)
  })

  it('should handle small heights without crashing', () => {
    const layout = calculateVerticalLayout(50)
    expect(layout.barsHeight).toBe(16)
    expect(layout.drawingHeight).toBe(0)
  })

  it('should satisfy the VerticalChartLayout interface', () => {
    const layout: VerticalChartLayout = calculateVerticalLayout(300)
    expect(layout).toHaveProperty('barsHeight')
    expect(layout).toHaveProperty('drawingHeight')
    expect(layout).toHaveProperty('xAxisHeight')
  })
})

// ---------------------------------------------------------------------------
// useVerticalColumnTooltip
// ---------------------------------------------------------------------------
describe('useVerticalColumnTooltip', () => {
  it('should initialize with hoveredIndex null and tooltip not visible', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip())
    expect(result.current.hoveredIndex).toBeNull()
    expect(result.current.tooltip.visible).toBe(false)
    expect(result.current.tooltip.item).toBeNull()
  })

  it('should provide chartRef and tooltipRef', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip())
    expect(result.current.chartRef).toBeDefined()
    expect(result.current.tooltipRef).toBeDefined()
  })

  it('should provide handler functions', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip())
    expect(typeof result.current.handleColumnEnter).toBe('function')
    expect(typeof result.current.handleColumnMove).toBe('function')
    expect(typeof result.current.handleColumnLeave).toBe('function')
  })

  it('should set hoveredIndex on handleColumnEnter', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip<string>())
    const mockRect = { right: 100, left: 50, top: 0, bottom: 200 } as DOMRect

    act(() => {
      result.current.handleColumnEnter(3, mockRect)
    })

    expect(result.current.hoveredIndex).toBe(3)
  })

  it('should track lastIndex from most recent non-null hoveredIndex', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip<string>())
    const mockRect = { right: 100, left: 50, top: 0, bottom: 200 } as DOMRect

    act(() => {
      result.current.handleColumnEnter(2, mockRect)
    })
    expect(result.current.lastIndex).toBe(2)

    act(() => {
      result.current.handleColumnLeave()
    })
    // lastIndex should remain at 2 even after leave
    expect(result.current.lastIndex).toBe(2)
    expect(result.current.hoveredIndex).toBeNull()
  })

  it('should set tooltip visible=false on handleColumnLeave', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip<string>())
    const mockRect = { right: 100, left: 50 } as DOMRect

    // Enter and move to make tooltip visible
    act(() => {
      result.current.handleColumnEnter(0, mockRect)
    })

    act(() => {
      result.current.handleColumnLeave()
    })

    expect(result.current.tooltip.visible).toBe(false)
    expect(result.current.hoveredIndex).toBeNull()
  })

  it('should use fallback positioning when chartRef is unavailable', () => {
    const { result } = renderHook(() => useVerticalColumnTooltip<string>())
    const mockRect = { right: 100, left: 50 } as DOMRect
    const mockEvent = {
      clientX: 200,
      clientY: 150,
    } as MouseEvent

    act(() => {
      result.current.handleColumnEnter(0, mockRect)
    })

    act(() => {
      result.current.handleColumnMove(mockEvent, 'test-item')
    })

    // Fallback: x = clientX + 12, y = clientY - 12
    expect(result.current.tooltip.visible).toBe(true)
    expect(result.current.tooltip.x).toBe(212)
    expect(result.current.tooltip.y).toBe(138)
    expect(result.current.tooltip.item).toBe('test-item')
  })

  it('should be generic over item type', () => {
    interface MyItem {
      name: string
      value: number
    }
    const { result } = renderHook(() => useVerticalColumnTooltip<MyItem>())
    const mockRect = { right: 100, left: 50 } as DOMRect
    const item: MyItem = { name: 'Test', value: 42 }
    const mockEvent = { clientX: 100, clientY: 100 } as MouseEvent

    act(() => {
      result.current.handleColumnEnter(0, mockRect)
    })
    act(() => {
      result.current.handleColumnMove(mockEvent, item)
    })

    expect(result.current.tooltip.item).toEqual({ name: 'Test', value: 42 })
  })
})

// ---------------------------------------------------------------------------
// VerticalYAxis
// ---------------------------------------------------------------------------
describe('VerticalYAxis', () => {
  it('should render tick labels', () => {
    render(
      <VerticalYAxis
        ticks={[0, 25, 50, 75, 100]}
        axisMax={100}
        drawingHeight={250}
        barsHeight={266}
      />
    )
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('should position ticks based on drawingHeight ratio', () => {
    const { container } = render(
      <VerticalYAxis ticks={[0, 50, 100]} axisMax={100} drawingHeight={200} barsHeight={216} />
    )
    const ticks = container.querySelectorAll('span')
    // tick 0 -> bottom: 0px, tick 50 -> bottom: 100px, tick 100 -> bottom: 200px
    expect(ticks[0]).toHaveStyle({ bottom: '0px' })
    expect(ticks[1]).toHaveStyle({ bottom: '100px' })
    expect(ticks[2]).toHaveStyle({ bottom: '200px' })
  })

  it('should set container height to barsHeight', () => {
    const { container } = render(
      <VerticalYAxis ticks={[0, 100]} axisMax={100} drawingHeight={200} barsHeight={216} />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ height: '216px' })
  })

  it('should accept custom formatTick function', () => {
    render(
      <VerticalYAxis
        ticks={[0, 50, 100]}
        axisMax={100}
        drawingHeight={200}
        barsHeight={216}
        formatTick={(t) => `${t}%`}
      />
    )
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('should default to String(tick) formatting', () => {
    render(<VerticalYAxis ticks={[10]} axisMax={100} drawingHeight={200} barsHeight={216} />)
    expect(screen.getByText('10')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// VerticalXAxis
// ---------------------------------------------------------------------------
describe('VerticalXAxis', () => {
  it('should render straight labels by default', () => {
    render(<VerticalXAxis labels={['A', 'B', 'C']} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('should apply rotated styles when rotated=true', () => {
    const { container } = render(<VerticalXAxis labels={['Long Label']} rotated />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ height: '72px' })
  })

  it('should apply transform rotate(-40deg) to rotated labels', () => {
    render(<VerticalXAxis labels={['Label']} rotated />)
    const label = screen.getByText('Label')
    expect(label).toHaveStyle({ transform: 'rotate(-40deg)' })
  })

  it('should apply whiteSpace and maxWidth to rotated labels', () => {
    render(<VerticalXAxis labels={['Label']} rotated />)
    const label = screen.getByText('Label')
    expect(label).toHaveStyle({ whiteSpace: 'nowrap', maxWidth: '80px' })
  })

  it('should accept custom marginLeft', () => {
    const { container } = render(<VerticalXAxis labels={['A']} marginLeft="3rem" />)
    const wrapper = container.firstChild as HTMLElement
    // Inline style, not computed: jsdom >=30 resolves computed lengths to
    // pixels, so `toHaveStyle` would compare against `48px`.
    expect(wrapper.style.marginLeft).toBe('3rem')
  })

  it('should accept custom height for rotated', () => {
    const { container } = render(<VerticalXAxis labels={['A']} rotated height="80px" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ height: '80px' })
  })

  it('should not set a fixed height for straight labels', () => {
    const { container } = render(<VerticalXAxis labels={['A']} />)
    const wrapper = container.firstChild as HTMLElement
    // Straight labels should not have a height style attribute set
    expect(wrapper.style.height).toBe('')
  })

  it('should apply sparse column sizing when provided', () => {
    const sparseSizing: ColumnSizing = { mode: 'sparse', maxWidth: 80, gap: 16, columnPadding: 4 }
    const { container } = render(
      <VerticalXAxis labels={['A', 'B', 'C']} columnSizing={sparseSizing} />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('justify-center')
    expect(wrapper.style.gap).toBe('16px')
  })

  it('should apply maxWidth to each label in sparse mode', () => {
    const sparseSizing: ColumnSizing = { mode: 'sparse', maxWidth: 80, gap: 16, columnPadding: 4 }
    const { container } = render(<VerticalXAxis labels={['A', 'B']} columnSizing={sparseSizing} />)
    const labelDivs = container.querySelectorAll('[style*="max-width"]')
    expect(labelDivs.length).toBe(2)
    for (const div of labelDivs) {
      expect((div as HTMLElement).style.maxWidth).toBe('80px')
    }
  })

  it('should not apply sparse layout in normal mode', () => {
    const normalSizing: ColumnSizing = { mode: 'normal', maxWidth: null, gap: 4, columnPadding: 4 }
    const { container } = render(
      <VerticalXAxis labels={['A', 'B', 'C', 'D', 'E']} columnSizing={normalSizing} />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain('justify-center')
    // Labels should still be flex-1
    const flexLabels = container.querySelectorAll('.flex-1')
    expect(flexLabels.length).toBe(5)
  })

  it('should apply sparse layout to rotated labels too', () => {
    const sparseSizing: ColumnSizing = { mode: 'sparse', maxWidth: 80, gap: 16, columnPadding: 4 }
    const { container } = render(
      <VerticalXAxis labels={['A', 'B']} rotated columnSizing={sparseSizing} />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('justify-center')
    expect(wrapper.style.gap).toBe('16px')
  })

  // --- Tick marks ---

  it('should render tick marks for each rotated label', () => {
    const { container } = render(<VerticalXAxis labels={['A', 'B', 'C']} rotated />)
    const ticks = container.querySelectorAll('[style*="height: 6px"]')
    expect(ticks.length).toBe(3)
  })

  it('should not render tick marks for straight labels', () => {
    const { container } = render(<VerticalXAxis labels={['A', 'B', 'C']} />)
    // No tick divs with border-l + height 6px in straight mode
    const ticks = container.querySelectorAll('[style*="height: 6px"]')
    expect(ticks.length).toBe(0)
  })

  // --- Rotated label anchoring (text-end near tick) ---

  it('should anchor rotated label text-end near tick', () => {
    render(<VerticalXAxis labels={['Label']} rotated />)
    const label = screen.getByText('Label')
    // right: 50% positions text's right edge at column center
    expect(label).toHaveStyle({ right: '50%' })
    // transformOrigin: top right pivots from text end
    expect(label).toHaveStyle({ transformOrigin: 'top right' })
  })
})

// ---------------------------------------------------------------------------
// ColumnHoverOverlay
// ---------------------------------------------------------------------------
describe('ColumnHoverOverlay', () => {
  it('should set width based on itemCount', () => {
    const { container } = render(
      <ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />
    )
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.width).toBe('25%') // 100/4
  })

  it('should set opacity to 0 when hoveredIndex is null', () => {
    const { container } = render(
      <ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />
    )
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('0')
  })

  it('should set opacity to 1 when hoveredIndex is set', () => {
    const { container } = render(
      <ColumnHoverOverlay itemCount={4} hoveredIndex={2} lastIndex={2} />
    )
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('1')
  })

  it('should position at hoveredIndex when hovered', () => {
    const { container } = render(
      <ColumnHoverOverlay itemCount={4} hoveredIndex={2} lastIndex={2} />
    )
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.transform).toBe('translateX(200%)') // 2 * 100%
  })

  it('should position at lastIndex when not hovered', () => {
    const { container } = render(
      <ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={3} />
    )
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.transform).toBe('translateX(300%)') // 3 * 100%
  })

  it('should have correct structural and animation classes', () => {
    const { container } = render(
      <ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />
    )
    const overlay = container.firstChild as HTMLElement
    // Vertical positioning (top/bottom) is via inline styles, not inset-y-0 class
    for (const cls of [
      'absolute',
      'pointer-events-none',
      'left-0',
      'z-0',
      'rounded',
      'bg-foreground/[0.06]',
    ]) {
      expect(overlay.className).toContain(cls)
    }
  })
})

// ---------------------------------------------------------------------------
// VerticalTooltipShell
// ---------------------------------------------------------------------------
describe('VerticalTooltipShell', () => {
  it('should not render children when visible is false', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <VerticalTooltipShell visible={false} x={100} y={100} tooltipRef={ref}>
        <span>Tooltip Content</span>
      </VerticalTooltipShell>
    )
    expect(screen.queryByText('Tooltip Content')).not.toBeInTheDocument()
  })

  it('should render children when visible is true', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <VerticalTooltipShell visible={true} x={100} y={200} tooltipRef={ref}>
        <span>Tooltip Content</span>
      </VerticalTooltipShell>
    )
    expect(screen.getByText('Tooltip Content')).toBeInTheDocument()
  })

  it('should position at the given x,y coordinates', () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(
      <VerticalTooltipShell visible={true} x={150} y={250} tooltipRef={ref}>
        <span>Content</span>
      </VerticalTooltipShell>
    )
    const shell = container.firstChild as HTMLElement
    expect(shell).toHaveStyle({ left: '150px', top: '250px' })
  })

  it('should forward tooltipRef to the shell div', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <VerticalTooltipShell visible={true} x={0} y={0} tooltipRef={ref}>
        <span>Content</span>
      </VerticalTooltipShell>
    )
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })
})

// ---------------------------------------------------------------------------
// getNiceTicks
// ---------------------------------------------------------------------------
describe('getNiceTicks', () => {
  it('produces unique ticks when max is 1', () => {
    const ticks = getNiceTicks(1)
    const unique = [...new Set(ticks)]
    expect(ticks).toEqual(unique)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1)
  })

  it('produces unique ticks when max is 2', () => {
    const ticks = getNiceTicks(2)
    const unique = [...new Set(ticks)]
    expect(ticks).toEqual(unique)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(2)
  })

  it('produces unique ticks when max is 3', () => {
    const ticks = getNiceTicks(3)
    const unique = [...new Set(ticks)]
    expect(ticks).toEqual(unique)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(3)
  })
})

describe('getNiceTicks — niceResidual branches', () => {
  it('returns [0] for max <= 0', () => {
    expect(getNiceTicks(0)).toEqual([0])
    expect(getNiceTicks(-5)).toEqual([0])
  })

  it('residual <= 1.5 path: max=5 produces interval=1', () => {
    expect(getNiceTicks(5)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('residual <= 3 path: max=10 produces interval=2', () => {
    expect(getNiceTicks(10)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('residual <= 3 path: max=80 produces interval=20', () => {
    expect(getNiceTicks(80)).toEqual([0, 20, 40, 60, 80])
  })

  it('residual <= 3 path: max=100 produces interval=20', () => {
    expect(getNiceTicks(100)).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('residual <= 7 path: max=35 produces interval=5', () => {
    expect(getNiceTicks(35)).toEqual([0, 5, 10, 15, 20, 25, 30, 35])
  })

  it('residual > 7 path: max=400 produces interval=100', () => {
    expect(getNiceTicks(400)).toEqual([0, 100, 200, 300, 400])
  })

  it('overshoot ceiling appends extra tick when data max meaningfully exceeds last tick', () => {
    // max=11 with count=5 → rawInterval=2.2, residual<=3, interval=2; ticks=[0,2,4,6,8,10]
    // 11 vs last=10 overshoot is (11-10)/2 = 0.5 > 0.02 → appends ceil(11/2)*2 = 12
    expect(getNiceTicks(11)).toEqual([0, 2, 4, 6, 8, 10, 12])
  })

  it('overshoot ceiling skipped when data max barely exceeds last tick', () => {
    // max=100.01 with count=5: rawInterval=20.002, residual<=3, interval=20; ticks=[0..100]
    // 100.01 vs last=100 overshoot is (0.01)/20 = 0.0005 < 0.02 → skipped
    expect(getNiceTicks(100.01)).toEqual([0, 20, 40, 60, 80, 100])
  })
})

// ---------------------------------------------------------------------------
// Existing exports (sanity check — ensure we didn't break them)
// ---------------------------------------------------------------------------
describe('existing exports sanity', () => {
  it('should still export getNiceTicks', () => {
    expect(typeof getNiceTicks).toBe('function')
    expect(getNiceTicks(100)).toEqual(expect.arrayContaining([0]))
  })

  it('should still export calculateBarSizing', () => {
    expect(typeof calculateBarSizing).toBe('function')
  })

  it('should still export useChartTooltip', () => {
    expect(typeof useChartTooltip).toBe('function')
  })
})
