import { useState } from 'react';
import { Modal } from './ui/Modal';

interface Scenario {
  id: string;
  name: string;
  description?: string;
}

interface ScenarioEditModalProps {
  scenario: Scenario;
  onClose: () => void;
  onSave: (scenarioId: string, updates: { name?: string; description?: string }) => Promise<void>;
}

export default function ScenarioEditModal({ scenario, onClose, onSave }: ScenarioEditModalProps) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Scenario name is required');
      return;
    }
    
    setIsSaving(true);
    setError(null);
    
    try {
      const updates: {name?: string; description?: string} = {
        name: name.trim(),
      };
      if (description.trim()) {
        updates.description = description.trim();
      }
      await onSave(scenario.id, updates);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scenario');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Scenario" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="edit-scenario-name" className="block text-sm font-medium mb-2">
            Scenario Name
          </label>
          <input
            id="edit-scenario-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Option A - Mixed Age Groups"
            className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="edit-scenario-description" className="block text-sm font-medium mb-2">
            Description (Optional)
          </label>
          <textarea
            id="edit-scenario-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of this scenario..."
            rows={3}
            className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        {error && (
          <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg font-medium transition-colors"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}