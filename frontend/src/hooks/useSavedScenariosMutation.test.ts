/**
 * useCreateScenario now routes through `POST /api/scenarios` (kindred#2021),
 * program-aware server-side, instead of the raw PocketBase SDK plus a
 * client-side copy loop (`copyProductionToScenario` / `copyScenarioToScenario`
 * / `copyLockedGroupsToScenario`, all retired with this change — their
 * behaviour moved to `_seed_summer_scenario` / `_copy_locked_groups` /
 * `_seed_weekend_scenario` in `api/routers/scenarios.py`, pinned there by
 * `tests/unit/api/routers/test_scenarios_program_aware.py`). This file now
 * pins the CLIENT half of that contract: the request shape sent to the
 * backend, and that the response is used as-is.
 *
 * useDeleteScenario is untouched by kindred#2021 (still the raw PocketBase
 * SDK, relying on server-side cascadeDelete) — those tests are unchanged.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
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

// Mock pocketbase lib before importing hook — useDeleteScenario still uses it.
vi.mock('../lib/pocketbase', () => {
  const collections: Record<string, unknown> = {}
  return {
    pb: {
      collection: vi.fn((name: string) => {
        collections[name] ??= {
          getFullList: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          delete: vi.fn(),
        }
        return collections[name]
      }),
    },
    getCurrentUser: vi.fn(() => ({ id: 'user-1', email: 'user@example.com' })),
  }
})

import { pb, getCurrentUser } from '../lib/pocketbase'
import { useCreateScenario, useDeleteScenario } from './useSavedScenariosMutation'

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

interface CollectionMock {
  getFullList: Mock
  create: Mock
  delete: Mock
}

function getCollection(name: string): CollectionMock {
  return (pb.collection as Mock)(name) as CollectionMock
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
}

const CREATED_SCENARIO = {
  id: 'scenario-abc',
  name: 'My Scenario',
  session_cm_id: 1000001,
  year: 2025,
  is_active: true,
  description: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCurrentUser as Mock).mockReturnValue({ id: 'user-1', email: 'user@example.com' })
  mockFetchWithAuth.mockResolvedValue(okResponse(CREATED_SCENARIO))
})

describe('useCreateScenario', () => {
  it('requires authentication before calling the backend at all', async () => {
    ;(getCurrentUser as Mock).mockReturnValue(null)
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'X', session_cm_id: 1000001, year: 2025 })
      ).rejects.toThrow(/authenticated/)
    })
    expect(mockFetchWithAuth).not.toHaveBeenCalled()
  })

  it('POSTs to /api/scenarios with the name, session and year', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({ name: 'My Scenario', session_cm_id: 1000001, year: 2025 })
    })

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/scenarios')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({
      name: 'My Scenario',
      session_cm_id: 1000001,
      year: 2025,
    })
  })

  it('includes description only when provided', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        name: 'My Scenario',
        session_cm_id: 1000001,
        year: 2025,
        description: 'Mixed age groups',
      })
    })

    const [, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toMatchObject({ description: 'Mixed age groups' })
  })

  it('maps { fromProduction: true } to copy_from_production: true', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        name: 'From Prod',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromProduction: true },
      })
    })

    const [, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string) as Record<string, unknown>
    expect(body['copy_from_production']).toBe(true)
    expect(body).not.toHaveProperty('copy_from_scenario')
  })

  it('maps { fromProduction: false } to copy_from_production: false — a blank scenario, not the default', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Blank',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromProduction: false },
      })
    })

    const [, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string) as Record<string, unknown>
    expect(body['copy_from_production']).toBe(false)
  })

  it('maps { fromScenario: id } to copy_from_scenario', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Copied',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromScenario: 'source-scenario-id' },
      })
    })

    const [, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string) as Record<string, unknown>
    expect(body['copy_from_scenario']).toBe('source-scenario-id')
    expect(body).not.toHaveProperty('copy_from_production')
  })

  it('omits both copy fields when no copyOptions is given', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({ name: 'No opinion', session_cm_id: 1000001, year: 2025 })
    })

    const [, options] = mockFetchWithAuth.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('copy_from_production')
    expect(body).not.toHaveProperty('copy_from_scenario')
  })

  it('returns the backend response as-is — session_cm_id is already flat, no expand to unwrap', async () => {
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync({
        name: 'My Scenario',
        session_cm_id: 1000001,
        year: 2025,
      })
    })

    expect(created).toEqual(CREATED_SCENARIO)
  })

  it('rejects with the server detail on a non-ok response', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 404,
      json: () =>
        Promise.resolve({ detail: 'Session with CampMinder ID 999 not found for year 2025' }),
    })
    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'X', session_cm_id: 999, year: 2025 })
      ).rejects.toThrow(/not found for year 2025/)
    })
  })

  it('invalidates saved-scenarios and the weekend query keys on success', async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)

    const { result } = renderHook(() => useCreateScenario(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'My Scenario', session_cm_id: 1000001, year: 2025 })
    })

    const keys = invalidateSpy.mock.calls.map(
      ([arg]) => (arg as { queryKey: readonly unknown[] }).queryKey
    )
    expect(keys).toContainEqual(['saved-scenarios'])
    expect(keys).toContainEqual(['saved-scenarios', 1000001, 2025])
    // Weekend keys, always invalidated (harmless no-op for a summer session —
    // nothing is cached under them). Required because a weekend scenario may
    // now be seeded server-side from lodging_assignments_draft, and those
    // queries carry a 30-minute staleTime (CLAUDE.md §4).
    expect(keys).toContainEqual(['weekend-summary', 2025])
    expect(keys).toContainEqual(['weekend-roster', 2025, 1000001, 'scenario-abc'])
  })
})

describe('useDeleteScenario: relies on server-side cascade', () => {
  it('deletes only the saved_scenarios row — does not pre-delete draft assignments', async () => {
    const savedScenarios = getCollection('saved_scenarios')
    const drafts = getCollection('bunk_assignments_draft')
    savedScenarios.delete.mockResolvedValue(true)

    const { result } = renderHook(() => useDeleteScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync('scenario-to-delete')
    })

    // Single server call — no N+1 pre-delete loop.
    expect(savedScenarios.delete).toHaveBeenCalledTimes(1)
    expect(savedScenarios.delete).toHaveBeenCalledWith('scenario-to-delete')
    expect(drafts.getFullList).not.toHaveBeenCalled()
    expect(drafts.delete).not.toHaveBeenCalled()
  })
})
