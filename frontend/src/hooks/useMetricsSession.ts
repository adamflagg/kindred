/**
 * Hook and context for unified session filtering in the metrics module
 *
 * Similar pattern to useCurrentYear.ts - defines the context type, creates
 * the context, and provides the hook. The provider is in MetricsSessionContext.tsx.
 */
import { useContext, createContext } from 'react'
import type { MetricsSession } from './useMetricsSessions'
import type { MetricsViewMode } from '../utils/sessionTypePredicates'
import type { DurationCategory } from '../utils/sessionUtils'
import type { MetricsFilterOptions } from './useMetrics'

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
  /** Current view mode: 'sessions' (camp) or 'quests' */
  viewMode: MetricsViewMode
  /** Set the view mode, clearing both session selection and duration filter */
  setViewMode: (mode: MetricsViewMode) => void
  /** Active session types derived from viewMode + selectedSessionCmId */
  activeSessionTypes: readonly string[]
  /** Comma-joined activeSessionTypes for API calls */
  sessionTypesParam: string
  /** Main/embedded sessions only, sorted by date */
  campSessions: MetricsSession[]
  /** Quest sessions only, sorted by date */
  questSessions: MetricsSession[]
  /** scit/tli sessions for the year (window-gated upstream), sorted by date */
  teenSessions: MetricsSession[]
  /** Whether any summer SCIT sessions exist this year */
  hasScit: boolean
  /** Whether any summer TLI sessions exist this year */
  hasTli: boolean
  /** Currently selected teen sub-type (null = none) */
  selectedTeenType: 'scit' | 'tli' | null
  /** Select a teen sub-type (clears session/duration/view) */
  setSelectedTeenType: (t: 'scit' | 'tli' | null) => void
  /** Currently selected duration category (null = no duration filter) */
  selectedDuration: DurationCategory | null
  /** Set the duration filter and clear session selection */
  setSelectedDuration: (duration: DurationCategory | null) => void
  /** Duration param for API calls (e.g., '1-week') - undefined when not filtering by duration */
  durationParam: string | undefined
  /** Pre-built filter options for metrics hooks (sessionTypes + sessionCmId/duration, mutually exclusive) */
  filterOptions: MetricsFilterOptions
  /** Camp + teen sessions grouped by duration, for the dropdown */
  durationGroups: Map<DurationCategory, MetricsSession[]>
  /** Whether expanded retention analysis is enabled (5 years instead of 3) */
  expandedRetention: boolean
  /** Toggle expanded retention analysis */
  setExpandedRetention: (v: boolean) => void
  /** Year to compare against (null = comparison mode off) */
  compareYear: number | null
  /** Set the comparison year (null to disable comparison) */
  setCompareYear: (year: number | null) => void
  /** Whether comparison mode is active */
  isComparing: boolean
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
