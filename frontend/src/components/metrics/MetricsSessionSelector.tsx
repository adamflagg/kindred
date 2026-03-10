/**
 * MetricsSessionSelector - Unified session dropdown for metrics module
 *
 * Consumes MetricsSessionContext to provide a session filter that applies
 * across most metrics tabs (hidden on Bunk Analysis tab which uses unfiltered data).
 *
 * Dropdown structure:
 * - At Camp / Quests / All Summer (type groupings)
 * - By Duration section (1 Week, 2 Week, etc.)
 * - Camp Sessions section (individual camp sessions)
 * - Quests section (individual quest sessions)
 */

import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { ChevronDown, CalendarDays } from 'lucide-react'
import { useMetricsSession } from '../../hooks/useMetricsSession'
import type { DurationCategory } from '../../utils/sessionUtils'

const ALL_SESSIONS_VALUE = 'all-sessions'
const ALL_QUESTS_VALUE = 'all-quests'
const ALL_SUMMER_VALUE = 'all-summer'
const DURATION_PREFIX = 'duration:'

/** Display labels for duration categories */
const DURATION_LABELS: Record<DurationCategory, string> = {
  '1-week': '1 Week',
  '2-week': '2 Week',
  '3-week': '3 Week',
  '4-week+': '4 Week+',
}

export function MetricsSessionSelector() {
  const {
    selectedSessionCmId,
    selectedSession,
    selectedDuration,
    isLoading,
    viewMode,
    setViewMode,
    setSelectedSessionCmId,
    setSelectedDuration,
    campSessions,
    questSessions,
    durationGroups,
  } = useMetricsSession()

  // Display name for current selection
  const displayName = selectedSession
    ? selectedSession.name
    : selectedDuration
      ? (DURATION_LABELS[selectedDuration] ?? selectedDuration)
      : viewMode === 'all'
        ? 'All Summer'
        : viewMode === 'quests'
          ? 'Quests'
          : 'At Camp'

  // Determine current listbox value
  const currentValue = selectedSessionCmId
    ? selectedSessionCmId.toString()
    : selectedDuration
      ? `${DURATION_PREFIX}${selectedDuration}`
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
    } else if (value.startsWith(DURATION_PREFIX)) {
      setSelectedDuration(value.slice(DURATION_PREFIX.length) as DurationCategory)
    } else {
      setSelectedSessionCmId(Number(value))
    }
  }

  const durationEntries = [...durationGroups.entries()]

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
            {/* Type groupings */}
            <ListboxOption value={ALL_SESSIONS_VALUE} className="listbox-option">
              At Camp
            </ListboxOption>
            <ListboxOption value={ALL_QUESTS_VALUE} className="listbox-option">
              Quests
            </ListboxOption>
            <ListboxOption value={ALL_SUMMER_VALUE} className="listbox-option">
              All Summer
            </ListboxOption>

            {/* Duration groups */}
            {durationEntries.length > 0 && (
              <>
                <div className="border-border my-1 border-t" />
                <div className="text-muted-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">
                  By Duration
                </div>
                {durationEntries.map(([category]) => (
                  <ListboxOption
                    key={`duration-${category}`}
                    value={`${DURATION_PREFIX}${category}`}
                    className="listbox-option"
                  >
                    {DURATION_LABELS[category] ?? category}
                  </ListboxOption>
                ))}
              </>
            )}

            {/* Individual camp sessions */}
            {campSessions.length > 0 && (
              <>
                <div className="border-border my-1 border-t" />
                <div className="text-muted-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">
                  Camp Sessions
                </div>
                {campSessions.map((session) => (
                  <ListboxOption
                    key={session.cm_id}
                    value={session.cm_id.toString()}
                    className="listbox-option"
                  >
                    {session.name}
                  </ListboxOption>
                ))}
              </>
            )}

            {/* Individual quest sessions */}
            {questSessions.length > 0 && (
              <>
                <div className="border-border my-1 border-t" />
                <div className="text-muted-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">
                  Quests
                </div>
                {questSessions.map((session) => (
                  <ListboxOption
                    key={session.cm_id}
                    value={session.cm_id.toString()}
                    className="listbox-option"
                  >
                    {session.name}
                  </ListboxOption>
                ))}
              </>
            )}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  )
}
