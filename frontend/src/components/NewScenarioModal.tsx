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

/**
 * A copy source this modal cannot perform itself.
 *
 * `POST /api/scenarios` does the built-in copies as part of creating the
 * record, so they are available before the scenario has an id. A lodging seed
 * is a second endpoint that NEEDS that id, so it cannot ride inside creation —
 * the modal offers the choice and hands it back, and the caller does the work.
 */
export interface ScenarioCopySource {
  /** Radio value, reported verbatim to `onScenarioCreated`. */
  value: string
  label: string
}

interface NewScenarioModalProps {
  sessionId: number
  onClose: () => void
  /**
   * Called with the created scenario and the copy source that was chosen.
   *
   * AWAITED. A caller doing create-then-seed needs the modal to stay busy
   * across both calls; returning in between drops staff on a board with every
   * party missing for the length of the seed. A rejection is shown in the
   * modal's own error box, because by then the scenario exists and reporting
   * a clean create would be a lie.
   */
  onScenarioCreated: (scenario: Scenario, copyFrom: string) => void | Promise<void>
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
  /**
   * Whether copy-from-another-scenario is on offer.
   *
   * Weekend passes false, for the SAME reason and by the same route as
   * `canCopyFromProduction`: these radios map to `{ fromScenario }`, which is
   * the same `POST /api/scenarios` path, copying `bunk_assignments` — zero
   * rows for a weekend. They render whenever the session has a scenario, so a
   * weekend acquired inert radios the moment it had one to list.
   *
   * Copying one weekend plan into another is real and wanted; it needs a
   * source field on `PlacementCopyRequest` that does not exist yet (#1988).
   */
  canCopyFromScenario?: boolean
  /**
   * Label for the no-copy radio. Summer starts with empty BUNKS; a weekend has
   * none and places parties into cabins, so it names the thing it starts empty
   * (CLAUDE.md §4 — model the pattern, not the vocabulary).
   */
  emptyLabel?: string
  /** Sources the CALLER seeds, after creation. See `ScenarioCopySource`. */
  extraSources?: ScenarioCopySource[]
}

export default function NewScenarioModal({
  sessionId,
  onClose,
  onScenarioCreated,
  canCopyFromProduction = true,
  canCopyFromScenario = true,
  emptyLabel = 'Start with empty bunks',
  extraSources = [],
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

  /**
   * What `POST /api/scenarios` should copy as part of creating the record.
   *
   * An extra source resolves to NO copy: the caller performs it afterwards
   * against a different endpoint, and asking this one for a copy it would do
   * wrong is how the inert radios got here in the first place.
   */
  const copyOptions = () => {
    if (copyFrom === 'production') return { fromProduction: true }
    if (copyFrom === 'none') return { fromProduction: false }
    if (extraSources.some((source) => source.value === copyFrom)) return { fromProduction: false }
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

            {extraSources.map((source) => (
              <label key={source.value} className="flex cursor-pointer items-center space-x-2">
                <input
                  type="radio"
                  name="copy-from"
                  value={source.value}
                  checked={copyFrom === source.value}
                  onChange={(e) => setCopyFrom(e.target.value)}
                  className="text-primary focus:ring-primary h-4 w-4 focus:ring-2"
                />
                <span className="flex items-center gap-2 text-sm">
                  <Package className="text-primary h-4 w-4" />
                  {source.label}
                </span>
              </label>
            ))}

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
