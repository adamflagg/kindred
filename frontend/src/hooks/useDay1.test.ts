/**
 * Tests for useDay1 hook.
 *
 * Verifies the Day 1 hook forwards the session-type filter (emitted by the
 * shared metrics session picker) to the backend, so Day 1 honors the picker
 * like every other registration page.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import { useDay1 } from './useDay1'

const mockFetchWithAuth = vi.fn()

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false }),
}))

describe('useDay1', () => {
  beforeEach(() => {
    mockFetchWithAuth.mockReset()
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ year: 2026, tiers: [], prior_years: [] }),
    })
  })

  it('requests only the year when no session types are passed', async () => {
    renderHook(() => useDay1(2026), { wrapper: createWrapper() })

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled())
    const url = String(mockFetchWithAuth.mock.calls[0]?.[0])
    expect(url).toContain('year=2026')
    expect(url).not.toContain('session_types')
  })

  it('forwards session_types to the endpoint when provided', async () => {
    renderHook(() => useDay1(2026, 'main,embedded,ag,quest,scit,tli'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalled())
    const url = decodeURIComponent(String(mockFetchWithAuth.mock.calls[0]?.[0]))
    expect(url).toContain('session_types=main,embedded,ag,quest,scit,tli')
  })
})
