/**
 * SessionFlowPage - Sankey flow diagram for session transitions.
 *
 * Shows how campers flow between sessions (prior year → current year).
 * Bunk retention heatmap has been moved to its own dedicated tab (BunkRetentionPage).
 */

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useMetricsSessions } from '../../../hooks/useMetricsSessions'
import { sessionFlowToSankeyData } from '../../../utils/retentionTransforms'
import { SessionFlowSankey } from '../../../components/metrics/SessionFlowSankey'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'
import {
  buildSessionDateLookup,
  buildSessionTypeLookup,
  compareByDateCampThenQuest,
} from '../../../utils/sessionUtils'

/** Build a camp-then-quest comparator from session records */
function buildComparator(
  sessions: Array<{ name: string; start_date: string; session_type: string }>
) {
  if (sessions.length === 0) return undefined
  const dateLookup = buildSessionDateLookup(sessions)
  const typeLookup = buildSessionTypeLookup(sessions)
  return (a: string, b: string) => compareByDateCampThenQuest(a, b, dateLookup, typeLookup)
}

export default function SessionFlowPage() {
  const { currentYear } = useCurrentYear()
  const { sessions, filterOptions, includeTeenPipeline } = useMetricsSession()
  const priorYear = currentYear - 1

  // Fetch prior year sessions for source-side ordering
  const { data: priorSessions = [], isLoading: priorLoading } = useMetricsSessions(priorYear)

  // Each side gets its own year's date/type lookups for correct ordering
  const comparators = useMemo(
    () => ({
      source: buildComparator(priorSessions),
      target: buildComparator(sessions),
    }),
    [sessions, priorSessions]
  )

  const { data, isLoading, error } = useRetentionMetrics(
    priorYear,
    currentYear,
    filterOptions,
    includeTeenPipeline
  )

  return (
    <div className="space-y-4">
      <MetricsQueryGuard
        isLoading={isLoading || priorLoading}
        error={error}
        data={data}
        label="session flow"
        emptyMessage="No session flow data available"
      >
        {(data) => {
          const sankeyData = sessionFlowToSankeyData(data.session_flow, comparators)
          return sankeyData ? (
            <div data-tour="retention-flow-sankey">
              <SessionFlowSankey
                data={sankeyData}
                title={`Session Flow: ${priorYear} → ${currentYear}`}
              />
            </div>
          ) : null
        }}
      </MetricsQueryGuard>
    </div>
  )
}
