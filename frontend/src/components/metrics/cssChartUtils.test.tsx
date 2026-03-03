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
import React, { createRef } from 'react'

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
    expect(sizing.maxWidth).toBe(80)
    expect(sizing.gap).toBe(16)
    expect(sizing.columnPadding).toBe(4)
  })

  it('should return sparse mode for 4 columns', () => {
    const sizing = calculateColumnSizing(4)
    expect(sizing.mode).toBe('sparse')
    expect(sizing.maxWidth).toBe(80)
    expect(sizing.gap).toBe(16)
    expect(sizing.columnPadding).toBe(4)
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
    } as React.MouseEvent

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
    const mockEvent = { clientX: 100, clientY: 100 } as React.MouseEvent

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
    render(<VerticalYAxis ticks={[0, 25, 50, 75, 100]} axisMax={100} drawingHeight={250} barsHeight={266} />)
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

  it('should use default width class w-8', () => {
    const { container } = render(
      <VerticalYAxis ticks={[0, 100]} axisMax={100} drawingHeight={200} barsHeight={216} />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('w-8')
  })

  it('should accept custom width class', () => {
    const { container } = render(
      <VerticalYAxis ticks={[0, 100]} axisMax={100} drawingHeight={200} barsHeight={216} width="w-10" />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('w-10')
    expect(wrapper.className).not.toContain('w-8')
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

  it('should render with border-t and pt-1 classes for straight labels', () => {
    const { container } = render(<VerticalXAxis labels={['A', 'B']} />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('border-t')
    expect(wrapper.className).toContain('pt-1')
  })

  it('should render items as flex-1 text-center for straight labels', () => {
    const { container } = render(<VerticalXAxis labels={['A']} />)
    const item = container.querySelector('.flex-1.text-center')
    expect(item).toBeInTheDocument()
  })

  it('should apply rotated styles when rotated=true', () => {
    const { container } = render(<VerticalXAxis labels={['Long Label']} rotated />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ height: '60px' })
  })

  it('should apply transform rotate(-40deg) to rotated labels', () => {
    render(<VerticalXAxis labels={['Label']} rotated />)
    const label = screen.getByText('Label')
    expect(label).toHaveStyle({ transform: 'rotate(-40deg) translateX(-50%)' })
  })

  it('should apply whiteSpace and maxWidth to rotated labels', () => {
    render(<VerticalXAxis labels={['Label']} rotated />)
    const label = screen.getByText('Label')
    expect(label).toHaveStyle({ whiteSpace: 'nowrap', maxWidth: '100px' })
  })

  it('should accept custom marginLeft', () => {
    const { container } = render(<VerticalXAxis labels={['A']} marginLeft="3rem" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ marginLeft: '3rem' })
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
})

// ---------------------------------------------------------------------------
// ColumnHoverOverlay
// ---------------------------------------------------------------------------
describe('ColumnHoverOverlay', () => {
  it('should render a div with pointer-events-none', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={5} hoveredIndex={null} lastIndex={0} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('should set width based on itemCount', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.width).toBe('25%') // 100/4
  })

  it('should set opacity to 0 when hoveredIndex is null', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('0')
  })

  it('should set opacity to 1 when hoveredIndex is set', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={2} lastIndex={2} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('1')
  })

  it('should position at hoveredIndex when hovered', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={2} lastIndex={2} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.transform).toBe('translateX(200%)') // 2 * 100%
  })

  it('should position at lastIndex when not hovered', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={3} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.transform).toBe('translateX(300%)') // 3 * 100%
  })

  it('should have transition classes for animation', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('transition-[transform,opacity]')
    expect(overlay.className).toContain('duration-150')
  })

  it('should have correct structural classes', () => {
    const { container } = render(<ColumnHoverOverlay itemCount={4} hoveredIndex={null} lastIndex={0} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('absolute')
    expect(overlay.className).toContain('inset-y-0')
    expect(overlay.className).toContain('left-0')
    expect(overlay.className).toContain('z-0')
    expect(overlay.className).toContain('rounded')
    expect(overlay.className).toContain('bg-foreground/[0.06]')
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

  it('should have correct styling classes', () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(
      <VerticalTooltipShell visible={true} x={0} y={0} tooltipRef={ref}>
        <span>Content</span>
      </VerticalTooltipShell>
    )
    const shell = container.firstChild as HTMLElement
    expect(shell.className).toContain('bg-card')
    expect(shell.className).toContain('border-border')
    expect(shell.className).toContain('pointer-events-none')
    expect(shell.className).toContain('fixed')
    expect(shell.className).toContain('z-50')
    expect(shell.className).toContain('rounded-lg')
    expect(shell.className).toContain('border')
    expect(shell.className).toContain('p-3')
    expect(shell.className).toContain('shadow-lg')
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
