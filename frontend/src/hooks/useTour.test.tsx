import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTour } from './useTour'
import * as tourStorage from '../tours/tourStorage'
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
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(false)
    vi.mocked(tourStorage.markTourCompleted).mockImplementation(() => {})
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

  it('auto-starts tour when not yet completed', async () => {
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(false)

    renderHook(() => useTour())

    // Flush promise resolution + advance past all delays
    await flushAndAdvance(1000)

    expect(mockDrive).toHaveBeenCalled()
  })

  it('does not auto-start tour when already completed', async () => {
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(true)

    renderHook(() => useTour())

    await flushAndAdvance(1000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('provides a replay function that starts the tour regardless of completion', async () => {
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(true)

    const { result } = renderHook(() => useTour())

    // Let the definition load
    await flushAndAdvance(1000)

    // Tour should NOT have auto-started (completed)
    expect(mockDrive).not.toHaveBeenCalled()

    // Now replay
    act(() => {
      result.current.replay()
    })

    await flushAndAdvance(1000)

    expect(mockDrive).toHaveBeenCalled()
  })

  it('cleans up driver instance on unmount', async () => {
    const { unmount } = renderHook(() => useTour())

    // Let tour auto-start so driver instance is created
    await flushAndAdvance(1000)

    unmount()

    expect(mockDestroy).toHaveBeenCalled()
  })

  it('does not auto-start when no route has a tour', async () => {
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue(null)

    renderHook(() => useTour())

    await flushAndAdvance(1000)

    expect(mockDrive).not.toHaveBeenCalled()
  })
})
