/**
 * Hook and context for unified session filtering in the metrics module
 *
 * Similar pattern to useCurrentYear.ts - defines the context type, creates
 * the context, and provides the hook. The provider is in MetricsSessionContext.tsx.
 */
import { useContext, createContext } from 'react'
import type { MetricsSession } from './useMetricsSessions'

export interface MetricsSessionContextType {
  /** Currently selected session cm_id (null = all sessions) */
  selectedSessionCmId: number | null
  /** The full session object for the selected session (undefined if all sessions or not found) */
  selectedSession: MetricsSession | undefined
  /** Available sessions for the current year */
  sessions: MetricsSession[]
  /** Whether sessions are loading */
  isLoading: boolean
  /** Set the selected session by cm_id (null to show all) */
  setSelectedSessionCmId: (cmId: number | null) => void
  /** Clear the session filter (show all sessions) */
  clearSession: () => void
}

export const MetricsSessionContext = createContext<MetricsSessionContextType | undefined>(undefined)

/**
 * Hook to access the metrics session context
 * Must be used within a MetricsSessionProvider
 */
export function useMetricsSession(): MetricsSessionContextType {
  const context = useContext(MetricsSessionContext)
  if (!context) {
    throw new Error('useMetricsSession must be used within a MetricsSessionProvider')
  }
  return context
}
