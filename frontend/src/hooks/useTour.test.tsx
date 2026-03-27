import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTour } from './useTour'
import * as tourRegistry from '../tours/tourRegistry'
import * as tourStorage from '../tours/tourStorage'
import type { TourDefinition, LayerDefinition } from '../tours/types'

// Mock the modules
vi.mock('../tours/tourStorage')
vi.mock('../tours/tourRegistry')
vi.mock('./useSolverConfig', () => ({
  useSolverConfigValue: vi.fn(() => 30),
  useSolverConfig: vi.fn(() => ({ data: undefined })),
}))
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
  layers: [],
  steps: [
    { element: '[data-tour="debug-header"]', popover: { title: 'Test', description: 'Step 1' } },
  ],
  isReady: () => true,
}

const mockLayerDefinition: LayerDefinition = {
  id: 'metrics-header',
  version: 1,
  steps: [
    {
      element: '[data-tour="metrics-header"]',
      popover: { title: 'Metrics', description: 'Header layer step' },
    },
  ],
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
    vi.mocked(tourRegistry.loadLayerDefinition).mockResolvedValue(mockLayerDefinition)
    vi.mocked(tourStorage.isLayerSeen).mockReturnValue(true)
    vi.mocked(tourStorage.isLayerStaleOrUnseen).mockReturnValue(false)
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

  it('does not auto-start tour when tour has no layers', async () => {
    renderHook(() => useTour())

    await flushAndAdvance(1000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('provides a replay function that starts the tour in manual mode', async () => {
    // Mock querySelector so readiness check passes for the first step element
    const mockElement = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="debug-header"]') return mockElement
      return originalQuerySelector(selector)
    })

    const { result } = renderHook(() => useTour())

    // Let the definition load
    await flushAndAdvance(1000)

    // Tour should NOT have auto-started (no layers)
    expect(mockDrive).not.toHaveBeenCalled()

    // Now replay
    act(() => {
      result.current.replay()
    })

    await flushAndAdvance(1000)

    expect(mockDrive).toHaveBeenCalled()

    vi.mocked(document.querySelector).mockRestore()
  })

  it('does not start tour when first step element is not in DOM', async () => {
    // The readiness check uses first step's element selector
    // Since we're in a test env with no DOM, querySelector returns null
    const defWithElement: TourDefinition = {
      ...mockTourDefinition,
      isReady: () => false,
    }
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(defWithElement)

    const { result } = renderHook(() => useTour())

    await flushAndAdvance(1000)

    // Trigger replay and wait for retry exhaustion
    act(() => {
      result.current.replay()
    })

    await flushAndAdvance(6000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('destroys driver instance when readiness timeout is exhausted', async () => {
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

  describe('layer auto-play', () => {
    it('auto-plays when tour has unseen layers', async () => {
      const tourWithLayers: TourDefinition = {
        ...mockTourDefinition,
        id: 'retention-overview',
        layers: ['metrics-header'],
      }
      vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('retention-overview')
      vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(tourWithLayers)
      vi.mocked(tourStorage.isLayerSeen).mockReturnValue(false)

      // Mock querySelector to return a truthy element for readiness
      const mockElement = document.createElement('div')
      const originalQuerySelector = document.querySelector.bind(document)
      vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
        if (selector === '[data-tour="metrics-header"]') return mockElement
        return originalQuerySelector(selector)
      })

      renderHook(() => useTour())

      // Flush promises for loadTourDefinition + loadLayerDefinition chain + setLoadedPath re-render
      await flushAndAdvance(0)
      await flushAndAdvance(0)
      await flushAndAdvance(0)

      // Advance past readiness check timer (AUTO_START_DELAY = 300ms)
      await flushAndAdvance(1000)

      expect(mockDrive).toHaveBeenCalled()

      vi.mocked(document.querySelector).mockRestore()
    })

    it('does not auto-play when all layers are seen', async () => {
      const tourWithLayers: TourDefinition = {
        ...mockTourDefinition,
        id: 'retention-overview',
        layers: ['metrics-header'],
      }
      vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('retention-overview')
      vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(tourWithLayers)
      vi.mocked(tourStorage.isLayerSeen).mockReturnValue(true)

      renderHook(() => useTour())

      await flushAndAdvance(2000)

      expect(mockDrive).not.toHaveBeenCalled()
    })
  })
})
