/**
 * Tests for useHouseholdGroupConflictConfirm (kindred#1913 half 2).
 *
 * Forked from useGroupConflictConfirm.test.ts's shape, minus the PB-query
 * half: a household's current group is already known to the caller from the
 * already-loaded weekend groups list, so `confirmAdd` only has to drive the
 * dialog's open/await/resolve state machine, not go fetch anything.
 *
 * TDD red phase — these tests must fail before implementation is written.
 */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useHouseholdGroupConflictConfirm } from './useHouseholdGroupConflictConfirm'

describe('useHouseholdGroupConflictConfirm', () => {
  it('starts with the dialog closed', () => {
    const { result } = renderHook(() => useHouseholdGroupConflictConfirm())
    expect(result.current.dialogState.isOpen).toBe(false)
  })

  it('opens the dialog with the household and both group names', () => {
    const { result } = renderHook(() => useHouseholdGroupConflictConfirm())

    act(() => {
      void result.current.confirmAdd({
        householdName: 'Johnson',
        existingGroupName: 'Lake cabins',
        targetGroupName: 'Ridge cabins',
      })
    })

    expect(result.current.dialogState.isOpen).toBe(true)
    expect(result.current.dialogState.householdName).toBe('Johnson')
    expect(result.current.dialogState.existingGroupName).toBe('Lake cabins')
    expect(result.current.dialogState.targetGroupName).toBe('Ridge cabins')
  })

  it('resolves "confirmed" and closes the dialog when the user confirms', async () => {
    const { result } = renderHook(() => useHouseholdGroupConflictConfirm())

    let outcome: string | undefined
    let pending: Promise<string>
    act(() => {
      pending = result.current.confirmAdd({
        householdName: 'Johnson',
        existingGroupName: 'Lake cabins',
        targetGroupName: 'Ridge cabins',
      })
    })
    act(() => {
      result.current.dialogState.onConfirm()
    })
    await act(async () => {
      outcome = await pending
    })

    expect(outcome).toBe('confirmed')
    expect(result.current.dialogState.isOpen).toBe(false)
  })

  it('resolves "cancelled" and closes the dialog when the user cancels', async () => {
    const { result } = renderHook(() => useHouseholdGroupConflictConfirm())

    let outcome: string | undefined
    let pending: Promise<string>
    act(() => {
      pending = result.current.confirmAdd({
        householdName: 'Johnson',
        existingGroupName: 'Lake cabins',
        targetGroupName: 'Ridge cabins',
      })
    })
    act(() => {
      result.current.dialogState.onCancel()
    })
    await act(async () => {
      outcome = await pending
    })

    expect(outcome).toBe('cancelled')
    expect(result.current.dialogState.isOpen).toBe(false)
  })

  it('releases a still-pending confirm as "cancelled" when a second call supersedes it', async () => {
    // Mirrors useGroupConflictConfirm's supersede test: a caller iterating
    // households sequentially must never leave a prior awaiter hanging.
    const { result } = renderHook(() => useHouseholdGroupConflictConfirm())

    let firstOutcome: string | undefined
    let first: Promise<string>
    act(() => {
      first = result.current.confirmAdd({
        householdName: 'Johnson',
        existingGroupName: 'Lake cabins',
        targetGroupName: 'Ridge cabins',
      })
    })

    let second: Promise<string>
    act(() => {
      second = result.current.confirmAdd({
        householdName: 'Garcia',
        existingGroupName: 'Pine cabins',
        targetGroupName: 'Ridge cabins',
      })
    })

    await act(async () => {
      firstOutcome = await first
    })
    expect(firstOutcome).toBe('cancelled')
    expect(result.current.dialogState.isOpen).toBe(true)
    expect(result.current.dialogState.householdName).toBe('Garcia')

    act(() => {
      result.current.dialogState.onConfirm()
    })
    await act(async () => {
      await second
    })
  })

  it('resolves a pending confirm as "cancelled" when the host unmounts', async () => {
    const { result, unmount } = renderHook(() => useHouseholdGroupConflictConfirm())

    let pending: Promise<string>
    act(() => {
      pending = result.current.confirmAdd({
        householdName: 'Johnson',
        existingGroupName: 'Lake cabins',
        targetGroupName: 'Ridge cabins',
      })
    })

    unmount()

    const outcome = await pending!
    expect(outcome).toBe('cancelled')
  })
})
