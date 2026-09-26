import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computeAnchoredPosition, useAnchoredOverlay, type AnchorRect } from './useAnchoredOverlay'

const VIEWPORT = { width: 1000, height: 800 }
const SIZE = { width: 220, height: 150 }

describe('computeAnchoredPosition — below', () => {
  it('centres below the anchor', () => {
    const anchor = { top: 100, left: 400, width: 40, height: 40 }
    expect(computeAnchoredPosition(anchor, SIZE, VIEWPORT, 'below')).toEqual({
      top: 148,
      left: 310,
    })
  })

  it('flips above using the MEASURED height, not an estimate', () => {
    const anchor = { top: 700, left: 400, width: 40, height: 40 }
    // 700 - 150 - 8. A hard-coded 90 would have put it at 602.
    expect(computeAnchoredPosition(anchor, SIZE, VIEWPORT, 'below').top).toBe(542)
  })

  it('keeps inside the right and left edges', () => {
    expect(
      computeAnchoredPosition(
        { top: 100, left: 980, width: 10, height: 10 },
        SIZE,
        VIEWPORT,
        'below',
        8,
        10
      ).left
    ).toBe(770)
    expect(
      computeAnchoredPosition(
        { top: 100, left: 0, width: 10, height: 10 },
        SIZE,
        VIEWPORT,
        'below',
        8,
        10
      ).left
    ).toBe(10)
  })
})

describe('computeAnchoredPosition — beside', () => {
  it('sits to the right of the anchor, nudged up 6px', () => {
    const anchor = { top: 100, left: 100, width: 200, height: 60 }
    expect(computeAnchoredPosition(anchor, SIZE, VIEWPORT, 'beside')).toEqual({
      top: 94,
      left: 308,
    })
  })

  it('flips to the left when the right has no room', () => {
    const anchor = { top: 100, left: 700, width: 200, height: 60 }
    expect(computeAnchoredPosition(anchor, SIZE, VIEWPORT, 'beside').left).toBe(472)
  })

  it('drops below when neither side has room, and clamps to the viewport', () => {
    const narrow = { width: 400, height: 800 }
    const anchor = { top: 700, left: 100, width: 200, height: 60 }
    const pos = computeAnchoredPosition(anchor, SIZE, narrow, 'beside')
    expect(pos.left).toBe(100)
    expect(pos.top).toBe(800 - 150 - 8)
  })
})

function Probe({ anchor }: { anchor: AnchorRect }) {
  const { ref, position } = useAnchoredOverlay<HTMLDivElement>({
    open: true,
    getAnchorRect: () => anchor,
    placement: 'below',
  })
  return (
    <div
      ref={ref}
      data-testid="overlay"
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}
    >
      overlay
    </div>
  )
}

describe('useAnchoredOverlay', () => {
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 220,
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 150,
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })
  afterEach(() => {
    if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalWidth)
    if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalHeight)
  })

  it('places the overlay against its measured size', () => {
    render(<Probe anchor={{ top: 700, left: 400, width: 40, height: 40 }} />)
    expect(screen.getByTestId('overlay').style.top).toBe('542px')
  })

  it('re-places on scroll and never unmounts the overlay', () => {
    const anchor = { top: 100, left: 400, width: 40, height: 40 }
    render(<Probe anchor={anchor} />)
    anchor.top = 200
    fireEvent.scroll(window)
    expect(screen.getByTestId('overlay').style.top).toBe('248px')
  })
})
