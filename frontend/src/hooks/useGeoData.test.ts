/**
 * Tests for useGeoData hooks.
 *
 * Verifies useGeoPagePrefetch defers inactive-category prefetches via
 * requestIdleCallback so the active tab can paint and become interactive
 * before competing for resources. Falls back to setTimeout when
 * requestIdleCallback is unavailable.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import { useGeoPagePrefetch } from './useGeoData'

// Mock the auth hook so renderHook doesn't need AuthContext
vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: vi.fn(),
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

describe('useGeoPagePrefetch', () => {
  let mockIdleCallback: ReturnType<typeof vi.fn>
  let mockCancelIdle: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockIdleCallback = vi.fn().mockReturnValue(42)
    mockCancelIdle = vi.fn()
    vi.stubGlobal('requestIdleCallback', mockIdleCallback)
    vi.stubGlobal('cancelIdleCallback', mockCancelIdle)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defers prefetch via requestIdleCallback rather than running synchronously', () => {
    renderHook(() => useGeoPagePrefetch('city', 2025, true), { wrapper: createWrapper() })

    expect(mockIdleCallback).toHaveBeenCalled()
  })

  it('cancels pending idle callback on unmount', () => {
    const { unmount } = renderHook(() => useGeoPagePrefetch('city', 2025, true), {
      wrapper: createWrapper(),
    })

    unmount()

    expect(mockCancelIdle).toHaveBeenCalledWith(42)
  })

  it('falls back to window.setTimeout when requestIdleCallback is unavailable', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    renderHook(() => useGeoPagePrefetch('city', 2025, true), { wrapper: createWrapper() })

    expect(setTimeoutSpy).toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
  })
})
