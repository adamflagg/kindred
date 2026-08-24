import { useState } from 'react'
import { Modal } from './ui/Modal'

interface Scenario {
  id: string
  name: string
  description?: string
}

interface ScenarioEditModalProps {
  /**
   * NOT nullable (kindred#2538). The parent's gate used to BE this data
   * (`{editingScenario && …}`), which is what unmounted the dialog on the
   * close frame and left the exit fade nothing to play. The parent now holds a
   * retained snapshot and gates on that, so this prop is non-null for as long
   * as the dialog is mounted -- the fade included -- and the two `useState`
   * initializers below can keep reading it unconditionally.
   */
  scenario: Scenario
  onClose: () => void
  onSave: (scenarioId: string, updates: { name?: string; description?: string }) => Promise<void>
  /**
   * kindred#2538 tier 2b. Always mounted so ui/Modal's 150ms leave can play;
   * the parent drives this instead of unmounting on close.
   *
   * Optional and defaulting to TRUE, matching NewScenarioModal: an unconverted
   * call site keeps its old conditional-mount behaviour, so a missed site
   * degrades to "no fade" rather than "a modal appears".
   */
  isOpen?: boolean
  /**
   * Per-open nonce from kindred#2541's useRetainedDialog.
   *
   * Keyed on the NONCE and deliberately not on `scenario.id`, which
   * kindred#2538 asked to have a decision recorded for. An id key handles
   * switching to a different scenario but NOT reopening the SAME one after a
   * cancel: the key is unchanged, React reuses the instance, and the abandoned
   * draft is still in the field for the next Save to write. The nonce bumps on
   * every open, so both cases reset.
   */
  nonce?: number
  /** Modal's afterLeave, so the parent can release its retained snapshot. */
  afterLeave?: () => void
}

export default function ScenarioEditModal({
  isOpen = true,
  nonce,
  onClose,
  afterLeave,
  ...body
}: ScenarioEditModalProps) {
  // Thin shell owning the chrome; the form state lives in the body, keyed by
  // the nonce. The key goes on the CONTENT and never on <Modal> -- remounting
  // the chrome mid-leave would snap the fading dialog away (kindred#2541).
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      // Spread: tsconfig sets exactOptionalPropertyTypes, so an explicit
      // `undefined` is not assignable to Modal's `afterLeave?: () => void`.
      {...(afterLeave !== undefined && { afterLeave })}
      title="Edit Scenario"
      size="sm"
    >
      <ScenarioEditForm key={nonce} onClose={onClose} {...body} />
    </Modal>
  )
}

type ScenarioEditFormProps = Omit<ScenarioEditModalProps, 'isOpen' | 'nonce' | 'afterLeave'>

function ScenarioEditForm({ scenario, onClose, onSave }: ScenarioEditFormProps) {
  const [name, setName] = useState(scenario.name)
  const [description, setDescription] = useState(scenario.description ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Scenario name is required')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const updates: { name?: string; description?: string } = {
        name: name.trim(),
      }
      if (description.trim()) {
        updates.description = description.trim()
      }
      await onSave(scenario.id, updates)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scenario')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="edit-scenario-name" className="mb-2 block text-sm font-medium">
          Scenario Name
        </label>
        <input
          id="edit-scenario-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Option A - Mixed Age Groups"
          className="bg-background border-input focus:ring-primary w-full rounded-lg border px-4 py-2 focus:ring-2 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="edit-scenario-description" className="mb-2 block text-sm font-medium">
          Description (Optional)
        </label>
        <textarea
          id="edit-scenario-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the purpose of this scenario..."
          rows={3}
          className="bg-background border-input focus:ring-primary w-full resize-none rounded-lg border px-4 py-2 focus:ring-2 focus:outline-none"
        />
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">{error}</div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="bg-muted hover:bg-muted/80 flex-1 rounded-lg px-4 py-2 font-medium transition-colors"
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="bg-primary hover:bg-primary/90 text-primary-foreground flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}
