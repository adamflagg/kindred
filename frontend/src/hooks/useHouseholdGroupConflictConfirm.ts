/**
 * useHouseholdGroupConflictConfirm — drives the confirmation dialog for
 * moving a household from one weekend friend group to another
 * (kindred#1913 half 2, Option A).
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
 * The OUTCOME differs from summer's too, and that is the actual behavioural
 * divergence CLAUDE.md §4 asks to be called out, not just the wording.
 * Summer's dialog warns that the solver will MERGE two camper groups
 * transitively — both memberships survive. A household's grain has no
 * solver merge step to lean on: migration 1500000146's header is explicit
 * that nothing enforces one-group-per-household at the schema layer, so
 * kindred#1913 half 2's approved design enforces it in the UI instead —
 * confirming here MOVES the household (removed from the old group, added to
 * the new one), it does not leave it in both.
 *
 * Usage:
 * ```tsx
 * const { confirmMove, dialogState } = useHouseholdGroupConflictConfirm()
 * const outcome = await confirmMove({ householdName, existingGroupName, targetGroupName })
 * if (outcome === 'cancelled') return
 * // outcome is 'confirmed' — perform the move (remove from old, add to new)
 * <FriendGroupMoveDialog {...dialogState} />
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type ConflictOutcome = 'confirmed' | 'cancelled'

export interface ConfirmMoveParams {
  /** Display label for the household being moved (dialog copy only). */
  householdName: string
  /** Name of the group the household is currently in. */
  existingGroupName: string
  /** Name of the group it would move to. */
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
  confirmMove: (params: ConfirmMoveParams) => Promise<ConflictOutcome>
  dialogState: HouseholdConflictDialogState
}

export function useHouseholdGroupConflictConfirm(): UseHouseholdGroupConflictConfirmReturn {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [householdName, setHouseholdName] = useState('')
  const [existingGroupName, setExistingGroupName] = useState('')
  const [targetGroupName, setTargetGroupName] = useState('')

  // Promise resolver ref — set while a confirmMove() call is awaiting the
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

  const confirmMove = useCallback(
    ({ householdName, existingGroupName, targetGroupName }: ConfirmMoveParams) => {
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
    confirmMove,
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
