import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
})
