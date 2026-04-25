/**
 * Tests for ScenarioContext loading/mutation state split.
 *
 * Regression: staff testing (April 2026) reported that clicking "Delete" on a
 * scenario caused the entire list in ScenarioManagementModal to vanish — only
 * the hardcoded "CampMinder" card remained visible behind the confirmation
 * prompt. Root cause: the provider's single `loading` flag went true for any
 * pending mutation (create / update / delete / clear), and the modal rendered
 * a "Loading scenarios..." placeholder in that branch, replacing the scenario
 * cards. The fix exposes `isLoading` (initial query fetch) separately from
 * `isMutating` (any mutation pending) so consumers can distinguish the two.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock pocketbase before importing the context
vi.mock('../lib/pocketbase', () => {
  const collections: Record<string, unknown> = {}
  return {
    pb: {
      collection: vi.fn((name: string) => {
        collections[name] ??= {
          getFullList: vi.fn().mockResolvedValue([]),
          getOne: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        }
        return collections[name]
      }),
    },
    getCurrentUser: vi.fn(() => ({ id: 'user-1', email: 'user@example.com' })),
  }
})

// Mock auth so useSavedScenarios doesn't gate on isLoading
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ isLoading: false }),
}))

// Mock useYear so provider gets a stable year
vi.mock('../hooks/useCurrentYear', async () => {
  const actual = await vi.importActual<object>('../hooks/useCurrentYear')
  return {
    ...actual,
    useYear: () => 2026,
  }
})

import { pb } from '../lib/pocketbase'
import type { Mock } from 'vitest'
import { ScenarioProvider } from './ScenarioContext'
import { useScenario } from '../hooks/useScenario'

interface CollectionMock {
  getFullList: Mock
  getOne: Mock
  create: Mock
  update: Mock
  delete: Mock
}

function getCollection(name: string): CollectionMock {
  return (pb.collection as Mock)(name) as CollectionMock
}

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ScenarioProvider>{children}</ScenarioProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScenarioContext loading vs mutating', () => {
  it('exposes isLoading (query fetch) separately from isMutating (mutation pending)', () => {
    const { result } = renderHook(() => useScenario(), { wrapper: createWrapper() })
    // Both flags must exist on the public context shape.
    expect(result.current).toHaveProperty('isLoading')
    expect(result.current).toHaveProperty('isMutating')
  })

  it('does not flip isLoading to true during a delete mutation', async () => {
    const savedScenarios = getCollection('saved_scenarios')
    const drafts = getCollection('bunk_assignments_draft')

    savedScenarios.getFullList.mockResolvedValue([
      {
        id: 'scenario-1',
        name: 'Test Scenario',
        session: 'pb-session-1',
        year: 2026,
        is_active: true,
        description: '',
        created: '2026-04-01T00:00:00Z',
        updated: '2026-04-01T00:00:00Z',
        collectionId: 'c1',
        collectionName: 'saved_scenarios',
        expand: { session: { cm_id: 1000001 } },
      },
    ])

    // Delete path: getFullList for drafts, then delete scenario.
    // Keep the delete promise pending so we can observe state mid-flight.
    drafts.getFullList.mockResolvedValue([])
    let resolveScenarioDelete: (value?: unknown) => void = () => {}
    savedScenarios.delete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveScenarioDelete = resolve
        })
    )

    const { result } = renderHook(() => useScenario(), { wrapper: createWrapper() })

    // Let the initial query settle.
    await act(async () => {
      await result.current.loadScenarios(1000001)
    })
    await waitFor(() => expect(result.current.scenarios).toHaveLength(1))
    expect(result.current.isLoading).toBe(false)

    // Start the delete but do NOT await it yet — we want to observe the
    // in-flight state.
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteScenario('scenario-1')
    })

    // While the delete is pending: isMutating true, isLoading stays false.
    await waitFor(() => expect(result.current.isMutating).toBe(true))
    expect(result.current.isLoading).toBe(false)

    // Resolve and drain.
    await act(async () => {
      resolveScenarioDelete()
      await deletePromise
    })

    await waitFor(() => expect(result.current.isMutating).toBe(false))
    expect(result.current.isLoading).toBe(false)
  })
})
