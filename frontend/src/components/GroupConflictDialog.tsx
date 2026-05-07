/**
 * GroupConflictDialog — warns staff before adding a camper to a second friend
 * group in the same scenario.
 *
 * The solver handles overlapping groups by merging them transitively into a
 * super-group at solve time, which is not necessarily wrong — but staff should
 * know it will happen.  This dialog surfaces that consequence and asks for
 * confirmation before the create proceeds.
 */

import { Modal } from './ui/Modal'

interface GroupConflictDialogProps {
  isOpen: boolean
  camperName: string
  existingGroupName: string
  targetGroupName: string
  onConfirm: () => void
  onCancel: () => void
}

export function GroupConflictDialog({
  isOpen,
  camperName,
  existingGroupName,
  targetGroupName,
  onConfirm,
  onCancel,
}: GroupConflictDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Camper already in a friend group"
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
        <strong>{camperName}</strong> is already in friend group{' '}
        <strong>&ldquo;{existingGroupName}&rdquo;</strong>. Adding them to{' '}
        <strong>&ldquo;{targetGroupName}&rdquo;</strong> will cause the solver to merge these groups
        into one super-group when the scenario is solved.
      </p>
      <p className="text-muted-foreground mt-3 text-xs">
        The solver handles this gracefully — it is not an error. You can always remove the camper
        from one of the groups afterwards if the merge is not intended.
      </p>
    </Modal>
  )
}
