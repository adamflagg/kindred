/**
 * FriendGroupMoveDialog — confirms moving a household out of one weekend
 * friend group and into another (kindred#1913 half 2, Option A).
 *
 * Forked from `GroupConflictDialog`, not reused: the copy describes a
 * different consequence, not just a different noun. Summer's dialog warns
 * that the solver will MERGE two camper groups — both memberships survive.
 * A household has no solver merge to lean on (migration 1500000146 leaves
 * one-group-per-household unenforced at the schema layer on purpose), so
 * kindred#1913 half 2's approved design enforces it here instead: confirming
 * MOVES the household out of the old group, it does not leave it in both.
 * See `useHouseholdGroupConflictConfirm.ts` for the fuller argument.
 */

import { Modal } from '../ui/Modal'

interface FriendGroupMoveDialogProps {
  isOpen: boolean
  householdName: string
  existingGroupName: string
  targetGroupName: string
  onConfirm: () => void
  onCancel: () => void
}

export function FriendGroupMoveDialog({
  isOpen,
  householdName,
  existingGroupName,
  targetGroupName,
  onConfirm,
  onCancel,
}: FriendGroupMoveDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Household already in a friend group"
      size="sm"
      footer={
        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={onCancel}
            className="hover:bg-muted rounded-lg border px-4 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm transition-colors"
          >
            Move household
          </button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed">
        <strong>{householdName}</strong> is already in friend group{' '}
        <strong>&ldquo;{existingGroupName}&rdquo;</strong>. A household can only be in one friend
        group at a time — moving it to <strong>&ldquo;{targetGroupName}&rdquo;</strong> will take it
        out of &ldquo;{existingGroupName}&rdquo;.
      </p>
    </Modal>
  )
}
