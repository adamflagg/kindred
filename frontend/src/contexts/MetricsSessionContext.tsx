/**
 * MetricsSessionProvider - URL-based session state for metrics module
 *
 * Provides a unified session filter that applies across all metrics tabs
 * (Registration, Retention, Trends). Session selection persists in URL
 * params (?session=<cm_id>) and survives tab navigation.
 *
 * Pattern: Similar to CurrentYearContext - provider here, hook in useMetricsSession.ts
 */
import React, { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { useMetricsSessions } from '../hooks/useMetricsSessions'
import { MetricsSessionContext, type MetricsSessionContextType } from '../hooks/useMetricsSession'

const SESSION_PARAM = 'session'

/**
 * Parse session param from URL
 * Returns null for invalid/missing values
 */
function parseSessionParam(param: string | null): number | null {
  if (!param) return null
  const parsed = parseInt(param, 10)
  return isNaN(parsed) ? null : parsed
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

  // Find the selected session object
  const selectedSession = useMemo(() => {
    if (selectedSessionCmId === null) return undefined
    return sessions.find((s) => s.cm_id === selectedSessionCmId)
  }, [selectedSessionCmId, sessions])

  // Update URL param when session changes
  const setSelectedSessionCmId = useCallback(
    (cmId: number | null) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          if (cmId === null) {
            newParams.delete(SESSION_PARAM)
          } else {
            newParams.set(SESSION_PARAM, cmId.toString())
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
    }),
    [
      selectedSessionCmId,
      selectedSession,
      sessions,
      isLoading,
      setSelectedSessionCmId,
      clearSession,
    ]
  )

  return <MetricsSessionContext.Provider value={value}>{children}</MetricsSessionContext.Provider>
}
