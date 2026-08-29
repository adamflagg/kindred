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
import { getBackendSyncJobIds } from '../test/backendSyncJobIds'

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
      // Built from the backend's own statusSyncTypes() rather than typed out by hand.
      // kindred#2593: the hand-written copy this replaces had drifted the same way the three
      // production lists had -- it declared `google_sheets_export`, which no Go code emits, and
      // omitted `lodging_assignments` and `stranded_assignment_cleanup`. Nothing caught it,
      // because the object is untyped and the assertion below compares the response to itself.
      // A fixture that claims to be "the sync-status payload" and is not is the same trap one
      // file over from the guard that exists to close it.
      const mockResponse = Object.fromEntries(
        getBackendSyncJobIds().map((id) => [id, { status: 'idle' as const }])
      )
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

// kindred#2593: SyncStatusResponse is hand-written and drifted BOTH ways -- it lacked the
// three jobs #2591 published, and it still declared `google_sheets_export`, which no Go code
// emits (renamed `multi_workbook_export`). TypeScript can't catch either direction on its
// own: an extra runtime key is structurally fine, and a declared-but-absent key just reads
// as `undefined`. An interface has no runtime representation to inspect, so this reads the
// per-job field names straight out of the source text -- the same source-grep pattern other
// tests in this suite already use (see reference_frontend_source_grep_tests) -- and compares
// them to the backend's own statusSyncTypes() (pocketbase/sync/api.go) rather than to the
// other hand-maintained frontend lists, which would drift in lockstep and prove nothing.
describe('SyncStatusResponse backend coverage (kindred#2593)', () => {
  it('declares exactly one field per job the backend publishes -- no more, no fewer', () => {
    const sourceCode = readFileSync(resolve(__dirname, 'useSyncStatusAPI.ts'), 'utf-8')

    const interfaceStart = sourceCode.indexOf('export interface SyncStatusResponse {')
    expect(interfaceStart).toBeGreaterThan(-1)
    const interfaceEnd = sourceCode.indexOf('\n}', interfaceStart)
    expect(interfaceEnd).toBeGreaterThan(-1)
    const body = sourceCode.slice(interfaceStart, interfaceEnd)

    // Per-job fields are declared `  <id>: SyncStatus`, optionally followed by a trailing
    // "// ..." comment (e.g. `persons: SyncStatus // Combined sync: ...`) -- the special
    // `_`-prefixed meta fields (e.g. `_queue?: QueuedSyncItem[]`) use different types and/or
    // are optional, so this pattern excludes them without needing to name each one.
    const jobFieldIds = [...body.matchAll(/^ {2}(\w+): SyncStatus\s*(?:\/\/.*)?$/gm)].map(
      (m) => m[1]
    )

    const backendIds = getBackendSyncJobIds().slice().sort()
    expect(jobFieldIds.slice().sort()).toEqual(backendIds)
  })
})
