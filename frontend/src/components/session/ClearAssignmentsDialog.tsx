interface ClearAssignmentsDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

export default function ClearAssignmentsDialog({
  isOpen,
  onClose,
  onConfirm,
}: ClearAssignmentsDialogProps) {
  if (!isOpen) return null

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="card-lodge shadow-lodge-lg animate-scale-in mx-4 w-full max-w-md p-6">
        <h2 className="font-display mb-4 text-xl font-bold">Clear All Assignments?</h2>
        <p className="text-muted-foreground mb-6">
          Are you sure you want to clear all assignments in this scenario? This action cannot be
          undone.
        </p>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost px-4 py-2">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-lodge rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
          >
            Clear Assignments
          </button>
        </div>
      </div>
    </div>
  )
}
