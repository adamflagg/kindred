/**
 * Tests for useVelocity hook — auth loading guard (#512).
 *
 * The query should be disabled while auth is still loading,
 * preventing premature API calls before the token is available.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'

// Track the isLoading value returned by useAuth mock
let mockIsLoading = false

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockIsLoading ? null : { id: '1', email: 'test@example.com' },
    isLoading: mockIsLoading,
    isAuthenticated: !mockIsLoading,
    isBypassMode: false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn(),
    pb: {},
  }),
}))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    authStore: {
      token: 'test-token',
      clear: vi.fn(),
    },
  },
}))

import { useVelocity } from './useVelocity'
import { queryKeys } from '../utils/queryKeys'

describe('useVelocity auth loading guard (#512)', () => {
  it('disables query while auth is loading', () => {
    mockIsLoading = true

    const { result } = renderHook(() => useVelocity(2025), {
      wrapper: createWrapper(),
    })

    // Query should not fetch — status stays pending (disabled)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('enables query when auth is loaded and year > 0', async () => {
    mockIsLoading = false

    const { result } = renderHook(() => useVelocity(2025), {
      wrapper: createWrapper(),
    })

    // Query should attempt to fetch
    await waitFor(() => {
      expect(result.current.fetchStatus).not.toBe('idle')
    })
  })

  it('disables query when year is 0 regardless of auth state', () => {
    mockIsLoading = false

    const { result } = renderHook(() => useVelocity(0), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useVelocity gender basis (#2898 owner answer #78)', () => {
  async function requested(params: Parameters<typeof useVelocity>[1]): Promise<string> {
    mockIsLoading = false
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    renderHook(() => useVelocity(2026, params), { wrapper: createWrapper() })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0]?.[0])
    fetchSpy.mockRestore()
    return url
  }

  it('asks for gender identity only when the split is on and the picker says identity', async () => {
    expect(await requested({ splitByGender: true, genderBasis: 'identity' })).toContain(
      'gender_basis=identity'
    )
    expect(await requested({ splitByGender: true, genderBasis: 'field' })).not.toContain(
      'gender_basis'
    )
    expect(await requested({ splitByGender: false, genderBasis: 'identity' })).not.toContain(
      'gender_basis'
    )
  })

  it('caches the two bases apart', () => {
    expect(
      queryKeys.velocity(2026, undefined, '', '', true, 'enrollment', undefined, 'identity')
    ).not.toEqual(
      queryKeys.velocity(2026, undefined, '', '', true, 'enrollment', undefined, 'field')
    )
  })
})
