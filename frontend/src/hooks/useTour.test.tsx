import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTour } from './useTour'
import * as tourRegistry from '../tours/tourRegistry'
import type { TourDefinition } from '../tours/types'

// Mock the modules
vi.mock('../tours/tourStorage')
vi.mock('../tours/tourRegistry')
vi.mock('react-router', () => ({
  useLocation: vi.fn(() => ({ pathname: '/summer/debug' })),
}))

// Mock driver.js - the driver function
const mockDrive = vi.fn()
const mockDestroy = vi.fn()
const mockDriverInstance = {
  drive: mockDrive,
  destroy: mockDestroy,
  isActive: vi.fn(() => false),
}

vi.mock('driver.js', () => ({
  driver: vi.fn(() => mockDriverInstance),
}))

const mockTourDefinition: TourDefinition = {
  id: 'debug',
  version: 1,
  steps: [
    { element: '[data-tour="debug-header"]', popover: { title: 'Test', description: 'Step 1' } },
  ],
  isReady: () => true,
}

/** Flush microtasks (resolved promises) and advance fake timers */
async function flushAndAdvance(ms: number) {
  // Flush microtasks first (promise resolutions)
  await act(async () => {
    await Promise.resolve()
  })
  // Advance fake timers
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  // Flush any remaining microtasks
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useTour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(mockTourDefinition)
    mockDrive.mockClear()
    mockDestroy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns tourId when a tour exists for the current route', async () => {
    const { result } = renderHook(() => useTour())

    await flushAndAdvance(0)

    expect(result.current.tourId).toBe('debug')
  })

  it('returns null tourId when no tour exists for the route', async () => {
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue(null)

    const { result } = renderHook(() => useTour())

    await flushAndAdvance(0)

    expect(result.current.tourId).toBeNull()
  })

  it('does not auto-start tour on route change', async () => {
    renderHook(() => useTour())

    await flushAndAdvance(1000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('provides a replay function that starts the tour', async () => {
    const { result } = renderHook(() => useTour())

    // Let the definition load
    await flushAndAdvance(1000)

    // Tour should NOT have auto-started
    expect(mockDrive).not.toHaveBeenCalled()

    // Now replay
    act(() => {
      result.current.replay()
    })

    await flushAndAdvance(1000)

    expect(mockDrive).toHaveBeenCalled()
  })

  it('does not start tour when isReady() never returns true', async () => {
    const neverReadyDef: TourDefinition = {
      ...mockTourDefinition,
      isReady: () => false,
    }
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(neverReadyDef)

    const { result } = renderHook(() => useTour())

    await flushAndAdvance(1000)

    // Trigger replay and wait for retry exhaustion
    act(() => {
      result.current.replay()
    })

    await flushAndAdvance(6000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('destroys driver instance when isReady() timeout is exhausted', async () => {
    const neverReadyDef: TourDefinition = {
      ...mockTourDefinition,
      isReady: () => false,
    }
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(neverReadyDef)

    const { result } = renderHook(() => useTour())

    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })

    await flushAndAdvance(6000)

    expect(mockDestroy).toHaveBeenCalled()
  })

  it('cleans up driver instance on unmount', async () => {
    const { result, unmount } = renderHook(() => useTour())

    await flushAndAdvance(1000)

    // Trigger replay so driver instance is created
    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    unmount()

    expect(mockDestroy).toHaveBeenCalled()
  })
})
