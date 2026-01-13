interface ClearAssignmentsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ClearAssignmentsDialog({
  isOpen,
  onClose,
  onConfirm,
}: ClearAssignmentsDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="card-lodge p-6 max-w-md w-full mx-4 shadow-lodge-lg animate-scale-in">
        <h2 className="text-xl font-display font-bold mb-4">Clear All Assignments?</h2>
        <p className="text-muted-foreground mb-6">
          Are you sure you want to clear all assignments in this scenario? This action cannot be undone.
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="btn-ghost px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all shadow-lodge"
          >
            Clear Assignments
          </button>
        </div>
      </div>
    </div>
  );
}
