/**
 * MetricsSessionProvider - URL-based session state for metrics module
 *
 * Provides a unified session filter that applies across all metrics tabs
 * (Registration, Retention, Trends). Session selection persists in URL
 * params (?session=<cm_id>) and survives tab navigation.
 *
 * View mode (?view=quests) switches between camp sessions and quest sessions.
 * Default (no view param) shows camp sessions only.
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
  isQuestSession,
  type MetricsViewMode,
} from '../utils/sessionTypePredicates'

const SESSION_PARAM = 'session'
const VIEW_PARAM = 'view'
const COMPARE_PARAM = 'compare'
const DURATION_PARAM = 'duration'

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
  return 'sessions'
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

  const isComparing = compareYear !== null

  // Find the selected session object
  const selectedSession = useMemo(() => {
    if (selectedSessionCmId === null) return undefined
    return sessions.find((s) => s.cm_id === selectedSessionCmId)
  }, [selectedSessionCmId, sessions])

  // Derive active session types based on view mode and selection
  const activeSessionTypes = useMemo(() => {
    if (selectedSessionCmId !== null) return SUMMER_CAMP_TYPES
    if (selectedDuration) return AT_CAMP_TYPES
    if (viewMode === 'all') return SUMMER_CAMP_TYPES
    if (viewMode === 'quests') return QUEST_SESSION_TYPES
    return AT_CAMP_TYPES
  }, [selectedSessionCmId, selectedDuration, viewMode])

  const sessionTypesParam = useMemo(() => {
    return activeSessionTypes.join(',')
  }, [activeSessionTypes])

  // Split sessions into camp and quest groups
  const campSessions = useMemo(() => {
    return sortSessionsByDate(sessions.filter((s) => !isQuestSession(s)))
  }, [sessions])

  const questSessions = useMemo(() => {
    return sortSessionsByDate(sessions.filter(isQuestSession))
  }, [sessions])

  // Group camp sessions by duration for dropdown
  const durationGroups = useMemo(() => {
    return groupSessionsByDuration(campSessions)
  }, [campSessions])

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

  // Set duration filter (clears session and view params)
  const setSelectedDuration = useCallback(
    (duration: DurationCategory | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(SESSION_PARAM)
          newParams.delete(VIEW_PARAM)
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

  // Update URL param when session changes (clears view and duration params)
  const setSelectedSessionCmId = useCallback(
    (cmId: number | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(DURATION_PARAM)
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

  // Set view mode (clears session and duration params)
  const setViewMode = useCallback(
    (mode: MetricsViewMode) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(SESSION_PARAM)
          newParams.delete(DURATION_PARAM)
          if (mode === 'quests') {
            newParams.set(VIEW_PARAM, 'quests')
          } else if (mode === 'all') {
            newParams.set(VIEW_PARAM, 'all')
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

  // Clear session filter
  const clearSession = useCallback(() => {
    setSelectedSessionCmId(null)
  }, [setSelectedSessionCmId])

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
      selectedDuration,
      setSelectedDuration,
      durationParam,
      filterOptions,
      durationGroups,
      expandedRetention,
      compareYear,
      setCompareYear,
      isComparing,
    ]
  )

  return <MetricsSessionContext value={value}>{children}</MetricsSessionContext>
}
