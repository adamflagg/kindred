import { useState } from 'react'
import { X, AlertTriangle, FlaskConical, ArrowRight } from 'lucide-react'

interface ProductionSaveConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  onCreateScenario: () => void
}

export default function ProductionSaveConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  onCreateScenario,
}: ProductionSaveConfirmDialogProps) {
  const [understanding, setUnderstanding] = useState(false)

  if (!isOpen) return null

  const handleCreateScenario = () => {
    onClose()
    onCreateScenario()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="bg-card border-border relative mx-4 w-full max-w-lg rounded-xl border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-yellow-600" />
            <h2 className="text-xl font-bold">Production Mode Warning</h2>
          </div>
          <button onClick={onClose} className="hover:bg-muted rounded-lg p-2 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
            <p className="text-sm text-yellow-800">
              <strong>Important:</strong> You are about to save changes in production mode. These
              changes will be <strong>overwritten</strong> during the next sync from CampMinder.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              To preserve your changes permanently, you should:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Lock individual assignments that must be preserved</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Create a scenario to work in a safe environment</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Export your final assignments before the next sync</span>
              </li>
            </ul>
          </div>

          <div className="bg-muted flex items-start gap-2 rounded-lg p-3">
            <input
              id="understanding"
              type="checkbox"
              checked={understanding}
              onChange={(e) => setUnderstanding(e.target.checked)}
              className="border-input bg-background text-primary focus:ring-primary mt-0.5 h-4 w-4 rounded focus:ring-2"
            />
            <label htmlFor="understanding" className="cursor-pointer text-sm">
              I understand that my changes may be lost during the next sync
            </label>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="bg-muted hover:bg-muted/80 flex-1 rounded-lg px-4 py-2 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateScenario}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-yellow-600 px-4 py-2 font-medium text-white transition-colors hover:bg-yellow-700"
          >
            <FlaskConical className="h-4 w-4" />
            Create Scenario
          </button>
          <button
            onClick={onConfirm}
            disabled={!understanding}
            className="bg-primary hover:bg-primary/90 text-primary-foreground flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proceed Anyway
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
