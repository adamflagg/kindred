import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTour } from './useTour'
import * as tourRegistry from '../tours/tourRegistry'
import * as tourStorage from '../tours/tourStorage'
import type { TourDefinition, LayerDefinition } from '../tours/types'

vi.mock('../tours/tourStorage')
vi.mock('../tours/tourRegistry')
vi.mock('react-router', () => ({
  useLocation: vi.fn(() => ({ pathname: '/summer/debug' })),
}))

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

async function flushAndAdvance(ms: number) {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
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
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })
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

  it('never auto-starts the tour on mount, even with unseen layers', async () => {
    const tourWithLayers: TourDefinition = {
      ...mockTourDefinition,
      id: 'retention-overview',
      layers: ['metrics-header'],
    }
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('retention-overview')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(tourWithLayers)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })

    renderHook(() => useTour())
    await flushAndAdvance(5000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('replay() starts the tour', async () => {
    const mockElement = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="debug-header"]') return mockElement
      return originalQuerySelector(selector)
    })

    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)
    expect(mockDrive).not.toHaveBeenCalled()

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)
    expect(mockDrive).toHaveBeenCalled()

    vi.mocked(document.querySelector).mockRestore()
  })

  it('does not start tour when first step element is not in DOM', async () => {
    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(6000)

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('destroys driver instance when readiness timeout is exhausted', async () => {
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

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    unmount()
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('replay() with a seen layer at current version skips the layer', async () => {
    const tourWithLayers: TourDefinition = {
      ...mockTourDefinition,
      id: 'retention-overview',
      layers: ['metrics-header'],
    }
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('retention-overview')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(tourWithLayers)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({
      layers: {
        'metrics-header': {
          layerId: 'metrics-header',
          completedVersion: 1,
          completedAt: new Date().toISOString(),
        },
      },
    })

    const mockElement = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="debug-header"]') return mockElement
      return originalQuerySelector(selector)
    })

    const { driver } = await import('driver.js')
    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    expect(driver).toHaveBeenCalled()
    const lastCall = vi.mocked(driver).mock.calls.at(-1)?.[0]
    expect(lastCall?.steps).toHaveLength(1)
    expect(lastCall?.steps?.[0]?.element).toBe('[data-tour="debug-header"]')

    vi.mocked(document.querySelector).mockRestore()
  })
})
