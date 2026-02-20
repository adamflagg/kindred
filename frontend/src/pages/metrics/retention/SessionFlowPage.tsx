/**
 * SessionFlowPage - Sankey flow diagram for session transitions.
 *
 * Shows how campers flow between sessions (prior year → current year).
 * Bunk retention heatmap has been moved to its own dedicated tab (BunkRetentionPage).
 */

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { sessionFlowToSankeyData } from '../../../utils/retentionTransforms'
import { SessionFlowSankey } from '../../../components/metrics/SessionFlowSankey'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'

export default function SessionFlowPage() {
  const { currentYear } = useCurrentYear()
  const { selectedSessionCmId, sessionTypesParam } = useMetricsSession()
  const priorYear = currentYear - 1

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
          const sankeyData = sessionFlowToSankeyData(data.session_flow)
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
