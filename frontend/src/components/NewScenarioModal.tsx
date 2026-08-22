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
  /** Set only when this creation ran a copy — see useScenario.ts's Scenario. */
  copy_skipped?: number | null
}

interface NewScenarioModalProps {
  sessionId: number
  onClose: () => void
  /**
   * Called with the created scenario and the copy source that was chosen.
   *
   * AWAITED. `POST /api/scenarios` does the copy as part of creating the
   * record (kindred#2021, program-aware server-side — weekend and summer
   * both), so by the time this fires the scenario is already fully seeded;
   * a caller has nothing left to do but react to it. `copyFrom` is kept for
   * callers that still branch on it (e.g. a toast wording the source), not
   * because there is a second call to make.
   */
  onScenarioCreated: (scenario: Scenario, copyFrom: string) => void | Promise<void>
  /**
   * Whether "Copy from CampMinder" is on offer. Defaults to true for both
   * programs (kindred#2021) — `POST /api/scenarios` is program-aware
   * server-side, so this is no longer a summer-only working copy source.
   * `false` is for a caller with no source to copy FROM at all, not a
   * program distinction.
   */
  canCopyFromProduction?: boolean
  /**
   * Whether copy-from-another-scenario is on offer. Defaults to true for
   * both programs, for the same reason as `canCopyFromProduction`.
   */
  canCopyFromScenario?: boolean
  /**
   * Label for the no-copy radio. Summer starts with empty BUNKS; a weekend has
   * none and places parties into cabins, so it names the thing it starts empty
   * (CLAUDE.md §4 — model the pattern, not the vocabulary). The one
   * deliberate wording divergence between programs; everything else about
   * this modal — the three choices, their order, the layout — is identical.
   */
  emptyLabel?: string
}

export default function NewScenarioModal({
  sessionId,
  onClose,
  onScenarioCreated,
  canCopyFromProduction = true,
  canCopyFromScenario = true,
  emptyLabel = 'Start with empty bunks',
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

  const sessionScenarios = canCopyFromScenario
    ? scenarios.filter((scenario) => scenario.session_cm_id === sessionId)
    : []

  /** What `POST /api/scenarios` should copy as part of creating the record. */
  const copyOptions = () => {
    if (copyFrom === 'production') return { fromProduction: true }
    if (copyFrom === 'none') return { fromProduction: false }
    return { fromScenario: copyFrom }
  }

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
        copyOptions()
      )
      // Awaited on purpose — see `onScenarioCreated`. A caller that returns
      // void behaves exactly as before.
      await onScenarioCreated(scenario, copyFrom)
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
          {/* Group label for the radio set below — not a single-control
              <label>, since there's no one input to associate it with. */}
          <span id="copy-from-label" className="mb-2 block text-sm font-medium">
            Copy Assignments From
          </span>
          <div role="radiogroup" aria-labelledby="copy-from-label" className="space-y-2">
            <label className="flex cursor-pointer items-center space-x-2">
              <input
                type="radio"
                name="copy-from"
                value="none"
                checked={copyFrom === 'none'}
                onChange={(e) => setCopyFrom(e.target.value)}
                className="text-primary focus:ring-primary h-4 w-4 focus:ring-2"
              />
              <span className="text-sm">{emptyLabel}</span>
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

            {sessionScenarios.length > 0 && (
              <>
                <div className="border-border my-2 border-t" />
                <div className="text-muted-foreground mb-1 text-xs">Copy from scenario:</div>
                {sessionScenarios.map((scenario) => (
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
