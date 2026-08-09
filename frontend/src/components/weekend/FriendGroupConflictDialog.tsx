/**
 * FriendGroupConflictDialog — warns staff before putting a household into a
 * SECOND weekend friend group (kindred#1913).
 *
 * The weekend equivalent of `GroupConflictDialog`, forked rather than reused
 * only because the noun differs; the CONSEQUENCE is now the same, which is
 * the point of the 2026-08-09 owner ruling ("same behavior" as summer).
 * Confirming here ADDS a membership and leaves the existing one alone. It is
 * a warning, not a move.
 *
 * An earlier cut of this file was `FriendGroupMoveDialog`: confirming removed
 * the household from its old group, and the copy asserted that "a household
 * can only be in one friend group at a time". Both were wrong.
 *
 * * Neither summer path deletes an old membership. `addCamperToGroup`
 *   (`LockGroupContext`) only ever creates a row; the sole two
 *   `locked_group_members` deletes in the tree are the explicit per-member X
 *   and dissolve.
 * * The sentence contradicted the very migration it cited. 1500000146's
 *   header says in as many words that NOTHING ENFORCES THAT A HOUSEHOLD
 *   BELONGS TO AT MOST ONE GROUP, and calls a household wanting the same
 *   cabin as one family and to be near another "two groups, not a conflict".
 * * The removal also crossed the two-household floor from the other side:
 *   draining the source group down to one member 422'd AFTER the add to the
 *   target had already been written.
 */

import { Modal } from '../ui/Modal'

interface FriendGroupConflictDialogProps {
  isOpen: boolean
  householdName: string
  existingGroupName: string
  targetGroupName: string
  onConfirm: () => void
  onCancel: () => void
}

export function FriendGroupConflictDialog({
  isOpen,
  householdName,
  existingGroupName,
  targetGroupName,
  onConfirm,
  onCancel,
}: FriendGroupConflictDialogProps) {
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
            Continue
          </button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed">
        <strong>{householdName}</strong> is already in{' '}
        <strong>&ldquo;{existingGroupName}&rdquo;</strong>. Adding them to{' '}
        <strong>&ldquo;{targetGroupName}&rdquo;</strong> leaves them in both.
      </p>
    </Modal>
  )
}
