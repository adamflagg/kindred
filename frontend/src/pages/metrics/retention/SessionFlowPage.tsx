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

export default function SessionFlowPage() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam, sessions } = useMetricsSession()
  const priorYear = currentYear - 1

  // Fetch prior year sessions for date/type lookups on the source side
  const { data: priorSessions = [] } = useMetricsSessions(priorYear)

  // Build combined lookups from both years for camp-then-quest ordering
  const sessionComparator = useMemo(() => {
    const allSessions = [...sessions, ...priorSessions]
    if (allSessions.length === 0) return undefined
    const dateLookup = buildSessionDateLookup(allSessions)
    const typeLookup = buildSessionTypeLookup(allSessions)
    return (a: string, b: string) => compareByDateCampThenQuest(a, b, dateLookup, typeLookup)
  }, [sessions, priorSessions])

  const { data, isLoading, error } = useRetentionMetrics(
    priorYear,
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  return (
    <div className="space-y-4">
      <MetricsQueryGuard
        isLoading={isLoading}
        error={error}
        data={data}
        label="session flow"
        emptyMessage="No session flow data available"
      >
        {(data) => {
          const sankeyData = sessionFlowToSankeyData(data.session_flow, sessionComparator)
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
