import { useState } from 'react';
import { User, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';

export interface EntitySyncOptionsState {
  includeCustomFieldValues: boolean;
  sessionFilter: number; // 0 = all, 1-4 = specific session (only used if includeCustomFieldValues is true)
}

interface EntitySyncOptionsProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (options: EntitySyncOptionsState) => void;
  isProcessing: boolean;
  // Note: "persons" is a combined sync that populates persons, households, AND person_tags
  // tables from a single API call - there is no separate households entity type
  entityType: 'persons';
}

// Note: "persons" is a combined sync that populates persons, households, AND person_tags
const ENTITY_CONFIG = {
  persons: {
    title: 'Persons Sync',
    description: 'Sync persons, households & tags from CampMinder',
    icon: User,
    color: 'violet',
    bgClass: 'bg-violet-100 dark:bg-violet-900/40',
    textClass: 'text-violet-600 dark:text-violet-400',
    buttonBg: 'bg-violet-600 hover:bg-violet-700',
    cfWarning: 'Custom field values requires 1 API call per person (~500 calls for active campers).',
  },
};

const SESSION_OPTIONS = [
  { value: 0, label: 'All Sessions' },
  { value: 1, label: 'Session 1 (Taste of Camp)' },
  { value: 2, label: 'Session 2' },
  { value: 3, label: 'Session 3' },
  { value: 4, label: 'Session 4' },
];

export default function EntitySyncOptions({
  isOpen,
  onClose,
  onSubmit,
  isProcessing,
  entityType,
}: EntitySyncOptionsProps) {
  const [includeCustomFieldValues, setIncludeCustomFieldValues] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<number>(0);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  const config = ENTITY_CONFIG[entityType];
  const Icon = config.icon;

  // Reset form when modal closes
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(isOpen);
    setIncludeCustomFieldValues(false);
    setSessionFilter(0);
  } else if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
  }

  const handleSubmit = () => {
    onSubmit({ includeCustomFieldValues, sessionFilter });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${config.bgClass}`}>
            <Icon className={`w-5 h-5 ${config.textClass}`} />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold" role="heading" aria-level={2}>
              {config.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {config.description}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Include Custom Field Values Checkbox */}
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={includeCustomFieldValues}
                onChange={(e) => setIncludeCustomFieldValues(e.target.checked)}
                disabled={isProcessing}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 focus:ring-offset-0 disabled:opacity-50"
              />
              <span className="text-sm font-medium group-hover:text-foreground transition-colors">
                Also sync custom field values
              </span>
            </label>
            <p className="text-xs text-muted-foreground ml-7">
              Sync custom field values after the main {entityType} sync completes
            </p>
          </div>

          {/* Warning and session filter when custom field values enabled */}
          {includeCustomFieldValues && (
            <>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {config.cfWarning} Select a specific session to reduce API calls.
                </p>
              </div>

              {/* Session Filter Selector */}
              <div>
                <label htmlFor="session-filter-select" className="block text-sm font-medium mb-1.5">
                  Session Filter (for custom field values)
                </label>
                <div className="relative">
                  <select
                    id="session-filter-select"
                    value={sessionFilter}
                    onChange={(e) => setSessionFilter(parseInt(e.target.value))}
                    disabled={isProcessing}
                    className="w-full px-4 py-2.5 border border-border rounded-lg bg-background text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {SESSION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Filter to only sync custom fields for {entityType} in the selected session
                </p>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isProcessing}
            className={`flex-1 px-4 py-2.5 ${config.buttonBg} text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Syncing...
              </>
            ) : (
              'Run Sync'
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
