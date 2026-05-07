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
        if (!collections[name]) {
          // Default: getFullList resolves with [] so tests that don't configure
          // a collection explicitly don't crash on unexpected calls.
          collections[name] = {
            getFullList: vi.fn().mockResolvedValue([]),
            create: vi.fn(),
            delete: vi.fn(),
          }
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

// ── Helpers shared by the locked-group copy tests ────────────────────────────

/** Returns a minimal saved-scenario mock record. */
function makeScenarioRecord(id: string, sessionId = 'pb-session-1') {
  return {
    id,
    name: `Scenario ${id}`,
    session: sessionId,
    year: 2025,
    is_active: true,
    created: '2026-05-01T00:00:00Z',
    updated: '2026-05-01T00:00:00Z',
    expand: { session: { cm_id: 1000001 } },
  }
}

/** Configures the standard session + scenario stubs used in most copy tests. */
function setupCopySession(
  toScenarioId = 'new-scenario-id',
  sourceDrafts: unknown[] = [],
  sourceGroups: unknown[] = [],
  sourceMembers: unknown[] = []
) {
  const campSessions = getCollection('camp_sessions')
  campSessions.getFullList.mockReset()
  campSessions.getFullList.mockResolvedValueOnce([
    { id: 'pb-session-1', cm_id: 1000001, year: 2025 },
  ])
  const savedScenarios = getCollection('saved_scenarios')
  savedScenarios.create.mockReset()
  savedScenarios.create.mockResolvedValueOnce(makeScenarioRecord(toScenarioId))

  const draftCol = getCollection('bunk_assignments_draft')
  draftCol.getFullList.mockReset()
  draftCol.getFullList.mockResolvedValueOnce(sourceDrafts)
  draftCol.create.mockReset()
  draftCol.create.mockResolvedValue({ id: 'new-draft' })

  const groupsCol = getCollection('locked_groups')
  groupsCol.getFullList.mockReset()
  groupsCol.getFullList.mockResolvedValueOnce(sourceGroups)
  groupsCol.create.mockReset()
  groupsCol.create.mockImplementation(async (data: Record<string, unknown>) => ({
    id: `new-group-for-${String(data['name'] ?? 'x')}`,
    ...data,
  }))

  const membersCol = getCollection('locked_group_members')
  membersCol.getFullList.mockReset()
  membersCol.getFullList.mockResolvedValueOnce(sourceMembers)
  membersCol.create.mockReset()
  membersCol.create.mockResolvedValue({ id: 'new-member' })
}

// ── #1046 tests ───────────────────────────────────────────────────────────────

describe('#1046: copyScenarioToScenario also copies locked friend groups', () => {
  it('source has 0 friend groups: no locked_groups queries at all', async () => {
    setupCopySession('dest-id', [], [], [])

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync({
        name: 'Empty Copy',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromScenario: 'source-scenario-id' },
      })
    })

    const groupsCol = getCollection('locked_groups')
    // getFullList for groups was called (to check), but create was never called.
    expect(groupsCol.create).not.toHaveBeenCalled()
    const membersCol = getCollection('locked_group_members')
    expect(membersCol.create).not.toHaveBeenCalled()
  })

  it('source has 1 group with 0 members: creates 1 group, 0 members', async () => {
    const sourceGroups = [
      { id: 'grp-1', name: "Emma's Group", color: '#a5f3fc', session: 'pb-session-1', year: 2025 },
    ]
    setupCopySession('dest-id', [], sourceGroups, [])

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync({
        name: 'One Group Copy',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromScenario: 'source-scenario-id' },
      })
    })

    const groupsCol = getCollection('locked_groups')
    expect(groupsCol.create).toHaveBeenCalledTimes(1)
    const membersCol = getCollection('locked_group_members')
    expect(membersCol.create).not.toHaveBeenCalled()
  })

  it('source has 2 groups with overlapping members: each member ends up in the correct copied group', async () => {
    const sourceGroups = [
      { id: 'grp-A', name: "Liam's Group", color: '#bfdbfe', session: 'pb-session-1', year: 2025 },
      {
        id: 'grp-B',
        name: "Olivia's Group",
        color: '#bbf7d0',
        session: 'pb-session-1',
        year: 2025,
      },
    ]
    const sourceMembers = [
      { id: 'mem-1', group: 'grp-A', attendee: 'attendee-liam', year: 2025 },
      { id: 'mem-2', group: 'grp-A', attendee: 'attendee-riley', year: 2025 },
      { id: 'mem-3', group: 'grp-B', attendee: 'attendee-olivia', year: 2025 },
    ]
    setupCopySession('dest-id', [], sourceGroups, sourceMembers)

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync({
        name: 'Multi-Group Copy',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromScenario: 'source-scenario-id' },
      })
    })

    const groupsCol = getCollection('locked_groups')
    // Both groups created
    expect(groupsCol.create).toHaveBeenCalledTimes(2)

    const membersCol = getCollection('locked_group_members')
    // All 3 members created
    expect(membersCol.create).toHaveBeenCalledTimes(3)

    // Each member ends up attached to the correct mapped destination group —
    // not just "any new id, but not the old one."  This catches a swap where
    // every member would point to the same wrong destination group.
    const memberCalls = (membersCol.create as Mock).mock.calls as Array<[Record<string, unknown>]>
    const liamGroupNewId = "new-group-for-Liam's Group"
    const oliviaGroupNewId = "new-group-for-Olivia's Group"
    const tuples = memberCalls.map((call) => ({
      group: call[0]['group'],
      attendee: call[0]['attendee'],
    }))
    expect(tuples).toEqual(
      expect.arrayContaining([
        { group: liamGroupNewId, attendee: 'attendee-liam' },
        { group: liamGroupNewId, attendee: 'attendee-riley' },
        { group: oliviaGroupNewId, attendee: 'attendee-olivia' },
      ])
    )
  })

  it('member create error: aggregates and throws after the loop', async () => {
    const sourceGroups = [
      { id: 'grp-A', name: "Riley's Group", color: '#fde68a', session: 'pb-session-1', year: 2025 },
    ]
    const sourceMembers = [
      { id: 'mem-1', group: 'grp-A', attendee: 'attendee-riley', year: 2025 },
      { id: 'mem-2', group: 'grp-A', attendee: 'attendee-samuel', year: 2025 },
    ]
    setupCopySession('dest-id', [], sourceGroups, sourceMembers)

    // Fail the second member create.
    const membersCol = getCollection('locked_group_members')
    let memberCallIndex = 0
    membersCol.create.mockImplementation(async () => {
      if (memberCallIndex++ === 1) throw new Error('simulated member conflict')
      return { id: 'new-member' }
    })

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          name: 'Error Copy',
          session_cm_id: 1000001,
          year: 2025,
          copyOptions: { fromScenario: 'source-scenario-id' },
        })
      ).rejects.toThrow(/Failed to copy/)
    })

    // Both member creates attempted (no short-circuit on first error).
    expect(membersCol.create).toHaveBeenCalledTimes(2)
  })

  it('group create fails: members of that group are reported as skipped failures, not silently dropped', async () => {
    // When a group create fails, its members must NOT be silently skipped
    // because the aggregate error message would under-report the damage.
    const sourceGroups = [
      { id: 'grp-A', name: 'GroupA', color: '#bfdbfe', session: 'pb-session-1', year: 2025 },
      { id: 'grp-B', name: 'GroupB', color: '#bbf7d0', session: 'pb-session-1', year: 2025 },
    ]
    const sourceMembers = [
      { id: 'mem-1', group: 'grp-A', attendee: 'attendee-liam', year: 2025 },
      { id: 'mem-2', group: 'grp-A', attendee: 'attendee-riley', year: 2025 },
      { id: 'mem-3', group: 'grp-B', attendee: 'attendee-olivia', year: 2025 },
    ]
    setupCopySession('dest-id', [], sourceGroups, sourceMembers)

    // Make ONLY the first group create fail.  Members of grp-A (mem-1, mem-2)
    // should be reported as failures because the parent group never copied;
    // mem-3 (in grp-B) should still be copied successfully.
    const groupsCol = getCollection('locked_groups')
    let groupCallIndex = 0
    groupsCol.create.mockReset()
    groupsCol.create.mockImplementation(async (data: Record<string, unknown>) => {
      if (groupCallIndex++ === 0) throw new Error('simulated group conflict')
      return { id: `new-group-for-${String(data['name'] ?? 'x')}`, ...data }
    })

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          name: 'Skipped Members Copy',
          session_cm_id: 1000001,
          year: 2025,
          copyOptions: { fromScenario: 'source-scenario-id' },
        })
        // 1 failed group + 2 skipped members = 3 total failures.
      ).rejects.toThrow(/Failed to copy 3/)
    })

    // Only mem-3 (in successfully copied grp-B) should have been created.
    const membersCol = getCollection('locked_group_members')
    expect(membersCol.create).toHaveBeenCalledTimes(1)
  })

  it('fromProduction=true does NOT copy friend groups', async () => {
    // Production copy uses copyProductionToScenario, which should NOT touch groups.
    const campSessions = getCollection('camp_sessions')
    campSessions.getFullList.mockResolvedValueOnce([
      { id: 'pb-session-1', cm_id: 1000001, year: 2025 },
    ])
    const savedScenarios = getCollection('saved_scenarios')
    savedScenarios.create.mockResolvedValueOnce(makeScenarioRecord('prod-copy-id'))

    // bunk_assignments (production) returns 0 rows for simplicity.
    const assignmentsCol = getCollection('bunk_assignments')
    assignmentsCol.getFullList.mockResolvedValueOnce([])

    const { result } = renderHook(() => useCreateScenario(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync({
        name: 'From Prod',
        session_cm_id: 1000001,
        year: 2025,
        copyOptions: { fromProduction: true },
      })
    })

    const groupsCol = getCollection('locked_groups')
    expect(groupsCol.getFullList).not.toHaveBeenCalled()
    expect(groupsCol.create).not.toHaveBeenCalled()
    const membersCol = getCollection('locked_group_members')
    expect(membersCol.create).not.toHaveBeenCalled()
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
