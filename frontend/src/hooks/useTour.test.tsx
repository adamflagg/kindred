import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('useTour', () => {
  beforeEach(() => {
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue('debug')
    vi.mocked(tourRegistry.loadTourDefinition).mockResolvedValue(mockTourDefinition)
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(false)
    vi.mocked(tourStorage.markTourCompleted).mockImplementation(() => {})
    mockDrive.mockClear()
    mockDestroy.mockClear()
  })

  it('returns tourId when a tour exists for the current route', async () => {
    const { result } = renderHook(() => useTour())

    // Wait for async tour loading
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(result.current.tourId).toBe('debug')
  })

  it('returns null tourId when no tour exists for the route', async () => {
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue(null)

    const { result } = renderHook(() => useTour())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(result.current.tourId).toBeNull()
  })

  it('auto-starts tour when not yet completed', async () => {
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(false)

    renderHook(() => useTour())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(mockDrive).toHaveBeenCalled()
  })

  it('does not auto-start tour when already completed', async () => {
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(true)

    renderHook(() => useTour())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('provides a replay function that starts the tour regardless of completion', async () => {
    vi.mocked(tourStorage.isTourCompleted).mockReturnValue(true)

    const { result } = renderHook(() => useTour())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    act(() => {
      result.current.replay()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(mockDrive).toHaveBeenCalled()
  })

  it('cleans up driver instance on unmount', async () => {
    const { unmount } = renderHook(() => useTour())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    unmount()

    expect(mockDestroy).toHaveBeenCalled()
  })

  it('does not auto-start when no route has a tour', async () => {
    vi.mocked(tourRegistry.getTourIdForRoute).mockReturnValue(null)

    renderHook(() => useTour())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(mockDrive).not.toHaveBeenCalled()
  })
})
