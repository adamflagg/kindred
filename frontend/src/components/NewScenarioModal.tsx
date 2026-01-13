import { useState } from 'react';
import { Package, FlaskConical } from 'lucide-react';
import { useScenario } from '../hooks/useScenario';
import { useYear } from '../hooks/useCurrentYear';
import { Modal } from './ui/Modal';

interface Scenario {
  id: string;
  name: string;
  session_cm_id: number;
  created_by?: string;
  is_active: boolean;
  description?: string;
}

interface NewScenarioModalProps {
  sessionId: number;
  onClose: () => void;
  onScenarioCreated: (scenario: Scenario) => void;
}

export default function NewScenarioModal({ sessionId, onClose, onScenarioCreated }: NewScenarioModalProps) {
  const { createScenario, scenarios } = useScenario();
  const currentYear = useYear();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState<'none' | 'production' | string>('production');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Scenario name is required');
      return;
    }
    
    setIsCreating(true);
    setError(null);
    
    try {
      const scenario = await createScenario(
        name.trim(),
        sessionId,
        currentYear,
        description.trim() || undefined,
        copyFrom === 'production' ? { fromProduction: true } :
        copyFrom === 'none' ? { fromProduction: false } :
        { fromScenario: copyFrom }
      );
      onScenarioCreated(scenario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scenario');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Create New Scenario" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="scenario-name" className="block text-sm font-medium mb-2">
            Scenario Name
          </label>
          <input
            id="scenario-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Option A - Mixed Age Groups"
            className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="scenario-description" className="block text-sm font-medium mb-2">
            Description (Optional)
          </label>
          <textarea
            id="scenario-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of this scenario..."
            rows={3}
            className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Copy Assignments From
          </label>
          <div className="space-y-2">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="copy-from"
                value="none"
                checked={copyFrom === 'none'}
                onChange={(e) => setCopyFrom(e.target.value)}
                className="h-4 w-4 text-primary focus:ring-2 focus:ring-primary"
              />
              <span className="text-sm">Start with empty assignments</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="copy-from"
                value="production"
                checked={copyFrom === 'production'}
                onChange={(e) => setCopyFrom(e.target.value)}
                className="h-4 w-4 text-primary focus:ring-2 focus:ring-primary"
              />
              <span className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Copy from Production
              </span>
            </label>

            {scenarios.filter(s => s.session_cm_id === sessionId).length > 0 && (
              <>
                <div className="border-t border-border my-2" />
                <div className="text-xs text-muted-foreground mb-1">Copy from scenario:</div>
                {scenarios.filter(s => s.session_cm_id === sessionId).map(scenario => (
                  <label key={scenario.id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="copy-from"
                      value={scenario.id}
                      checked={copyFrom === scenario.id}
                      onChange={(e) => setCopyFrom(e.target.value)}
                      className="h-4 w-4 text-primary focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-sm flex items-center gap-2">
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
          <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg font-medium transition-colors"
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
            disabled={isCreating}
          >
            {isCreating ? 'Creating...' : 'Create Scenario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}