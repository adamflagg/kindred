/**
 * Tests for useSyncStatusAPI - verifies centralized queryKeys usage and 401-swallow behavior
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { useSyncStatusAPI } from './useSyncStatusAPI'

// authChangeListeners simulates pb.authStore.onChange — tests can call them
// to drive the auto-refetch behavior on auth-state transitions.
const authChangeListeners: Array<() => void> = []
const authStoreState = { isValid: false }

vi.mock('../lib/pocketbase', () => ({
  pb: {
    send: vi.fn(),
    authStore: {
      get isValid() {
        return authStoreState.isValid
      },
      onChange: (cb: () => void) => {
        authChangeListeners.push(cb)
        return () => {
          const i = authChangeListeners.indexOf(cb)
          if (i >= 0) authChangeListeners.splice(i, 1)
        }
      },
    },
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'

function fireAuthChange(nextValid: boolean) {
  authStoreState.isValid = nextValid
  authChangeListeners.slice().forEach((cb) => cb())
}

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useSyncStatusAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: user is authenticated
    ;(useAuth as Mock).mockReturnValue({ isLoading: false, user: { id: 'u1' } })
  })

  describe('source code structure', () => {
    it('should import queryKeys from centralized utils', () => {
      const sourceCode = readFileSync(resolve(__dirname, 'useSyncStatusAPI.ts'), 'utf-8')
      expect(sourceCode).toMatch(/import.*queryKeys.*from.*['"]\.\.\/utils\/queryKeys['"]/)
    })

    it('should NOT use hardcoded sync-status-api query key', () => {
      const sourceCode = readFileSync(resolve(__dirname, 'useSyncStatusAPI.ts'), 'utf-8')
      expect(sourceCode).not.toContain("'sync-status-api'")
      expect(sourceCode).not.toContain('"sync-status-api"')
    })

    it('should use queryKeys.syncStatus() for the query key', () => {
      const sourceCode = readFileSync(resolve(__dirname, 'useSyncStatusAPI.ts'), 'utf-8')
      expect(sourceCode).toContain('queryKeys.syncStatus()')
    })
  })

  describe('401 error handling', () => {
    it('should swallow 401 errors and return null (typed sentinel, not empty object)', async () => {
      const pbError: Record<string, unknown> = { message: 'Unauthorized', status: 401 }
      ;(pb.send as Mock).mockRejectedValue(pbError)

      const { result } = renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      // null forces consumers to guard explicitly — `{}` lied to TypeScript and
      // let stale-shape access (e.g. `syncStatus.bunk_assignments.end_time`)
      // through unchecked. See issue #1011 for context.
      expect(result.current.data).toBeNull()
      expect(result.current.isError).toBe(false)
    })

    it('should propagate non-401 errors', async () => {
      const pbError: Record<string, unknown> = { message: 'Server Error', status: 500 }
      ;(pb.send as Mock).mockRejectedValue(pbError)

      const { result } = renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      // Verify that the error is not suppressed
      expect(result.current.data).toBeUndefined()
      expect(result.current.error).toBeTruthy()
    })

    it('should handle successful response', async () => {
      const mockResponse = {
        session_groups: { status: 'idle' as const },
        sessions: { status: 'idle' as const },
        attendees: { status: 'idle' as const },
        person_tag_defs: { status: 'idle' as const },
        custom_field_defs: { status: 'idle' as const },
        persons: { status: 'idle' as const },
        bunks: { status: 'idle' as const },
        bunk_plans: { status: 'idle' as const },
        bunk_assignments: { status: 'idle' as const },
        bunk_requests: { status: 'idle' as const },
        process_requests: { status: 'idle' as const },
        divisions: { status: 'idle' as const },
        staff: { status: 'idle' as const },
        financial_transactions: { status: 'idle' as const },
        staff_lookups: { status: 'idle' as const },
        financial_lookups: { status: 'idle' as const },
        google_sheets_export: { status: 'idle' as const },
        family_camp_derived: { status: 'idle' as const },
        staff_skills: { status: 'idle' as const },
        financial_aid_applications: { status: 'idle' as const },
        household_demographics: { status: 'idle' as const },
        camper_dietary: { status: 'idle' as const },
        camper_transportation: { status: 'idle' as const },
        quest_registrations: { status: 'idle' as const },
        staff_applications: { status: 'idle' as const },
        staff_vehicle_info: { status: 'idle' as const },
        normalize_geographic: { status: 'idle' as const },
        enrollment_snapshots: { status: 'idle' as const },
        multi_workbook_export: { status: 'idle' as const },
        person_custom_values: { status: 'idle' as const },
        household_custom_values: { status: 'idle' as const },
      }
      ;(pb.send as Mock).mockResolvedValue(mockResponse)

      const { result } = renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockResponse)
      expect(result.current.isError).toBe(false)
    })
  })

  describe('auth-state recovery (#1011 — fresh-login un-stall)', () => {
    it('refetches automatically when authStore transitions to valid', async () => {
      // Simulate the fresh-login race: the first request returns 401 (token
      // wasn't attached yet), then the auth store becomes valid and the page
      // should recover without a manual refresh.
      authStoreState.isValid = false
      authChangeListeners.length = 0

      const pbError: Record<string, unknown> = { message: 'Unauthorized', status: 401 }
      const realResponse = { _configured_year: 2026, bunk_assignments: { status: 'idle' } }
      ;(pb.send as Mock).mockRejectedValueOnce(pbError).mockResolvedValueOnce(realResponse)

      const { result } = renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      // First fetch settled — returns null sentinel (the 401 path).
      await waitFor(() => {
        expect(result.current.data).toBeNull()
      })

      // Auth store flips to valid (e.g. authRefresh resolved). The hook must
      // invalidate the query so the next render gets real data — no human
      // refresh required.
      fireAuthChange(true)

      await waitFor(() => {
        expect(result.current.data).toEqual(realResponse)
      })
      expect(pb.send).toHaveBeenCalledTimes(2)
    })

    it('does not refetch on auth-store changes that do not gain validity', async () => {
      authStoreState.isValid = false
      authChangeListeners.length = 0
      ;(pb.send as Mock).mockResolvedValue({})

      renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(pb.send).toHaveBeenCalledTimes(1)
      })

      // Spurious onChange while still invalid (e.g. token refresh started but
      // not yet completed) — must NOT thrash the query.
      fireAuthChange(false)

      // Give it a moment to misbehave if it's going to.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(pb.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('auth state', () => {
    it('should not query when auth is loading', async () => {
      ;(useAuth as Mock).mockReturnValue({ isLoading: true })
      ;(pb.send as Mock).mockResolvedValue({})

      renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      // Give it a moment to settle
      await new Promise((resolve) => setTimeout(resolve, 100))

      // pb.send should not have been called because the query is disabled while loading
      expect(pb.send).not.toHaveBeenCalled()
    })

    it('should query when auth is ready', async () => {
      ;(useAuth as Mock).mockReturnValue({ isLoading: false, user: { id: 'u1' } })
      ;(pb.send as Mock).mockResolvedValue({})

      const { result } = renderHook(() => useSyncStatusAPI(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(pb.send).toHaveBeenCalled()
    })
  })
})
