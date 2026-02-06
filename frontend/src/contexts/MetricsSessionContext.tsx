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
 * Pattern: Similar to CurrentYearContext - provider here, hook in useMetricsSession.ts
 */
import React, { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { useMetricsSessions } from '../hooks/useMetricsSessions'
import { MetricsSessionContext, type MetricsSessionContextType } from '../hooks/useMetricsSession'
import {
  CAMP_SESSION_TYPES,
  QUEST_SESSION_TYPES,
  ALL_SESSION_TYPES,
  type MetricsViewMode,
} from '../constants/sessionTypes'
import { sortSessionsByDate } from '../utils/sessionUtils'

const SESSION_PARAM = 'session'
const VIEW_PARAM = 'view'

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
 * Parse view param from URL
 * Returns 'sessions' for invalid/missing values
 */
function parseViewParam(param: string | null): MetricsViewMode {
  if (param === 'quests') return 'quests'
  return 'sessions'
}

export function MetricsSessionProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentYear } = useCurrentYear()

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

  // Find the selected session object
  const selectedSession = useMemo(() => {
    if (selectedSessionCmId === null) return undefined
    return sessions.find((s) => s.cm_id === selectedSessionCmId)
  }, [selectedSessionCmId, sessions])

  // Derive active session types based on view mode and selection
  const activeSessionTypes = useMemo(() => {
    if (selectedSessionCmId !== null) return ALL_SESSION_TYPES
    if (viewMode === 'quests') return QUEST_SESSION_TYPES
    return CAMP_SESSION_TYPES
  }, [selectedSessionCmId, viewMode])

  const sessionTypesParam = useMemo(() => {
    return activeSessionTypes.join(',')
  }, [activeSessionTypes])

  // Split sessions into camp and quest groups
  const campSessions = useMemo(() => {
    return sortSessionsByDate(sessions.filter((s) => s.session_type !== 'quest'))
  }, [sessions])

  const questSessions = useMemo(() => {
    return sortSessionsByDate(sessions.filter((s) => s.session_type === 'quest'))
  }, [sessions])

  // Update URL param when session changes (clears view param)
  const setSelectedSessionCmId = useCallback(
    (cmId: number | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
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

  // Set view mode (clears session param)
  const setViewMode = useCallback(
    (mode: MetricsViewMode) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          newParams.delete(SESSION_PARAM)
          if (mode === 'quests') {
            newParams.set(VIEW_PARAM, 'quests')
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
    ]
  )

  return <MetricsSessionContext.Provider value={value}>{children}</MetricsSessionContext.Provider>
}
