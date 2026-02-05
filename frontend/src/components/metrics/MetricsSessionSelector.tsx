/**
 * MetricsSessionSelector - Unified session dropdown for metrics module
 *
 * Consumes MetricsSessionContext to provide a session filter that applies
 * across all metrics tabs (Registration, Retention, Trends).
 *
 * This component replaces both RegistrationSessionSelector and
 * RetentionSessionSelector with a single, context-driven implementation.
 */

import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/react";
import { ChevronDown, CalendarDays } from "lucide-react";
import { useMetricsSession } from "../../hooks/useMetricsSession";

export function MetricsSessionSelector() {
  const {
    selectedSessionCmId,
    selectedSession,
    sessions,
    isLoading,
    setSelectedSessionCmId,
  } = useMetricsSession();

  // Display name for current selection
  const displayName = selectedSession?.name ?? "All Sessions";

  const handleChange = (value: string) => {
    if (value === "all") {
      setSelectedSessionCmId(null);
    } else {
      setSelectedSessionCmId(Number(value));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <Listbox
        value={selectedSessionCmId?.toString() ?? "all"}
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
