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
import { sessionFlowToSankeyData } from '../../../utils/retentionTransforms'
import { buildSessionDateLookup } from '../../../utils/sessionUtils'
import { SessionFlowSankey } from '../../../components/metrics/SessionFlowSankey'
import { SessionBunkHeatmap } from '../../../components/metrics/SessionBunkHeatmap'
import { Loader2, AlertCircle } from 'lucide-react'

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

  const sessionDateLookup = useMemo(() => buildSessionDateLookup(campSessions), [campSessions])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading session flow data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>Failed to load session flow data: {error.message}</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        No session flow data available
      </div>
    )
  }

  const sankeyData = sessionFlowToSankeyData(data.session_flow)

  return (
    <div className="space-y-6">
      {/* Sankey flow diagram (always shown) */}
      {sankeyData && (
        <SessionFlowSankey
          data={sankeyData}
          title={`Session Flow: ${priorYear} → ${currentYear}`}
        />
      )}

      {/* Bunk heatmap (hidden in quest mode - quests don't have bunks) */}
      {viewMode !== 'quests' && data.by_session_bunk && (
        <SessionBunkHeatmap data={data.by_session_bunk} sessionDateLookup={sessionDateLookup} />
      )}
    </div>
  )
}
