/**
 * Tests for useGroupConflictConfirm hook.
 *
 * This hook detects when a camper is about to be added to a friend group while
 * they already belong to a different group in the same scenario.  It exposes an
 * async `checkConflict` function that either resolves immediately with `null`
 * (no conflict) or opens a confirmation dialog and waits for the user to either
 * continue (resolves with `'confirmed'`) or cancel (resolves with `'cancelled'`).
 *
 * Entry points that consume this hook:
 *   - LockGroupContext.addCamperToGroup (drag-into-group)
 *   - LockGroupActionBar.createGroupMutation (create-new-group from action bar)
 *
 * TDD red phase — these tests must fail before implementation is written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'

// ── mock pocketbase ──────────────────────────────────────────────────────────
vi.mock('../lib/pocketbase', () => {
  const collections: Record<string, unknown> = {}
  return {
    pb: {
      collection: vi.fn((name: string) => {
        collections[name] ??= {
          getFullList: vi.fn().mockResolvedValue([]),
        }
        return collections[name]
      }),
      filter: vi.fn((tpl: string, params: Record<string, unknown>) =>
        // Minimal stand-in: just substitute values so callers don't crash
        tpl.replace(/\{:(\w+)\}/g, (_, k) => String(params[k] ?? ''))
      ),
    },
  }
})

import { pb } from '../lib/pocketbase'
import { useGroupConflictConfirm } from './useGroupConflictConfirm'

interface CollectionMock {
  getFullList: Mock
}

function getCollection(name: string): CollectionMock {
  return (pb.collection as Mock)(name) as CollectionMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── helpers ──────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'scenario-abc'

function makeGroup(id: string, name: string) {
  return { id, name }
}

function makeMember(attendeePbId: string, groupId: string) {
  return { id: `member-${attendeePbId}-${groupId}`, attendee: attendeePbId, group: groupId }
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('useGroupConflictConfirm', () => {
  describe('checkConflict — no existing membership', () => {
    it('returns null immediately when camper has no memberships in this scenario', async () => {
      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([])

      const { result } = renderHook(() => useGroupConflictConfirm())

      let outcome: string | null | undefined
      await act(async () => {
        outcome = await result.current.checkConflict({
          attendeePbId: 'attendee-emma',
          targetGroupId: 'group-new',
          targetGroupName: 'Johnson, Garcia',
          scenarioId: SCENARIO_ID,
        })
      })

      expect(outcome).toBeNull()
      expect(result.current.dialogState.isOpen).toBe(false)
    })
  })

  describe('checkConflict — camper already in a DIFFERENT group in same scenario', () => {
    it('opens dialog with correct group names', async () => {
      const existingMember = makeMember('attendee-emma', 'group-existing')
      const existingGroup = makeGroup('group-existing', 'Garcia, Smith')

      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([existingMember])
      getCollection('locked_groups').getFullList.mockResolvedValueOnce([existingGroup])

      const { result } = renderHook(() => useGroupConflictConfirm())

      // Start the check — don't await so we can inspect intermediate dialog state
      let checkPromise: Promise<string | null>
      act(() => {
        checkPromise = result.current.checkConflict({
          attendeePbId: 'attendee-emma',
          targetGroupId: 'group-new',
          targetGroupName: 'Johnson, Garcia',
          scenarioId: SCENARIO_ID,
        })
      })

      // Wait for async PB calls to complete and dialog to open
      await waitFor(() => {
        expect(result.current.dialogState.isOpen).toBe(true)
      })

      expect(result.current.dialogState.existingGroupName).toBe('Garcia, Smith')
      expect(result.current.dialogState.targetGroupName).toBe('Johnson, Garcia')

      // Clean up — cancel so the promise resolves
      act(() => {
        result.current.dialogState.onCancel()
      })

      await act(async () => {
        await checkPromise!
      })
    })

    it('returns "confirmed" when user clicks Continue', async () => {
      const existingMember = makeMember('attendee-emma', 'group-existing')
      const existingGroup = makeGroup('group-existing', 'Garcia, Smith')

      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([existingMember])
      getCollection('locked_groups').getFullList.mockResolvedValueOnce([existingGroup])

      const { result } = renderHook(() => useGroupConflictConfirm())

      let checkPromise: Promise<string | null>
      act(() => {
        checkPromise = result.current.checkConflict({
          attendeePbId: 'attendee-emma',
          targetGroupId: 'group-new',
          targetGroupName: 'Johnson, Garcia',
          scenarioId: SCENARIO_ID,
        })
      })

      // Wait for dialog to open
      await waitFor(() => {
        expect(result.current.dialogState.isOpen).toBe(true)
      })

      act(() => {
        result.current.dialogState.onConfirm()
      })

      let outcome: string | null | undefined
      await act(async () => {
        outcome = await checkPromise!
      })

      expect(outcome).toBe('confirmed')
      expect(result.current.dialogState.isOpen).toBe(false)
    })

    it('returns "cancelled" when user clicks Cancel', async () => {
      const existingMember = makeMember('attendee-emma', 'group-existing')
      const existingGroup = makeGroup('group-existing', 'Garcia, Smith')

      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([existingMember])
      getCollection('locked_groups').getFullList.mockResolvedValueOnce([existingGroup])

      const { result } = renderHook(() => useGroupConflictConfirm())

      let checkPromise: Promise<string | null>
      act(() => {
        checkPromise = result.current.checkConflict({
          attendeePbId: 'attendee-emma',
          targetGroupId: 'group-new',
          targetGroupName: 'Johnson, Garcia',
          scenarioId: SCENARIO_ID,
        })
      })

      // Wait for dialog to open
      await waitFor(() => {
        expect(result.current.dialogState.isOpen).toBe(true)
      })

      act(() => {
        result.current.dialogState.onCancel()
      })

      let outcome: string | null | undefined
      await act(async () => {
        outcome = await checkPromise!
      })

      expect(outcome).toBe('cancelled')
      expect(result.current.dialogState.isOpen).toBe(false)
    })
  })

  describe('checkConflict — camper already in the SAME target group', () => {
    it('returns null without opening dialog (not a conflict)', async () => {
      // Camper is already in target group — not a cross-group conflict,
      // the caller will handle this as a duplicate-membership no-op.
      const existingMember = makeMember('attendee-emma', 'group-new')
      const existingGroup = makeGroup('group-new', 'Johnson, Garcia')

      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([existingMember])
      getCollection('locked_groups').getFullList.mockResolvedValueOnce([existingGroup])

      const { result } = renderHook(() => useGroupConflictConfirm())

      let outcome: string | null | undefined
      await act(async () => {
        outcome = await result.current.checkConflict({
          attendeePbId: 'attendee-emma',
          targetGroupId: 'group-new',
          targetGroupName: 'Johnson, Garcia',
          scenarioId: SCENARIO_ID,
        })
      })

      expect(outcome).toBeNull()
      expect(result.current.dialogState.isOpen).toBe(false)
    })
  })

  describe('checkConflict — scenario scoping', () => {
    it('does not open dialog when existing membership is in a different scenario', async () => {
      // The query is filtered by scenarioId on the server side; we simulate
      // this by having the getFullList mock return [] (server filtered them out).
      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([])

      const { result } = renderHook(() => useGroupConflictConfirm())

      let outcome: string | null | undefined
      await act(async () => {
        outcome = await result.current.checkConflict({
          attendeePbId: 'attendee-olivia',
          targetGroupId: 'group-new',
          targetGroupName: 'Chen, Johnson',
          scenarioId: SCENARIO_ID,
        })
      })

      expect(outcome).toBeNull()
      expect(result.current.dialogState.isOpen).toBe(false)
    })

    it('passes scenarioId to the DB query so the filter is scenario-scoped', async () => {
      getCollection('locked_group_members').getFullList.mockResolvedValueOnce([])

      const { result } = renderHook(() => useGroupConflictConfirm())

      await act(async () => {
        await result.current.checkConflict({
          attendeePbId: 'attendee-liam',
          targetGroupId: 'group-new',
          targetGroupName: 'Garcia, Johnson',
          scenarioId: 'scenario-xyz',
        })
      })

      const callArgs = getCollection('locked_group_members').getFullList.mock.calls[0]
      // Should have been called with options containing a filter
      expect(callArgs).toBeDefined()
      const options = (callArgs as [{ filter?: string; expand?: string }] | undefined)?.[0]
      expect(options?.filter ?? '').toContain('scenario-xyz')
    })
  })
})
