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
const mockMoveNext = vi.fn()
const mockMovePrevious = vi.fn()
const mockDriverInstance = {
  drive: mockDrive,
  destroy: mockDestroy,
  moveNext: mockMoveNext,
  movePrevious: mockMovePrevious,
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
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(mockTourDefinition)
    vi.mocked(tourRegistry.loadLayerDefinition).mockResolvedValue(mockLayerDefinition)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })
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

  it('replay() with a malformed completedAt treats the layer as stale and includes it', async () => {
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
          completedAt: 'not-a-real-timestamp',
        },
      },
    })

    const headerEl = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="metrics-header"]') return headerEl
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
    // Both layer step + page step should be present when completedAt is malformed
    expect(lastCall?.steps).toHaveLength(2)

    vi.mocked(document.querySelector).mockRestore()
  })

  it('rapid double-replay() does not fire drive() on the destroyed prior driver', async () => {
    const headerEl = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="debug-header"]') return headerEl
      return originalQuerySelector(selector)
    })

    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    // First replay queues a checkReady timer (AUTO_START_DELAY = 300ms)
    act(() => {
      result.current.replay()
    })
    // Second replay arrives before the first's checkReady fires
    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    // Only the second driver should reach drive(); the first's queued timer must
    // have been cleared, otherwise drive() fires twice on what's now a destroyed instance.
    expect(mockDrive).toHaveBeenCalledTimes(1)

    vi.mocked(document.querySelector).mockRestore()
  })

  it('clears cached tour definition synchronously when route changes', async () => {
    const reactRouter = await import('react-router')
    const useLocationSpy = vi.mocked(reactRouter.useLocation)

    // Page A: debug — loads successfully
    useLocationSpy.mockReturnValue({
      pathname: '/summer/debug',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    })
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(mockTourDefinition)

    const headerEl = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="debug-header"]') return headerEl
      return originalQuerySelector(selector)
    })

    const { result, rerender } = renderHook(() => useTour())
    await flushAndAdvance(0)

    // Pivot to Page B: retention — but make its tour-definition load HANG so the
    // race window is wide open (definitionRef for A is still set at this point
    // without the fix).
    useLocationSpy.mockReturnValue({
      pathname: '/analytics/retention',
      search: '',
      hash: '',
      state: null,
      key: 'pageB',
    })
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('retention-overview')
    vi.mocked(tourRegistry.loadTourDefinition).mockReturnValue(new Promise(() => {}))

    rerender()
    // Click replay before Page B's tour finishes loading.
    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    // No tour should have started — definitionRef must have been cleared on route change.
    expect(mockDrive).not.toHaveBeenCalled()

    vi.mocked(document.querySelector).mockRestore()
  })

  it('replay() — Next click waits for target step selector before advancing', async () => {
    const twoStepTour: TourDefinition = {
      id: 'debug',
      version: 1,
      layers: [],
      steps: [
        {
          element: '[data-tour="step-one"]',
          popover: { title: 'One', description: 'First' },
        },
        {
          element: '[data-tour="step-two"]',
          popover: { title: 'Two', description: 'Second' },
        },
      ],
    }
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(twoStepTour)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })

    const stepOneEl = document.createElement('div')
    let stepTwoExists = false
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="step-one"]') return stepOneEl
      if (selector === '[data-tour="step-two"]') return stepTwoExists ? stepOneEl : null
      return originalQuerySelector(selector)
    })

    const driverModule = await import('driver.js')
    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)
    expect(mockDrive).toHaveBeenCalled()

    const lastCall = vi.mocked(driverModule.driver).mock.calls.at(-1)?.[0]
    expect(lastCall?.onNextClick).toBeDefined()

    act(() => {
      lastCall!.onNextClick!(undefined, twoStepTour.steps[0] as never, {
        config: lastCall!,
        state: { activeIndex: 0 } as never,
        driver: mockDriverInstance as never,
      })
    })
    await flushAndAdvance(1000)
    expect(mockMoveNext).not.toHaveBeenCalled()

    stepTwoExists = true
    await flushAndAdvance(1000)
    expect(mockMoveNext).toHaveBeenCalledTimes(1)

    vi.mocked(document.querySelector).mockRestore()
  })

  it('replay() — Next click on the last step destroys the tour', async () => {
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(mockTourDefinition)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })

    const el = document.createElement('div')
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="debug-header"]') return el
      return originalQuerySelector(selector)
    })

    const driverModule = await import('driver.js')
    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    const lastCall = vi.mocked(driverModule.driver).mock.calls.at(-1)?.[0]
    act(() => {
      lastCall!.onNextClick!(undefined, mockTourDefinition.steps[0] as never, {
        config: lastCall!,
        state: { activeIndex: 0 } as never,
        driver: mockDriverInstance as never,
      })
    })

    expect(mockDestroy).toHaveBeenCalled()
    expect(mockMoveNext).not.toHaveBeenCalled()

    vi.mocked(document.querySelector).mockRestore()
  })

  it('replay() — Prev click waits for target step selector before going back', async () => {
    const twoStepTour: TourDefinition = {
      id: 'debug',
      version: 1,
      layers: [],
      steps: [
        {
          element: '[data-tour="step-one"]',
          popover: { title: 'One', description: 'First' },
        },
        {
          element: '[data-tour="step-two"]',
          popover: { title: 'Two', description: 'Second' },
        },
      ],
    }
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(twoStepTour)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })

    const stepTwoEl = document.createElement('div')
    let stepOneExists = false
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="step-two"]') return stepTwoEl
      if (selector === '[data-tour="step-one"]') return stepOneExists ? stepTwoEl : null
      return originalQuerySelector(selector)
    })

    const driverModule = await import('driver.js')
    const { result } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    const lastCall = vi.mocked(driverModule.driver).mock.calls.at(-1)?.[0]
    expect(lastCall?.onPrevClick).toBeDefined()

    act(() => {
      lastCall!.onPrevClick!(undefined, twoStepTour.steps[1] as never, {
        config: lastCall!,
        state: { activeIndex: 1 } as never,
        driver: mockDriverInstance as never,
      })
    })
    await flushAndAdvance(1000)
    expect(mockMovePrevious).not.toHaveBeenCalled()

    stepOneExists = true
    await flushAndAdvance(1000)
    expect(mockMovePrevious).toHaveBeenCalledTimes(1)

    vi.mocked(document.querySelector).mockRestore()
  })

  it('replay() — pending Next-readiness wait is aborted on unmount', async () => {
    const twoStepTour: TourDefinition = {
      id: 'debug',
      version: 1,
      layers: [],
      steps: [
        {
          element: '[data-tour="step-one"]',
          popover: { title: 'One', description: 'First' },
        },
        {
          element: '[data-tour="step-two"]',
          popover: { title: 'Two', description: 'Second' },
        },
      ],
    }
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(twoStepTour)
    vi.mocked(tourStorage.getTourStorage).mockReturnValue({ layers: {} })

    const stepOneEl = document.createElement('div')
    let stepTwoExists = false
    const originalQuerySelector = document.querySelector.bind(document)
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '[data-tour="step-one"]') return stepOneEl
      if (selector === '[data-tour="step-two"]') return stepTwoExists ? stepOneEl : null
      return originalQuerySelector(selector)
    })

    const driverModule = await import('driver.js')
    const { result, unmount } = renderHook(() => useTour())
    await flushAndAdvance(1000)

    act(() => {
      result.current.replay()
    })
    await flushAndAdvance(1000)

    const lastCall = vi.mocked(driverModule.driver).mock.calls.at(-1)?.[0]
    act(() => {
      lastCall!.onNextClick!(undefined, twoStepTour.steps[0] as never, {
        config: lastCall!,
        state: { activeIndex: 0 } as never,
        driver: mockDriverInstance as never,
      })
    })

    act(() => {
      unmount()
    })

    stepTwoExists = true
    await flushAndAdvance(5000)

    expect(mockMoveNext).not.toHaveBeenCalled()

    vi.mocked(document.querySelector).mockRestore()
  })
})
