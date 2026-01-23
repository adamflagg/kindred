import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { pb } from '../../lib/pocketbase';
import { useYear } from '../../hooks/useCurrentYear';
import { queryKeys, syncDataOptions } from '../../utils/queryKeys';

export interface EntitySyncOptionsState {
  includeCustomFieldValues: boolean;
  session: string; // "all", "1", "2", "2a", etc. (only used if includeCustomFieldValues is true)
  debug: boolean;
}

interface EntitySyncOptionsProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (options: EntitySyncOptionsState) => void;
  isProcessing: boolean;
  // Note: "persons" is a combined sync that populates persons and households tables
  // from a single API call (tags are stored as multi-select relation on persons)
  entityType: 'persons';
}

// Note: "persons" is a combined sync that populates persons and households
const ENTITY_CONFIG = {
  persons: {
    title: 'Persons Sync',
    description: 'Sync persons & households from CampMinder',
    icon: User,
    color: 'violet',
    bgClass: 'bg-violet-100 dark:bg-violet-900/40',
    textClass: 'text-violet-600 dark:text-violet-400',
    buttonBg: 'bg-violet-600 hover:bg-violet-700',
    cfWarning: 'Custom field values requires 1 API call per person (~500 calls for active campers).',
  },
};

// Regex patterns to extract friendly names from session names (matches backend logic)
const SESSION_NAME_PATTERN = /Session\s+(\d+[a-z]?)/i;
const TOC_PATTERN = /Taste\s+of\s+Camp/i;

function extractFriendlyName(name: string): string | null {
  if (TOC_PATTERN.test(name)) return '1';
  const match = name.match(SESSION_NAME_PATTERN);
  const captured = match?.[1];
  return captured ? captured.toLowerCase() : null;
}

export default function EntitySyncOptions({
  isOpen,
  onClose,
  onSubmit,
  isProcessing,
  entityType,
}: EntitySyncOptionsProps) {
  const currentYear = useYear();

  const [includeCustomFieldValues, setIncludeCustomFieldValues] = useState(false);
  const [session, setSession] = useState<string>('all');
  const [debug, setDebug] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  const config = ENTITY_CONFIG[entityType];
  const Icon = config.icon;

  // Reset form when modal closes (render-time check to avoid setState in effect)
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(isOpen);
    setIncludeCustomFieldValues(false);
    setSession('all');
    setDebug(false);
  } else if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
  }

  // Fetch sessions dynamically from database (adapts to each year)
  const { data: sessions } = useQuery({
    queryKey: queryKeys.sessions(currentYear),
    queryFn: async () => {
      const records = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${currentYear} && (session_type = "main" || session_type = "embedded")`,
        sort: 'start_date',
      });
      return records;
    },
    ...syncDataOptions, // 1 hour stale - sessions don't change often
    enabled: isOpen && includeCustomFieldValues, // Only fetch when modal is open AND custom fields enabled
  });

  // Build session options dynamically from database
  const sessionOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [{ value: 'all', label: 'All Sessions' }];

    if (sessions) {
      // Sort logically: 1, 2, 2a, 2b, 3, 3a, 4
      const sorted = [...sessions].sort((a, b) => {
        const aName = extractFriendlyName(a.name) || '';
        const bName = extractFriendlyName(b.name) || '';
        // Compare numeric part first, then alpha suffix
        const aNum = parseInt(aName) || 0;
        const bNum = parseInt(bName) || 0;
        if (aNum !== bNum) return aNum - bNum;
        return aName.localeCompare(bName);
      });

      for (const s of sorted) {
        const friendly = extractFriendlyName(s.name);
        if (friendly) {
          options.push({ value: friendly, label: s.name });
        }
      }
    }

    return options;
  }, [sessions]);

  const handleSubmit = () => {
    onSubmit({ includeCustomFieldValues, session, debug });
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
                    value={session}
                    onChange={(e) => setSession(e.target.value)}
                    disabled={isProcessing}
                    className="w-full px-4 py-2.5 border border-border rounded-lg bg-background text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sessionOptions.map((opt) => (
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

              {/* Debug Checkbox */}
              <div>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={debug}
                    onChange={(e) => setDebug(e.target.checked)}
                    disabled={isProcessing}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 focus:ring-offset-0 disabled:opacity-50"
                  />
                  <span className="text-sm group-hover:text-foreground transition-colors">
                    Debug logging
                  </span>
                </label>
                <p className="text-xs text-muted-foreground ml-7">
                  Enable verbose logging for troubleshooting
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
