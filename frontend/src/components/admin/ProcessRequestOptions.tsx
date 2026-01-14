import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { pb } from '../../lib/pocketbase';
import { useYear } from '../../hooks/useCurrentYear';
import { queryKeys, syncDataOptions } from '../../utils/queryKeys';

export interface ProcessRequestOptionsState {
  session: string;
  limit: number | undefined;
  forceReprocess: boolean;
  sourceFields: string[];
}

interface ProcessRequestOptionsProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (options: ProcessRequestOptionsState) => void;
  isProcessing: boolean;
}

// Regex patterns to extract friendly names from session names (matches Python backend)
const SESSION_NAME_PATTERN = /Session\s+(\d+[a-z]?)/i;
const TOC_PATTERN = /Taste\s+of\s+Camp/i;

function extractFriendlyName(name: string): string | null {
  if (TOC_PATTERN.test(name)) return '1';
  const match = name.match(SESSION_NAME_PATTERN);
  const captured = match?.[1];
  return captured ? captured.toLowerCase() : null;
}

// Source field options (static - these don't change between years)
const SOURCE_FIELD_OPTIONS = [
  { value: 'bunk_with', label: 'Bunk With' },
  { value: 'not_bunk_with', label: 'Not Bunk With' },
  { value: 'bunking_notes', label: 'Bunking Notes' },
  { value: 'internal_notes', label: 'Internal Notes' },
  { value: 'socialize_with', label: 'Socialize With' },
] as const;

export default function ProcessRequestOptions({
  isOpen,
  onClose,
  onSubmit,
  isProcessing,
}: ProcessRequestOptionsProps) {
  const currentYear = useYear();

  const [session, setSession] = useState<string>('all');
  const [limitValue, setLimitValue] = useState<string>('');
  const [forceReprocess, setForceReprocess] = useState(false);
  const [sourceFields, setSourceFields] = useState<string[]>([]);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  // Reset form when modal closes (render-time check to avoid setState in effect)
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(isOpen);
    setSession('all');
    setLimitValue('');
    setForceReprocess(false);
    setSourceFields([]);
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
    enabled: isOpen, // Only fetch when modal is open
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


  const handleSourceFieldToggle = (field: string) => {
    setSourceFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const handleSubmit = () => {
    const parsedLimit = parseInt(limitValue, 10);
    const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

    onSubmit({
      session,
      limit,
      forceReprocess,
      sourceFields,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-100 dark:bg-teal-900/40">
            <Brain className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold" role="heading" aria-level={2}>
              Process Requests
            </h2>
            <p className="text-sm text-muted-foreground">
              Process original bunk requests with AI parsing
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Session Selector */}
          <div>
            <label htmlFor="session-select" className="block text-sm font-medium mb-1.5">
              Session
            </label>
            <div className="relative">
              <select
                id="session-select"
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
          </div>

          {/* Source Fields */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Source Fields</label>
            <p className="text-xs text-muted-foreground mb-2">
              Filter by field type (empty = all fields)
            </p>
            <div className="space-y-2">
              {SOURCE_FIELD_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sourceFields.includes(opt.value)}
                    onChange={() => handleSourceFieldToggle(opt.value)}
                    disabled={isProcessing}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 focus:ring-offset-0 disabled:opacity-50"
                    aria-label={opt.label}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Limit Input */}
          <div>
            <label htmlFor="limit-input" className="block text-sm font-medium mb-1.5">
              Limit (optional)
            </label>
            <input
              id="limit-input"
              type="number"
              value={limitValue}
              onChange={(e) => setLimitValue(e.target.value)}
              placeholder="No limit"
              min="1"
              disabled={isProcessing}
              className="w-full px-4 py-2.5 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Limit the number of requests to process (for testing)
            </p>
          </div>

          {/* Force Reprocess Checkbox */}
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={forceReprocess}
                onChange={(e) => setForceReprocess(e.target.checked)}
                disabled={isProcessing}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 focus:ring-offset-0 disabled:opacity-50"
                aria-describedby={forceReprocess ? 'force-warning' : undefined}
              />
              <span className="text-sm font-medium group-hover:text-foreground transition-colors">
                Force reprocess
              </span>
            </label>

            {/* Warning when force is enabled */}
            {forceReprocess && (
              <div
                id="force-warning"
                className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50"
              >
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  <strong>Warning:</strong> This will clear processed flags and delete existing parsed
                  requests for the selected scope, then reprocess from scratch.
                </p>
              </div>
            )}
          </div>
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
            className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Process'
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
