import { useState } from 'react'
import { Modal } from './ui/Modal'

interface Scenario {
  id: string
  name: string
  description?: string
}

interface ScenarioEditModalProps {
  scenario: Scenario
  onClose: () => void
  onSave: (scenarioId: string, updates: { name?: string; description?: string }) => Promise<void>
}

export default function ScenarioEditModal({ scenario, onClose, onSave }: ScenarioEditModalProps) {
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
    <Modal isOpen={true} onClose={onClose} title="Edit Scenario" size="sm">
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
    </Modal>
  )
}
