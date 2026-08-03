import { useState } from 'react'
import { Package, FlaskConical } from 'lucide-react'
import { useScenario } from '../hooks/useScenario'
import { useYear } from '../hooks/useCurrentYear'
import { Modal } from './ui/Modal'

interface Scenario {
  id: string
  name: string
  session_cm_id: number
  created_by?: string
  is_active: boolean
  description?: string
}

interface NewScenarioModalProps {
  sessionId: number
  onClose: () => void
  onScenarioCreated: (scenario: Scenario) => void
  /**
   * Whether "Copy from CampMinder" is on offer. Summer keeps it (and keeps it
   * as the DEFAULT — do not flip that, `SessionView` and
   * `ScenarioManagementModal` both depend on it).
   *
   * Weekend passes false. That copy is `api/routers/scenarios.py:96-103`,
   * which copies `bunk_assignments` filtered by session and returns zero rows
   * for a weekend — inert rather than harmful, but an option that silently
   * does nothing is worse than no option. The lodging seed is a separate
   * endpoint on a separate affordance (kindred#1967, #1974).
   */
  canCopyFromProduction?: boolean
}

export default function NewScenarioModal({
  sessionId,
  onClose,
  onScenarioCreated,
  canCopyFromProduction = true,
}: NewScenarioModalProps) {
  const { createScenario, scenarios } = useScenario()
  const currentYear = useYear()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // Defaulting to 'production' with the option hidden would leave no radio
  // checked and quietly run a copy nobody chose.
  const [copyFrom, setCopyFrom] = useState<'none' | 'production' | string>(
    canCopyFromProduction ? 'production' : 'none'
  )
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Scenario name is required')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const scenario = await createScenario(
        name.trim(),
        sessionId,
        currentYear,
        description.trim() || undefined,
        copyFrom === 'production'
          ? { fromProduction: true }
          : copyFrom === 'none'
            ? { fromProduction: false }
            : { fromScenario: copyFrom }
      )
      onScenarioCreated(scenario)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scenario')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Create New Scenario" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="scenario-name" className="mb-2 block text-sm font-medium">
            Scenario Name
          </label>
          <input
            id="scenario-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Option A - Mixed Age Groups"
            className="bg-background border-input focus:ring-primary w-full rounded-lg border px-4 py-2 focus:ring-2 focus:outline-none"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="scenario-description" className="mb-2 block text-sm font-medium">
            Description (Optional)
          </label>
          <textarea
            id="scenario-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of this scenario..."
            rows={3}
            className="bg-background border-input focus:ring-primary w-full resize-none rounded-lg border px-4 py-2 focus:ring-2 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Copy Assignments From</label>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center space-x-2">
              <input
                type="radio"
                name="copy-from"
                value="none"
                checked={copyFrom === 'none'}
                onChange={(e) => setCopyFrom(e.target.value)}
                className="text-primary focus:ring-primary h-4 w-4 focus:ring-2"
              />
              <span className="text-sm">Start with empty bunks</span>
            </label>

            {canCopyFromProduction && (
              <label className="flex cursor-pointer items-center space-x-2">
                <input
                  type="radio"
                  name="copy-from"
                  value="production"
                  checked={copyFrom === 'production'}
                  onChange={(e) => setCopyFrom(e.target.value)}
                  className="text-primary focus:ring-primary h-4 w-4 focus:ring-2"
                />
                <span className="flex items-center gap-2 text-sm">
                  <Package className="text-primary h-4 w-4" />
                  Copy from CampMinder
                </span>
              </label>
            )}

            {scenarios.filter((s) => s.session_cm_id === sessionId).length > 0 && (
              <>
                <div className="border-border my-2 border-t" />
                <div className="text-muted-foreground mb-1 text-xs">Copy from scenario:</div>
                {scenarios
                  .filter((s) => s.session_cm_id === sessionId)
                  .map((scenario) => (
                    <label key={scenario.id} className="flex cursor-pointer items-center space-x-2">
                      <input
                        type="radio"
                        name="copy-from"
                        value={scenario.id}
                        checked={copyFrom === scenario.id}
                        onChange={(e) => setCopyFrom(e.target.value)}
                        className="text-primary focus:ring-primary h-4 w-4 focus:ring-2"
                      />
                      <span className="flex items-center gap-2 text-sm">
                        <FlaskConical className="h-4 w-4 text-orange-500" />
                        {scenario.name}
                      </span>
                    </label>
                  ))}
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">{error}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-muted hover:bg-muted/80 flex-1 rounded-lg px-4 py-2 font-medium transition-colors"
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-primary hover:bg-primary/90 text-primary-foreground flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
            disabled={isCreating}
          >
            {isCreating ? 'Creating...' : 'Create Scenario'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
