/**
 * MetricsSessionSelector - Unified session dropdown for metrics module
 *
 * Consumes MetricsSessionContext to provide a session filter that applies
 * across most metrics tabs (hidden on Bunk Analysis tab which uses unfiltered data).
 *
 * Dropdown structure:
 * - At Camp / Quests / Teens / All Summer (type groupings)
 * - By Duration section (1 Week, 2 Week, etc.)
 * - Camp Sessions section (individual camp sessions)
 * - Quests section (individual quest sessions)
 * - Teen Programs section (individual SCIT / TLI sessions)
 */

import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { ChevronDown, CalendarDays } from 'lucide-react'
import { useMetricsSession } from '../../hooks/useMetricsSession'
import type { MetricsViewMode } from '../../utils/sessionTypePredicates'
import type { DurationCategory } from '../../utils/sessionUtils'

const ALL_SESSIONS_VALUE = 'all-sessions'
const ALL_QUESTS_VALUE = 'all-quests'
const ALL_SUMMER_VALUE = 'all-summer'
const ALL_TEENS_VALUE = 'all-teens'
const DURATION_PREFIX = 'duration:'
const TEEN_PREFIX = 'teen:'

/** Display labels for duration categories */
const DURATION_LABELS: Record<DurationCategory, string> = {
  '1-week': '1 Week',
  '2-week': '2 Week',
  '3-week': '3 Week',
  '4-week+': '4 Week+',
}

/** Display labels for teen sub-types */
const TEEN_TYPE_LABELS: Record<'scit' | 'tli', string> = {
  scit: 'SCIT',
  tli: 'TLI',
}

/** Display labels for view-mode groupings (fallback when no session/teen/duration selected) */
const VIEW_MODE_LABELS: Record<MetricsViewMode, string> = {
  all: 'All Summer',
  quests: 'Quests',
  teens: 'Teens',
  sessions: 'At Camp',
}

/** Listbox values for view-mode groupings (fallback when no session/teen/duration selected) */
const VIEW_MODE_VALUES: Record<MetricsViewMode, string> = {
  all: ALL_SUMMER_VALUE,
  quests: ALL_QUESTS_VALUE,
  teens: ALL_TEENS_VALUE,
  sessions: ALL_SESSIONS_VALUE,
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
    hasScit,
    hasTli,
    selectedTeenType,
    setSelectedTeenType,
  } = useMetricsSession()

  // Display name for current selection (session → teen type → duration → view-mode grouping)
  function getDisplayName(): string {
    if (selectedSession) return selectedSession.name
    if (selectedTeenType) return TEEN_TYPE_LABELS[selectedTeenType]
    if (selectedDuration) return DURATION_LABELS[selectedDuration]
    return VIEW_MODE_LABELS[viewMode]
  }
  const displayName = getDisplayName()

  // Determine current listbox value (session → teen type → duration → view-mode grouping)
  function getCurrentValue(): string {
    if (selectedSessionCmId) return selectedSessionCmId.toString()
    if (selectedTeenType) return `${TEEN_PREFIX}${selectedTeenType}`
    if (selectedDuration) return `${DURATION_PREFIX}${selectedDuration}`
    return VIEW_MODE_VALUES[viewMode]
  }
  const currentValue = getCurrentValue()

  const handleChange = (value: string) => {
    if (value === ALL_SESSIONS_VALUE) {
      setViewMode('sessions')
    } else if (value === ALL_QUESTS_VALUE) {
      setViewMode('quests')
    } else if (value === ALL_SUMMER_VALUE) {
      setViewMode('all')
    } else if (value === ALL_TEENS_VALUE) {
      setViewMode('teens')
    } else if (value.startsWith(TEEN_PREFIX)) {
      setSelectedTeenType(value.slice(TEEN_PREFIX.length) as 'scit' | 'tli')
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
          <ListboxOptions transition className="listbox-options w-auto min-w-[180px]">
            {/* Type groupings */}
            <ListboxOption value={ALL_SESSIONS_VALUE} className="listbox-option">
              At Camp
            </ListboxOption>
            {(hasScit || hasTli) && (
              <ListboxOption value={ALL_TEENS_VALUE} className="listbox-option">
                Teens
              </ListboxOption>
            )}
            <ListboxOption value={ALL_QUESTS_VALUE} className="listbox-option">
              Quests
            </ListboxOption>
            <ListboxOption value={ALL_SUMMER_VALUE} className="listbox-option">
              All Summer
            </ListboxOption>

            {/* Duration groups */}
            {durationEntries.length > 0 && (
              <div role="group" aria-labelledby="duration-group-label">
                <div className="border-border my-1 border-t" />
                <div
                  id="duration-group-label"
                  className="text-muted-foreground px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                >
                  By Duration
                </div>
                {durationEntries.map(([category]) => (
                  <ListboxOption
                    key={`duration-${category}`}
                    value={`${DURATION_PREFIX}${category}`}
                    className="listbox-option"
                  >
                    {DURATION_LABELS[category]}
                  </ListboxOption>
                ))}
              </div>
            )}

            {/* Individual camp sessions */}
            {campSessions.length > 0 && (
              <div role="group" aria-labelledby="camp-sessions-group-label">
                <div className="border-border my-1 border-t" />
                <div
                  id="camp-sessions-group-label"
                  className="text-muted-foreground px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                >
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
              </div>
            )}

            {/* Teen Programs (SCIT / TLI) */}
            {(hasScit || hasTli) && (
              <div role="group" aria-labelledby="teen-programs-group-label">
                <div className="border-border my-1 border-t" />
                <div
                  id="teen-programs-group-label"
                  className="text-muted-foreground px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                >
                  Teen Programs
                </div>
                {hasScit && (
                  <ListboxOption value={`${TEEN_PREFIX}scit`} className="listbox-option">
                    SCIT
                  </ListboxOption>
                )}
                {hasTli && (
                  <ListboxOption value={`${TEEN_PREFIX}tli`} className="listbox-option">
                    TLI
                  </ListboxOption>
                )}
              </div>
            )}

            {/* Individual quest sessions */}
            {questSessions.length > 0 && (
              <div role="group" aria-labelledby="quests-group-label">
                <div className="border-border my-1 border-t" />
                <div
                  id="quests-group-label"
                  className="text-muted-foreground px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                >
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
              </div>
            )}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  )
}
