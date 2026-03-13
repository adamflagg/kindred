/**
 * Tests for useChartZoom hook.
 *
 * Covers:
 * - #510: separate zoom state per chart (no cross-contamination)
 * - #511: isZoomedIn is false when zoom covers full data range
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChartZoom } from './useChartZoom'

describe('useChartZoom', () => {
  it('starts with no zoom and isZoomedIn false', () => {
    const { result } = renderHook(() => useChartZoom(10))

    expect(result.current.zoomRange).toBeNull()
    expect(result.current.isZoomedIn).toBe(false)
  })

  it('sets isZoomedIn true when zoom is a subset of data', () => {
    const { result } = renderHook(() => useChartZoom(10))

    act(() => {
      result.current.handleBrushChange({ startIndex: 2, endIndex: 7 })
    })

    expect(result.current.zoomRange).toEqual([2, 7])
    expect(result.current.isZoomedIn).toBe(true)
  })

  it('sets isZoomedIn false when zoom covers full range (#511)', () => {
    const { result } = renderHook(() => useChartZoom(10))

    act(() => {
      result.current.handleBrushChange({ startIndex: 0, endIndex: 9 })
    })

    expect(result.current.zoomRange).toEqual([0, 9])
    expect(result.current.isZoomedIn).toBe(false)
  })

  it('resets zoom state', () => {
    const { result } = renderHook(() => useChartZoom(10))

    act(() => {
      result.current.handleBrushChange({ startIndex: 2, endIndex: 7 })
    })
    expect(result.current.isZoomedIn).toBe(true)

    act(() => {
      result.current.resetZoom()
    })

    expect(result.current.zoomRange).toBeNull()
    expect(result.current.isZoomedIn).toBe(false)
  })

  it('deduplicates identical brush changes', () => {
    const { result } = renderHook(() => useChartZoom(10))

    act(() => {
      result.current.handleBrushChange({ startIndex: 2, endIndex: 7 })
    })
    const firstRange = result.current.zoomRange

    act(() => {
      result.current.handleBrushChange({ startIndex: 2, endIndex: 7 })
    })

    // Same reference means no re-render triggered
    expect(result.current.zoomRange).toBe(firstRange)
  })

  it('ignores brush changes with undefined indexes', () => {
    const { result } = renderHook(() => useChartZoom(10))

    act(() => {
      result.current.handleBrushChange({})
    })

    expect(result.current.zoomRange).toBeNull()
  })

  it('two hook instances have independent state (#510)', () => {
    const { result: weekly } = renderHook(() => useChartZoom(20))
    const { result: daily } = renderHook(() => useChartZoom(100))

    act(() => {
      weekly.current.handleBrushChange({ startIndex: 3, endIndex: 10 })
    })

    expect(weekly.current.zoomRange).toEqual([3, 10])
    expect(weekly.current.isZoomedIn).toBe(true)
    expect(daily.current.zoomRange).toBeNull()
    expect(daily.current.isZoomedIn).toBe(false)
  })

  it('updates isZoomedIn when dataLength changes', () => {
    const { result, rerender } = renderHook(({ length }) => useChartZoom(length), {
      initialProps: { length: 10 },
    })

    // Zoom to end of 10-item dataset
    act(() => {
      result.current.handleBrushChange({ startIndex: 0, endIndex: 9 })
    })
    expect(result.current.isZoomedIn).toBe(false) // full range

    // Data grows to 20 items — same range is now a subset
    rerender({ length: 20 })
    expect(result.current.isZoomedIn).toBe(true)
  })
})
