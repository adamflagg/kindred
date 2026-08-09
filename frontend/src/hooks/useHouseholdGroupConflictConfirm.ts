/**
 * useHouseholdGroupConflictConfirm — drives the warning shown before a
 * household is put into a SECOND weekend friend group (kindred#1913).
 *
 * Forked from `useGroupConflictConfirm`, NOT reused, and not merely for the
 * camper/household wording. That hook's first half is an async PocketBase
 * query scoped by `scenario` to discover whether the camper is already
 * grouped. A weekend friend group has no scenario dimension at all
 * (migration 1500000146) and the caller here (`WeekendFriendGroups`)
 * already holds the FULL groups list for the weekend from
 * `useWeekendFriendGroups` — there is nothing left to fetch. Detection is a
 * synchronous `householdGroupIndex` lookup the caller does itself; this hook
 * is only the dialog half: open, await the user, resolve.
 *
 * The OUTCOME is summer's, and that is the whole point of the 2026-08-09
 * owner ruling. Confirming ADDS a second membership and leaves the first
 * alone — `addCamperToGroup` (`LockGroupContext`) does exactly that, and no
 * summer path deletes an old membership to make a new one. An earlier cut of
 * this hook was called `confirmMove` and its caller drained the source group;
 * that was a divergence nobody asked for, and it half-applied whenever the
 * drain would have taken the source group below two households.
 *
 * Usage:
 * ```tsx
 * const { confirmAdd, dialogState } = useHouseholdGroupConflictConfirm()
 * const outcome = await confirmAdd({ householdName, existingGroupName, targetGroupName })
 * if (outcome === 'cancelled') return
 * // outcome is 'confirmed' — add to the target, touching nothing else
 * <FriendGroupConflictDialog {...dialogState} />
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type ConflictOutcome = 'confirmed' | 'cancelled'

export interface ConfirmAddParams {
  /** Display label for the household being added (dialog copy only). */
  householdName: string
  /** Name of a group the household is already in. */
  existingGroupName: string
  /** Name of the group it would ALSO join. */
  targetGroupName: string
}

export interface HouseholdConflictDialogState {
  isOpen: boolean
  householdName: string
  existingGroupName: string
  targetGroupName: string
  onConfirm: () => void
  onCancel: () => void
}

export interface UseHouseholdGroupConflictConfirmReturn {
  confirmAdd: (params: ConfirmAddParams) => Promise<ConflictOutcome>
  dialogState: HouseholdConflictDialogState
}

export function useHouseholdGroupConflictConfirm(): UseHouseholdGroupConflictConfirmReturn {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [householdName, setHouseholdName] = useState('')
  const [existingGroupName, setExistingGroupName] = useState('')
  const [targetGroupName, setTargetGroupName] = useState('')

  // Promise resolver ref — set while a confirmAdd() call is awaiting the
  // user's response. Mirrors useGroupConflictConfirm's resolveRef exactly.
  const resolveRef = useRef<((outcome: ConflictOutcome) => void) | null>(null)

  const onConfirm = useCallback(() => {
    setDialogOpen(false)
    resolveRef.current?.('confirmed')
    resolveRef.current = null
  }, [])

  const onCancel = useCallback(() => {
    setDialogOpen(false)
    resolveRef.current?.('cancelled')
    resolveRef.current = null
  }, [])

  // Release any pending awaiter on unmount so a caller mid-loop doesn't hang.
  useEffect(() => {
    return () => {
      resolveRef.current?.('cancelled')
      resolveRef.current = null
    }
  }, [])

  const confirmAdd = useCallback(
    ({ householdName, existingGroupName, targetGroupName }: ConfirmAddParams) => {
      // A caller iterating several households sequentially (the board's
      // "Add to group" flow) must never leave a prior awaiter hanging if it
      // starts a second confirm before the first resolved.
      resolveRef.current?.('cancelled')

      setHouseholdName(householdName)
      setExistingGroupName(existingGroupName)
      setTargetGroupName(targetGroupName)
      setDialogOpen(true)

      return new Promise<ConflictOutcome>((resolve) => {
        resolveRef.current = resolve
      })
    },
    []
  )

  return {
    confirmAdd,
    dialogState: {
      isOpen: dialogOpen,
      householdName,
      existingGroupName,
      targetGroupName,
      onConfirm,
      onCancel,
    },
  }
}
