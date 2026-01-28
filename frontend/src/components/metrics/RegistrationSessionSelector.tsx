/**
 * RegistrationSessionSelector - Session dropdown for registration tab
 *
 * Allows filtering registration metrics to a specific session.
 * Similar to RetentionSessionSelector but for registration data.
 * Uses Headless UI Listbox pattern.
 */

import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { ChevronDown, CalendarDays } from 'lucide-react';
import type { MetricsSession } from '../../hooks/useMetricsSessions';

export type { MetricsSession };

export interface RegistrationSessionSelectorProps {
  /** Available sessions for selection */
  sessions: MetricsSession[];
  /** Currently selected session cm_id (null = all sessions) */
  selectedSessionCmId: number | null;
  /** Callback when session selection changes */
  onSessionChange: (sessionCmId: number | null) => void;
  /** Whether sessions are loading */
  isLoading?: boolean;
}

export function RegistrationSessionSelector({
  sessions,
  selectedSessionCmId,
  onSessionChange,
  isLoading = false,
}: RegistrationSessionSelectorProps) {
  // Find selected session name for display
  const selectedSession = sessions.find((s) => s.cm_id === selectedSessionCmId);
  const displayName = selectedSession?.name ?? 'All Sessions';

  const handleChange = (value: string) => {
    if (value === 'all') {
      onSessionChange(null);
    } else {
      onSessionChange(Number(value));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <Listbox
        value={selectedSessionCmId?.toString() ?? 'all'}
        onChange={handleChange}
        disabled={isLoading}
      >
        <div className="relative">
          <ListboxButton className="listbox-button min-w-[180px]">
            <span className="flex-1 text-left truncate">{displayName}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </ListboxButton>
          <ListboxOptions className="listbox-options w-auto min-w-[180px]">
            <ListboxOption value="all" className="listbox-option">
              All Sessions
            </ListboxOption>
            {sessions.length > 0 && (
              <div className="border-t border-border my-1" />
            )}
            {sessions.map((session) => (
              <ListboxOption
                key={session.cm_id}
                value={session.cm_id.toString()}
                className="listbox-option"
              >
                {session.name}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  );
}
