/**
 * MetricsSessionProvider - URL-based session state for metrics module
 *
 * Provides a unified session filter that applies across all metrics tabs
 * (Registration, Retention, Trends). Session selection persists in URL
 * params (?session=<cm_id>) and survives tab navigation.
 *
 * View mode (?view=) selects a session-type grouping: 'quests' (quest
 * sessions), 'teens' (SCIT/TLI), or 'all' (every summer type including teens).
 * Default (no view param) shows camp sessions only. Individual teen sessions
 * are selected via ?teen=<scit|tli>, never via ?session=<cm_id>.
 *
 * Duration filter (?duration=<category>) filters sessions by length category
 * (e.g., "1-week", "2-week"). Mutually exclusive with session selection --
 * setting one clears the other.
 *
 * Pattern: Similar to CurrentYearContext - provider here, hook in useMetricsSession.ts
 */
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { useMetricsSessions } from '../hooks/useMetricsSessions'
import { metricsFilter } from '../hooks/useMetrics'
import { MetricsSessionContext, type MetricsSessionContextType } from '../hooks/useMetricsSession'
import {
  sortSessionsByDate,
  groupSessionsByDuration,
  type DurationCategory,
  DURATION_CATEGORIES,
} from '../utils/sessionUtils'
import {
  AT_CAMP_TYPES,
  QUEST_SESSION_TYPES,
  SUMMER_CAMP_TYPES,
  TEEN_PROGRAM_TYPES,
  isQuestSession,
  isMainOrEmbedded,
  type MetricsViewMode,
} from '../utils/sessionTypePredicates'

const SESSION_PARAM = 'session'
const VIEW_PARAM = 'view'
const COMPARE_PARAM = 'compare'
const DURATION_PARAM = 'duration'
const TEEN_PARAM = 'teen'
const TEEN_PIPELINE_PARAM = 'teen_pipeline'

/**
 * Parse session param from URL
 * Returns null for invalid/missing values
 */
function parseSessionParam(param: string | null): number | null {
  if (!param) return null
  const parsed = parseInt(param, 10)
  return isNaN(parsed) ? null : parsed
}

/**
 * Parse duration param from URL
 * Returns null for invalid/missing values
 */
function parseDurationParam(param: string | null): DurationCategory | null {
  if (param && (DURATION_CATEGORIES as readonly string[]).includes(param)) {
    return param as DurationCategory
  }
  return null
}

/**
 * Parse view param from URL
 * Returns 'sessions' for invalid/missing values
 */
function parseViewParam(param: string | null): MetricsViewMode {
  if (param === 'quests') return 'quests'
  if (param === 'all') return 'all'
  if (param === 'teens') return 'teens'
  return 'sessions'
}

/**
 * Parse teen type param from URL
 * Returns null for invalid/missing values
 */
function parseTeenTypeParam(param: string | null): 'scit' | 'tli' | null {
  if (param === 'scit') return 'scit'
  if (param === 'tli') return 'tli'
  return null
}

export function MetricsSessionProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentYear } = useCurrentYear()
  const [expandedRetention, setExpandedRetention] = useState(false)

  // Fetch sessions for the current year
  const { data: sessions = [], isLoading } = useMetricsSessions(currentYear)

  // Get session from URL param
  const selectedSessionCmId = useMemo(() => {
    return parseSessionParam(searchParams.get(SESSION_PARAM))
  }, [searchParams])

  // Get view mode from URL param
  const viewMode = useMemo(() => {
    return parseViewParam(searchParams.get(VIEW_PARAM))
  }, [searchParams])

  // Get duration from URL param
  const selectedDuration = useMemo(() => {
    return parseDurationParam(searchParams.get(DURATION_PARAM))
  }, [searchParams])

  // Get compare year from URL param
  const compareYear = useMemo(() => {
    return parseSessionParam(searchParams.get(COMPARE_PARAM))
  }, [searchParams])

  // Get selected teen type from URL param
  const selectedTeenType = useMemo(() => {
    return parseTeenTypeParam(searchParams.get(TEEN_PARAM))
  }, [searchParams])

  // Get includeTeenPipeline flag from URL param
  const includeTeenPipeline = useMemo(
    () => searchParams.get(TEEN_PIPELINE_PARAM) === '1',
    [searchParams]
  )

  const isComparing = compareYear !== null

  // Find the selected session object
  const selectedSession = useMemo(() => {
    if (selectedSessionCmId === null) return undefined
    return sessions.find((s) => s.cm_id === selectedSessionCmId)
  }, [selectedSessionCmId, sessions])

  // Derive active session types based on view mode and selection
  const activeSessionTypes = useMemo(() => {
    // SUMMER_CAMP_TYPES excludes scit/tli, and the backend applies session_types
    // AND session_cm_id conjunctively. Teen programs are intentionally selected
    // via selectedTeenType (type-based), NEVER via setSelectedSessionCmId. If a
    // future change makes individual teen sessions cm_id-selectable, this branch
    // MUST include the teen types or it will silently zero out the selected
    // session's own attendees (session_type ∈ SUMMER_CAMP_TYPES filters them all out).
    if (selectedSessionCmId !== null) return SUMMER_CAMP_TYPES
    if (selectedTeenType) return [selectedTeenType] as const
    if (selectedDuration) return [...AT_CAMP_TYPES, ...TEEN_PROGRAM_TYPES] as const
    if (viewMode === 'all') return [...SUMMER_CAMP_TYPES, ...TEEN_PROGRAM_TYPES] as const
    if (viewMode === 'teens') return TEEN_PROGRAM_TYPES
    if (viewMode === 'quests') return QUEST_SESSION_TYPES
    return AT_CAMP_TYPES
  }, [selectedSessionCmId, selectedTeenType, selectedDuration, viewMode])

  const sessionTypesParam = useMemo(() => {
    return activeSessionTypes.join(',')
  }, [activeSessionTypes])

  // Split sessions into camp (main/embedded only), quest, and teen groups
  const campSessions = useMemo(() => {
    return sortSessionsByDate(sessions.filter(isMainOrEmbedded))
  }, [sessions])

  const questSessions = useMemo(() => {
    return sortSessionsByDate(sessions.filter(isQuestSession))
  }, [sessions])

  const teenSessions = useMemo(() => {
    return sortSessionsByDate(
      sessions.filter((s) =>
        TEEN_PROGRAM_TYPES.includes(s.session_type as (typeof TEEN_PROGRAM_TYPES)[number])
      )
    )
  }, [sessions])

  const hasScit = useMemo(() => teenSessions.some((s) => s.session_type === 'scit'), [teenSessions])
  const hasTli = useMemo(() => teenSessions.some((s) => s.session_type === 'tli'), [teenSessions])

  // Group camp + teen sessions by duration for dropdown
  const durationGroups = useMemo(() => {
    return groupSessionsByDuration([...campSessions, ...teenSessions])
  }, [campSessions, teenSessions])

  // Duration param for API calls
  const durationParam = selectedDuration ?? undefined

  // Pre-built filter options for metrics hooks
  const filterOptions = useMemo(
    () =>
      metricsFilter({
        sessionTypes: sessionTypesParam,
        sessionCmId: selectedSessionCmId,
        duration: durationParam,
      }),
    [sessionTypesParam, selectedSessionCmId, durationParam]
  )

  // Set duration filter (clears session, view, and teen params)
  const setSelectedDuration = useCallback(
    (duration: DurationCategory | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(SESSION_PARAM)
          newParams.delete(VIEW_PARAM)
          newParams.delete(TEEN_PARAM)
          if (duration) {
            newParams.set(DURATION_PARAM, duration)
          } else {
            newParams.delete(DURATION_PARAM)
          }
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Update URL param when session changes (clears view, duration, and teen params)
  const setSelectedSessionCmId = useCallback(
    (cmId: number | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(DURATION_PARAM)
          newParams.delete(TEEN_PARAM)
          if (cmId === null) {
            newParams.delete(SESSION_PARAM)
          } else {
            newParams.set(SESSION_PARAM, cmId.toString())
            newParams.delete(VIEW_PARAM)
          }
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Set view mode (clears session, duration, and teen params)
  const setViewMode = useCallback(
    (mode: MetricsViewMode) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(SESSION_PARAM)
          newParams.delete(DURATION_PARAM)
          newParams.delete(TEEN_PARAM)
          if (mode === 'quests') {
            newParams.set(VIEW_PARAM, 'quests')
          } else if (mode === 'all') {
            newParams.set(VIEW_PARAM, 'all')
          } else if (mode === 'teens') {
            newParams.set(VIEW_PARAM, 'teens')
          } else {
            newParams.delete(VIEW_PARAM)
          }
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Set teen sub-type (clears session, view, and duration params)
  const setSelectedTeenType = useCallback(
    (t: 'scit' | 'tli' | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(SESSION_PARAM)
          newParams.delete(VIEW_PARAM)
          newParams.delete(DURATION_PARAM)
          if (t) {
            newParams.set(TEEN_PARAM, t)
          } else {
            newParams.delete(TEEN_PARAM)
          }
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Set comparison year (null to disable)
  const setCompareYear = useCallback(
    (year: number | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          if (year === null) {
            newParams.delete(COMPARE_PARAM)
          } else {
            newParams.set(COMPARE_PARAM, year.toString())
          }
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Set teen pipeline inclusion flag (URL: teen_pipeline=1)
  const setIncludeTeenPipeline = useCallback(
    (value: boolean) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          if (value) newParams.set(TEEN_PIPELINE_PARAM, '1')
          else newParams.delete(TEEN_PIPELINE_PARAM)
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Clear session filter
  const clearSession = useCallback(() => {
    setSelectedSessionCmId(null)
  }, [setSelectedSessionCmId])

  const scopeHasTeens = useMemo(
    () => activeSessionTypes.some((t) => t === 'scit' || t === 'tli'),
    [activeSessionTypes]
  )

  const value: MetricsSessionContextType = useMemo(
    () => ({
      selectedSessionCmId,
      selectedSession,
      sessions,
      isLoading,
      setSelectedSessionCmId,
      clearSession,
      viewMode,
      setViewMode,
      activeSessionTypes,
      sessionTypesParam,
      campSessions,
      questSessions,
      teenSessions,
      hasScit,
      hasTli,
      selectedTeenType,
      setSelectedTeenType,
      selectedDuration,
      setSelectedDuration,
      durationParam,
      filterOptions,
      durationGroups,
      expandedRetention,
      setExpandedRetention,
      compareYear,
      setCompareYear,
      isComparing,
      includeTeenPipeline,
      setIncludeTeenPipeline,
      scopeHasTeens,
    }),
    [
      selectedSessionCmId,
      selectedSession,
      sessions,
      isLoading,
      setSelectedSessionCmId,
      clearSession,
      viewMode,
      setViewMode,
      activeSessionTypes,
      sessionTypesParam,
      campSessions,
      questSessions,
      teenSessions,
      hasScit,
      hasTli,
      selectedTeenType,
      setSelectedTeenType,
      selectedDuration,
      setSelectedDuration,
      durationParam,
      filterOptions,
      durationGroups,
      expandedRetention,
      compareYear,
      setCompareYear,
      isComparing,
      includeTeenPipeline,
      setIncludeTeenPipeline,
      scopeHasTeens,
    ]
  )

  return <MetricsSessionContext value={value}>{children}</MetricsSessionContext>
}
