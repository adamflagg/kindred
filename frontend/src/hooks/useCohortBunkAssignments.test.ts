/**
 * Tests for useCohortBunkAssignments hook.
 *
 * The cohort drill-down modal shows each camper's current bunk inline next
 * to their grade. Source of truth depends on scenario state:
 *  - Scenario active → bunk_assignments_draft filtered by scenario id
 *  - Production mode (currentScenario === null) → bunk_assignments
 *
 * TDD: tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import { useCohortBunkAssignments } from './useCohortBunkAssignments'

const mockGetFullList = vi.fn()
const collectionSpy = vi.fn((_name: string) => ({ getFullList: mockGetFullList }))
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => collectionSpy(name),
  },
}))

// The hook reads ScenarioContext via useContext. We provide a controllable
// mock so each test can flip between production and a specific scenario.
const mockScenarioContext: { currentScenario: { id: string } | null } = {
  currentScenario: null,
}
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useContext: (ctx: unknown) => {
      // Identify our ScenarioContext by displayName-style marker on the mock.
      if ((ctx as { __isScenarioContext__?: boolean }).__isScenarioContext__) {
        return mockScenarioContext
      }
      return actual.useContext(ctx as Parameters<typeof actual.useContext>[0])
    },
  }
})
vi.mock('./useScenario', () => ({
  ScenarioContext: { __isScenarioContext__: true },
}))

interface AssignmentFixture {
  bunkName: string | null
  personCmId: number
}

// Builds a record matching what we expand from PocketBase. Both the prod
// (`bunk_assignments`) and scenario (`bunk_assignments_draft`) collections
// have identical relation shapes for our purposes.
function makeAssignment({ bunkName, personCmId }: AssignmentFixture) {
  return {
    id: `assign-${personCmId}`,
    expand: {
      person: { cm_id: personCmId },
      bunk: bunkName ? { name: bunkName } : null,
    },
  }
}

describe('useCohortBunkAssignments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScenarioContext.currentScenario = null
  })

  it('returns an empty map when given no person ids', async () => {
    const { result } = renderHook(() => useCohortBunkAssignments([], 201, 2025), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.bunkByPerson.size).toBe(0)
    // No need to hit PocketBase when there are no campers to look up.
    expect(mockGetFullList).not.toHaveBeenCalled()
  })

  it('reads bunk_assignments in production mode (no scenario active)', async () => {
    mockScenarioContext.currentScenario = null
    mockGetFullList.mockResolvedValue([
      makeAssignment({ personCmId: 2000001, bunkName: 'Bunk 4' }),
      makeAssignment({ personCmId: 2000002, bunkName: 'Bunk 7' }),
    ])

    const { result } = renderHook(() => useCohortBunkAssignments([2000001, 2000002], 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(collectionSpy).toHaveBeenCalledWith('bunk_assignments')
    expect(result.current.bunkByPerson.get(2000001)).toBe('Bunk 4')
    expect(result.current.bunkByPerson.get(2000002)).toBe('Bunk 7')
  })

  it('reads bunk_assignments_draft when a scenario is active', async () => {
    mockScenarioContext.currentScenario = { id: 'scen-abc' }
    mockGetFullList.mockResolvedValue([
      makeAssignment({ personCmId: 2000003, bunkName: 'Bunk 12' }),
    ])

    const { result } = renderHook(() => useCohortBunkAssignments([2000003], 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(collectionSpy).toHaveBeenCalledWith('bunk_assignments_draft')
    // Filter must scope to the active scenario or we'd leak draft rows.
    const callOpts = mockGetFullList.mock.calls[0]?.[0] as { filter: string } | undefined
    expect(callOpts?.filter).toContain('scenario = "scen-abc"')
    expect(result.current.bunkByPerson.get(2000003)).toBe('Bunk 12')
  })

  it('returns null for campers without an assignment row', async () => {
    mockScenarioContext.currentScenario = null
    // Only 2000001 is assigned; 2000002 is in the cohort but unbunked.
    mockGetFullList.mockResolvedValue([makeAssignment({ personCmId: 2000001, bunkName: 'Bunk 4' })])

    const { result } = renderHook(() => useCohortBunkAssignments([2000001, 2000002], 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.bunkByPerson.get(2000001)).toBe('Bunk 4')
    // Hook returns the key with a null value (not a missing key) so consumers
    // can render "Unassigned" without juggling has() vs get().
    expect(result.current.bunkByPerson.has(2000002)).toBe(true)
    expect(result.current.bunkByPerson.get(2000002)).toBeNull()
  })

  it('returns null when the assignment exists but bunk relation is missing', async () => {
    mockScenarioContext.currentScenario = null
    mockGetFullList.mockResolvedValue([makeAssignment({ personCmId: 2000004, bunkName: null })])

    const { result } = renderHook(() => useCohortBunkAssignments([2000004], 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.bunkByPerson.get(2000004)).toBeNull()
  })
})
