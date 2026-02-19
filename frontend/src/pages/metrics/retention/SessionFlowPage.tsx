/**
 * SessionFlowPage - Sankey flow diagram and bunk heatmap for session transitions.
 *
 * Shows how campers flow between sessions (prior year → current year)
 * and retention rates by session+bunk combination.
 */

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useBunkStaff } from '../../../hooks/useBunkStaff'
import { sessionFlowToSankeyData } from '../../../utils/retentionTransforms'
import { buildSessionDateLookup } from '../../../utils/sessionUtils'
import { SessionFlowSankey } from '../../../components/metrics/SessionFlowSankey'
import { SessionBunkHeatmap } from '../../../components/metrics/SessionBunkHeatmap'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'

export default function SessionFlowPage() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam, viewMode, campSessions } = useMetricsSession()

  const priorYear = currentYear - 1

  const { data, isLoading, error } = useRetentionMetrics(
    priorYear,
    currentYear,
    sessionTypesParam,
    selectedSessionCmId ?? undefined
  )

  const { data: bunkStaffData } = useBunkStaff(priorYear)
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(campSessions), [campSessions])

  return (
    <MetricsQueryGuard
      isLoading={isLoading}
      error={error}
      data={data}
      label="session flow"
      emptyMessage="No session flow data available"
    >
      {(data) => {
        const sankeyData = sessionFlowToSankeyData(data.session_flow)
        return (
          <div className="space-y-6">
            {sankeyData && (
              <SessionFlowSankey
                data={sankeyData}
                title={`Session Flow: ${priorYear} → ${currentYear}`}
              />
            )}
            {viewMode !== 'quests' && data.by_session_bunk && (
              <SessionBunkHeatmap
                data={data.by_session_bunk}
                sessionDateLookup={sessionDateLookup}
                bunkStaff={bunkStaffData}
              />
            )}
          </div>
        )
      }}
    </MetricsQueryGuard>
  )
}
