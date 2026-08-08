/**
 * useClearScenario (kindred#2021).
 *
 * Kept in its own file rather than folded into useScenarioOperations.test.ts:
 * that file's `@tanstack/react-query` mock strips `useMutation` down to
 * `{ mutateAsync: mutationFn }` and drops `onSuccess` entirely, which is fine
 * for useUpdateScenario's tests but useless here — the whole point of this
 * suite is what `onSuccess` invalidates. Uses a real QueryClientProvider
 * instead, matching useSavedScenariosMutation.test.ts.
 *
 * Before this hook routed through the backend, clearing a scenario meant
 * deleting `bunk_assignments_draft` rows directly through the PocketBase
 * SDK — a table that is always empty for a weekend scenario (weekend drafts
 * live in `lodging_assignments_draft`), so a weekend Clear reported success
 * ("Cleared 0 assignments") while deleting nothing. That bug is what
 * kindred#2021 is titled after; the actual fix is server-side
 * (`api/routers/scenarios.py`, pinned by
 * `tests/unit/api/routers/test_scenarios_program_aware.py`). This file pins
 * the CLIENT half: the hook must call the backend endpoint rather than
 * PocketBase directly, and must invalidate both summer's and weekend's
 * caches regardless of which program the cleared scenario belongs to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createElement } from 'react'

const mockFetchWithAuth = vi.fn()

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

import { useClearScenario } from './useScenarioOperations'

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchWithAuth.mockResolvedValue(
    okResponse({ message: 'Cleared 5 assignments from scenario for year 2026' })
  )
})

describe('useClearScenario', () => {
  it('POSTs to /api/scenarios/{id}/clear, not the PocketBase SDK', async () => {
    const { result } = renderHook(() => useClearScenario(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: new QueryClient() }, children),
    })

    await act(async () => {
      await result.current.mutateAsync({ scenarioId: 'scn_1', year: 2026, sessionCmId: 1000001 })
    })

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/scenarios/scn_1/clear')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ year: 2026 })
  })

  it('does not send sessionCmId to the server — the scenario names its own session', async () => {
    // The server resolves the program from the scenario's own `session`
    // relation, not from a client-supplied session id.
    const { result } = renderHook(() => useClearScenario(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: new QueryClient() }, children),
    })

    await act(async () => {
      await result.current.mutateAsync({ scenarioId: 'scn_1', year: 2026, sessionCmId: 1000001 })
    })

    const [, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).not.toHaveProperty('session_cm_id')
  })

  it('invalidates both the summer and the weekend caches on success', async () => {
    // A no-op for whichever program the cleared scenario is NOT — nothing is
    // cached under the other program's keys for this id — but the hook has
    // no way to know which program it just cleared, so both fire.
    const qc = new QueryClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useClearScenario(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: qc }, children),
    })

    await act(async () => {
      await result.current.mutateAsync({ scenarioId: 'scn_1', year: 2026, sessionCmId: 1000001 })
    })

    const keys = invalidateSpy.mock.calls.map(
      ([arg]) => (arg as { queryKey: readonly unknown[] }).queryKey
    )
    expect(keys).toContainEqual(['bunk-assignments'])
    expect(keys).toContainEqual(['weekend-summary', 2026])
    expect(keys).toContainEqual(['weekend-roster', 2026, 1000001, 'scn_1'])
  })

  it('rejects with the server detail on a non-ok response', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Scenario not found' }),
    })
    const { result } = renderHook(() => useClearScenario(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: new QueryClient() }, children),
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ scenarioId: 'scn_missing', year: 2026, sessionCmId: 1000001 })
      ).rejects.toThrow(/Scenario not found/)
    })
  })
})
