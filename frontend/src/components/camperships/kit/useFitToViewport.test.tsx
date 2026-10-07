import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFitToViewport } from './useFitToViewport'

describe('useFitToViewport', () => {
  it('fills the window below the box, less 24px, never under 320', () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const element = document.createElement('div')
    element.getBoundingClientRect = () => ({
      top: 300,
      left: 0,
      width: 1200,
      height: 0,
      right: 1200,
      bottom: 300,
      x: 0,
      y: 300,
      toJSON: () => ({}),
    })
    Object.defineProperty(element, 'clientWidth', { value: 1200 })
    const { result } = renderHook(() => useFitToViewport({ current: element }))
    expect(result.current).toEqual({ maxHeight: 576, width: 1200 })
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true })
    act(() => void window.dispatchEvent(new Event('resize')))
    expect(result.current.maxHeight).toBe(320)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('measures again when the page above the box changes height, with no window resize', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    let top = 300
    const element = document.createElement('div')
    element.getBoundingClientRect = () =>
      ({ top, left: 0, width: 1100, height: 0, right: 1100, bottom: top, x: 0, y: top }) as DOMRect
    Object.defineProperty(element, 'clientWidth', { value: 1100 })
    const callbacks: Array<() => void> = []
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback)
        }
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {}
        unobserve() {}
      }
    )
    const { result } = renderHook(() => useFitToViewport({ current: element }))
    expect(result.current.maxHeight).toBe(476)
    // Late content (a notice, a wrapped chip row) pushes the box down: its top moves, the window does not.
    top = 335
    act(() => callbacks.forEach((callback) => callback()))
    expect(result.current.maxHeight).toBe(441)
    expect(observed).toContain(document.body)
  })
})
