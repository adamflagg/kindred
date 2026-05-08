/**
 * useGroupConflictConfirm — detects cross-group membership conflicts and drives
 * a confirmation dialog.
 *
 * When a camper is about to be added to a friend group but is already a member
 * of a DIFFERENT group in the same scenario, the solver will merge the two groups
 * into a super-group at solve time.  This hook surfaces that consequence to staff
 * so they can make an informed choice.
 *
 * Usage:
 * ```tsx
 * const { checkConflict, dialogState } = useGroupConflictConfirm()
 *
 * // Before creating/adding:
 * const result = await checkConflict({ attendeePbId, targetGroupId, targetGroupName, scenarioId })
 * if (result === 'cancelled') return
 * // result is null (no conflict) or 'confirmed' (conflict, user chose to proceed)
 * await pb.collection('locked_group_members').create(...)
 *
 * // Render the dialog:
 * <GroupConflictDialog {...dialogState} />
 * ```
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { pb } from '../lib/pocketbase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckConflictParams {
  /** PocketBase ID of the attendee record being added */
  attendeePbId: string
  /** PocketBase ID of the group the camper is being added to */
  targetGroupId: string
  /** Display name of that target group (shown in dialog) */
  targetGroupName: string
  /** PocketBase ID of the active scenario (scopes the conflict check) */
  scenarioId: string
}

/** Returned from checkConflict:
 * - `null`        — no conflict, proceed without interruption
 * - `'confirmed'` — conflict detected, user chose to continue
 * - `'cancelled'` — conflict detected, user chose to abort
 */
export type ConflictOutcome = null | 'confirmed' | 'cancelled'

export interface DialogState {
  isOpen: boolean
  existingGroupName: string
  targetGroupName: string
  onConfirm: () => void
  onCancel: () => void
}

export interface UseGroupConflictConfirmReturn {
  checkConflict: (params: CheckConflictParams) => Promise<ConflictOutcome>
  dialogState: DialogState
}

// ── Minimal PB record shapes we need ──────────────────────────────────────────

interface MemberRecord {
  id: string
  attendee: string
  group: string
}

interface GroupRecord {
  id: string
  name: string
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGroupConflictConfirm(): UseGroupConflictConfirmReturn {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [existingGroupName, setExistingGroupName] = useState('')
  const [targetGroupNameState, setTargetGroupNameState] = useState('')

  // Promise resolver refs — set when a check is pending user response
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

  // Release any pending dialog awaiter on unmount so callers don't hang forever.
  useEffect(() => {
    return () => {
      resolveRef.current?.('cancelled')
      resolveRef.current = null
    }
  }, [])

  const checkConflict = useCallback(
    async ({
      attendeePbId,
      targetGroupId,
      targetGroupName,
      scenarioId,
    }: CheckConflictParams): Promise<ConflictOutcome> => {
      // Query all locked_group_members rows for this attendee where the group's
      // scenario matches. We expand the group relation to get the scenario field.
      const filter = pb.filter('attendee = {:attendee} && group.scenario = {:scenario}', {
        attendee: attendeePbId,
        scenario: scenarioId,
      })

      // Treat fetch failure as no-conflict (safe degradation, mirrors the
      // pattern from PR #481): blocking the create flow on a transient PB blip
      // is worse than letting staff verify visually after the fact.
      let members: MemberRecord[]
      try {
        members = await pb.collection('locked_group_members').getFullList<MemberRecord>({
          filter,
          expand: 'group',
        })
      } catch (err) {
        console.warn('useGroupConflictConfirm: members fetch failed, skipping check', err)
        return null
      }

      // Find any membership that is NOT in the target group
      const conflictMember = members.find((m) => m.group !== targetGroupId)

      if (!conflictMember) {
        // No conflict — camper is either not in any group or already in target group
        return null
      }

      // Resolve the conflicting group's name
      let conflictGroupName = 'another friend group'
      try {
        const groups = await pb.collection('locked_groups').getFullList<GroupRecord>({
          filter: pb.filter('id = {:id}', { id: conflictMember.group }),
        })
        const found = groups[0]
        if (found?.name) {
          conflictGroupName = found.name
        }
      } catch {
        // Non-critical — fall back to generic label
      }

      // If a prior call is still awaiting user response, release it as
      // 'cancelled' before installing the new resolver — otherwise the old
      // awaiter would hang forever.
      resolveRef.current?.('cancelled')

      // Open dialog and wait for user response
      setExistingGroupName(conflictGroupName)
      setTargetGroupNameState(targetGroupName)
      setDialogOpen(true)

      return new Promise<ConflictOutcome>((resolve) => {
        resolveRef.current = resolve
      })
    },
    []
  )

  return {
    checkConflict,
    dialogState: {
      isOpen: dialogOpen,
      existingGroupName,
      targetGroupName: targetGroupNameState,
      onConfirm,
      onCancel,
    },
  }
}
