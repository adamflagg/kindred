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

// Mock the auth hook so renderHook doesn't need AuthContext.
// The hoisted state object lets individual tests flip `isAuthLoading` before mounting.
const mockAuthState = vi.hoisted(() => ({ isAuthLoading: false }))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: vi.fn(),
    isAuthenticated: true,
    isAuthLoading: mockAuthState.isAuthLoading,
  }),
}))

describe('useGeoPagePrefetch', () => {
  let mockIdleCallback: ReturnType<typeof vi.fn>
  let mockCancelIdle: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockAuthState.isAuthLoading = false
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

  it('skips prefetch while auth is still loading', () => {
    // Per frontend/CLAUDE.md: always gate authenticated calls on useAuth().isLoading.
    // Without this gate, the prefetch fires while auth is restoring → 401 → global
    // handler clears the auth store and redirects to /login.
    mockAuthState.isAuthLoading = true
    vi.stubGlobal('requestIdleCallback', undefined)
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    renderHook(() => useGeoPagePrefetch('city', 2025, true), { wrapper: createWrapper() })

    expect(mockIdleCallback).not.toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
  })
})
