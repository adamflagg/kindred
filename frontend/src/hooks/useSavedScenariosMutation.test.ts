import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createElement } from 'react'

// Mock pocketbase lib before importing hook
vi.mock('../lib/pocketbase', () => {
  const collections: Record<string, unknown> = {}
  return {
    pb: {
      collection: vi.fn((name: string) => {
        collections[name] ??= {
          getFullList: vi.fn(),
          create: vi.fn(),
          delete: vi.fn(),
        }
        return collections[name]
      }),
    },
    getCurrentUser: vi.fn(() => ({ id: 'user-1', email: 'user@example.com' })),
  }
})

import { pb } from '../lib/pocketbase'
import { useCreateScenario, useDeleteScenario } from './useSavedScenariosMutation'
import type { SavedScenario } from '../types/app-types'

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Bug A: empty scenario does not trigger undefined.session error', () => {
  it('useCreateScenario passes expand: session to create() so returned record has expand.session', async () => {
    // Arrange
    const campSessions = getCollection('camp_sessions')
    campSessions.getFullList.mockResolvedValueOnce([
      { id: 'pb-session-1', cm_id: 1000001, year: 2025 },
    ])

    const savedScenarios = getCollection('saved_scenarios')
    const createdRecord = {
      id: 'scenario-abc',
      name: 'My Empty Scenario',
      session: 'pb-session-1',
      year: 2025,
      is_active: true,
      created: '2026-04-23T00:00:00Z',
      updated: '2026-04-23T00:00:00Z',
      expand: { session: { cm_id: 1000001 } },
    } as unknown as SavedScenario
    savedScenarios.create.mockResolvedValueOnce(createdRecord)

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    // Act
    await act(async () => {
      await result.current.mutateAsync({
        name: 'My Empty Scenario',
        session_cm_id: 1000001,
        year: 2025,
        // no copyOptions => empty scenario
      })
    })

    // Assert: create() must be called with the { expand: 'session' } option
    expect(savedScenarios.create).toHaveBeenCalledTimes(1)
    const createCall = savedScenarios.create.mock.calls[0]
    const createOptions = createCall?.[1]
    expect(createOptions).toMatchObject({ expand: 'session' })
  })
})

describe('Bug B: copyScenarioToScenario copies ALL source assignments without loss', () => {
  it('copies all 50 source assignments sequentially (no Promise.all concurrency)', async () => {
    const SOURCE_COUNT = 50

    // Arrange: camp_sessions lookup + scenario create
    const campSessions = getCollection('camp_sessions')
    campSessions.getFullList.mockResolvedValueOnce([
      { id: 'pb-session-1', cm_id: 1000001, year: 2025 },
    ])

    const savedScenarios = getCollection('saved_scenarios')
    savedScenarios.create.mockResolvedValueOnce({
      id: 'new-scenario-id',
      name: 'Copied',
      session: 'pb-session-1',
      year: 2025,
      is_active: true,
      created: '2026-04-23T00:00:00Z',
      updated: '2026-04-23T00:00:00Z',
      expand: { session: { cm_id: 1000001 } },
    })

    // Arrange: source scenario has SOURCE_COUNT draft assignments
    const sourceAssignments = Array.from({ length: SOURCE_COUNT }, (_, i) => ({
      id: `draft-src-${i}`,
      person: `person-${i}`,
      bunk: `bunk-${i % 14}`,
      session: 'pb-session-1',
      bunk_plan: `plan-${i % 14}`,
      year: 2025,
      assignment_locked: false,
    }))

    const draftCollection = getCollection('bunk_assignments_draft')
    draftCollection.getFullList.mockResolvedValueOnce(sourceAssignments)

    // Track concurrency: reject if more than one create is in flight at a time
    let inFlight = 0
    let maxInFlight = 0
    draftCollection.create.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      // yield so a naive Promise.all would show concurrency
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { id: `new-draft-${Math.random()}` }
    })

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    // Act
    await act(async () => {
      await result.current.mutateAsync({
        name: 'Copied',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromScenario: 'source-scenario-id' },
      })
    })

    // Assert: every source assignment was written
    expect(draftCollection.create).toHaveBeenCalledTimes(SOURCE_COUNT)

    // Assert: sequential — never more than 1 create in flight at once
    expect(maxInFlight).toBe(1)
  })

  it('accumulates errors across a batch and throws after the loop (all non-failing items still persisted)', async () => {
    const campSessions = getCollection('camp_sessions')
    campSessions.getFullList.mockResolvedValueOnce([
      { id: 'pb-session-1', cm_id: 1000001, year: 2025 },
    ])

    const savedScenarios = getCollection('saved_scenarios')
    savedScenarios.create.mockResolvedValueOnce({
      id: 'new-scenario-id',
      name: 'Copied',
      session: 'pb-session-1',
      year: 2025,
      is_active: true,
      created: '2026-04-23T00:00:00Z',
      updated: '2026-04-23T00:00:00Z',
      expand: { session: { cm_id: 1000001 } },
    })

    const sourceAssignments = Array.from({ length: 10 }, (_, i) => ({
      id: `draft-src-${i}`,
      person: `person-${i}`,
      bunk: `bunk-${i}`,
      session: 'pb-session-1',
      bunk_plan: `plan-${i}`,
      year: 2025,
      assignment_locked: false,
    }))

    const draftCollection = getCollection('bunk_assignments_draft')
    draftCollection.getFullList.mockResolvedValueOnce(sourceAssignments)

    let callIndex = 0
    draftCollection.create.mockImplementation(async () => {
      const i = callIndex++
      // Fail every 3rd call
      if (i % 3 === 0) {
        throw new Error(`simulated failure ${i}`)
      }
      return { id: `new-draft-${i}` }
    })

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          name: 'Copied',
          session_cm_id: 1000001,
          year: 2025,
          copyOptions: { fromScenario: 'source-scenario-id' },
        })
      ).rejects.toThrow(/Failed to copy/)
    })

    // Critical: all 10 creates attempted, not short-circuited like Promise.all would
    expect(draftCollection.create).toHaveBeenCalledTimes(10)

    await waitFor(() => {
      // mutation is settled
      expect(result.current.isError).toBe(true)
    })
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
