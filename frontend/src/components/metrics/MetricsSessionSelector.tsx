/**
 * MetricsSessionSelector - Unified session picker for the metrics module.
 *
 * Consumes MetricsSessionContext. PR 4 shape (owner, 2026-10-14):
 * - All Summer, then each preset as a pickable heading with its sessions under it, one option per
 *   row (pick 2B): At Camp › camp sessions, Quests › quest sessions, Teens › SCIT / TLI.
 * - The headings are the kit AidPicker's heading level with a session count (board 5, option i).
 * - By Duration stays a plain, unpickable label: the contrast that shows the headings are choices.
 * - About ten rows tall (board 7, max-h-96), in Analytics' own button.
 * - On a page that reads unfiltered data it shows disabled and says so (pick 4B).
 */

import { CalendarDays } from 'lucide-react'
import { AidPicker } from '../camperships/kit/AidPicker'
import { CS_PICKER_OPTIONS } from '../camperships/kit/csType'
import type { AidPickerOption } from '../camperships/kit/pickerWords'
import { useMetricsSession } from '../../hooks/useMetricsSession'
import type { MetricsViewMode } from '../../utils/sessionTypePredicates'
import type { DurationCategory } from '../../utils/sessionUtils'
import { DURATION_LABELS, TEEN_TYPE_LABELS, scopeWords } from '../../pages/metrics/scopeLine'

const ALL_SESSIONS_VALUE = 'all-sessions'
const ALL_QUESTS_VALUE = 'all-quests'
const ALL_SUMMER_VALUE = 'all-summer'
const ALL_TEENS_VALUE = 'all-teens'
const DURATION_PREFIX = 'duration:'
const TEEN_PREFIX = 'teen:'

/** Listbox values for view-mode groupings (fallback when no session/teen/duration selected) */
const VIEW_MODE_VALUES: Record<MetricsViewMode, string> = {
  all: ALL_SUMMER_VALUE,
  quests: ALL_QUESTS_VALUE,
  teens: ALL_TEENS_VALUE,
  sessions: ALL_SESSIONS_VALUE,
}

/** The kit popover, about ten rows tall instead of its 260px cap (board 7). */
const LIST_CLASS = CS_PICKER_OPTIONS.replace('max-h-[260px]', 'max-h-96')

export function MetricsSessionSelector({ notUsedHere = false }: { notUsedHere?: boolean } = {}) {
  const session = useMetricsSession()
  const {
    selectedSessionCmId,
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
  } = session

  // The scope line under the page title reads the same words (scopeLine.ts).
  const label = scopeWords(session).label
  const faceText = notUsedHere ? `${label} · not used here` : label

  function currentValue(): string {
    if (selectedSessionCmId) return selectedSessionCmId.toString()
    if (selectedTeenType) return `${TEEN_PREFIX}${selectedTeenType}`
    if (selectedDuration) return `${DURATION_PREFIX}${selectedDuration}`
    return VIEW_MODE_VALUES[viewMode]
  }

  const handleChange = (value: string) => {
    if (value === ALL_SESSIONS_VALUE) setViewMode('sessions')
    else if (value === ALL_QUESTS_VALUE) setViewMode('quests')
    else if (value === ALL_SUMMER_VALUE) setViewMode('all')
    else if (value === ALL_TEENS_VALUE) setViewMode('teens')
    else if (value.startsWith(TEEN_PREFIX))
      setSelectedTeenType(value.slice(TEEN_PREFIX.length) as 'scit' | 'tli')
    else if (value.startsWith(DURATION_PREFIX))
      setSelectedDuration(value.slice(DURATION_PREFIX.length) as DurationCategory)
    else setSelectedSessionCmId(Number(value))
  }

  const teenTypes = ([hasScit && 'scit', hasTli && 'tli'] as const).filter(
    (t): t is 'scit' | 'tli' => t !== false
  )
  const options: Array<AidPickerOption<string>> = [
    { value: ALL_SUMMER_VALUE, label: 'All Summer' },
    { value: ALL_SESSIONS_VALUE, label: 'At Camp', level: 'heading', count: campSessions.length },
    ...campSessions.map((s) => ({
      value: s.cm_id.toString(),
      label: s.name,
      level: 'indent' as const,
    })),
    { value: ALL_QUESTS_VALUE, label: 'Quests', level: 'heading', count: questSessions.length },
    ...questSessions.map((s) => ({
      value: s.cm_id.toString(),
      label: s.name,
      level: 'indent' as const,
    })),
    ...(teenTypes.length > 0
      ? [
          {
            value: ALL_TEENS_VALUE,
            label: 'Teens',
            level: 'heading' as const,
            count: teenTypes.length,
          },
          ...teenTypes.map((t) => ({
            value: `${TEEN_PREFIX}${t}`,
            label: TEEN_TYPE_LABELS[t],
            level: 'indent' as const,
          })),
        ]
      : []),
    ...[...durationGroups.keys()].map((category) => ({
      value: `${DURATION_PREFIX}${category}`,
      label: DURATION_LABELS[category],
      group: 'By Duration',
    })),
  ]

  return (
    <div className="flex items-center gap-2" data-tour="retention-session-selector">
      <CalendarDays className="text-muted-foreground h-4 w-4" />
      <AidPicker
        label="Sessions"
        value={currentValue()}
        options={options}
        onChange={handleChange}
        disabled={isLoading || notUsedHere}
        faceText={faceText}
        buttonClassName="listbox-button min-w-[180px] disabled:cursor-not-allowed disabled:opacity-50"
        listClassName={LIST_CLASS}
      />
    </div>
  )
}
