/**
 * MetricsSessionSelector - Unified session dropdown for metrics module
 *
 * Consumes MetricsSessionContext to provide a session filter that applies
 * across most metrics tabs (hidden on Bunk Analysis tab which uses unfiltered data).
 *
 * Dropdown structure:
 * - At Camp (camp only)
 * - Quests (quest only)
 * - separator
 * - Camp sessions (chronological)
 * - separator (if quests exist)
 * - Quest sessions (chronological)
 */

import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { ChevronDown, CalendarDays } from 'lucide-react'
import { useMetricsSession } from '../../hooks/useMetricsSession'

const ALL_SESSIONS_VALUE = 'all-sessions'
const ALL_QUESTS_VALUE = 'all-quests'
const ALL_SUMMER_VALUE = 'all-summer'

export function MetricsSessionSelector() {
  const {
    selectedSessionCmId,
    selectedSession,
    isLoading,
    viewMode,
    setViewMode,
    setSelectedSessionCmId,
    campSessions,
    questSessions,
  } = useMetricsSession()

  // Display name for current selection
  const displayName = selectedSession
    ? selectedSession.name
    : viewMode === 'all'
      ? 'All Summer'
      : viewMode === 'quests'
        ? 'Quests'
        : 'At Camp'

  // Determine current listbox value
  const currentValue = selectedSessionCmId
    ? selectedSessionCmId.toString()
    : viewMode === 'all'
      ? ALL_SUMMER_VALUE
      : viewMode === 'quests'
        ? ALL_QUESTS_VALUE
        : ALL_SESSIONS_VALUE

  const handleChange = (value: string) => {
    if (value === ALL_SESSIONS_VALUE) {
      setViewMode('sessions')
    } else if (value === ALL_QUESTS_VALUE) {
      setViewMode('quests')
    } else if (value === ALL_SUMMER_VALUE) {
      setViewMode('all')
    } else {
      setSelectedSessionCmId(Number(value))
    }
  }

  return (
    <div className="flex items-center gap-2" data-tour="retention-session-selector">
      <CalendarDays className="text-muted-foreground h-4 w-4" />
      <Listbox value={currentValue} onChange={handleChange} disabled={isLoading}>
        <div className="relative">
          <ListboxButton className="listbox-button min-w-[180px]">
            <span className="flex-1 truncate text-left">{displayName}</span>
            <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
          </ListboxButton>
          <ListboxOptions className="listbox-options w-auto min-w-[180px]">
            <ListboxOption value={ALL_SESSIONS_VALUE} className="listbox-option">
              At Camp
            </ListboxOption>
            <ListboxOption value={ALL_QUESTS_VALUE} className="listbox-option">
              Quests
            </ListboxOption>
            <ListboxOption value={ALL_SUMMER_VALUE} className="listbox-option">
              All Summer
            </ListboxOption>
            {campSessions.length > 0 && <div className="border-border my-1 border-t" />}
            {campSessions.map((session) => (
              <ListboxOption
                key={session.cm_id}
                value={session.cm_id.toString()}
                className="listbox-option"
              >
                {session.name}
              </ListboxOption>
            ))}
            {questSessions.length > 0 && <div className="border-border my-1 border-t" />}
            {questSessions.map((session) => (
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
  )
}
