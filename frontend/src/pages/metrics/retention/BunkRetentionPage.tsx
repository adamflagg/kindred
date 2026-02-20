/**
 * BunkRetentionPage - Dedicated bunk retention heatmap tab.
 *
 * Calls useRetentionMetrics WITHOUT session filter params so the heatmap
 * always shows the true picture: "of campers in last year's bunk,
 * how many came back to camp at all?" — regardless of session dropdown.
 */

import { useMemo } from 'react'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useRetentionMetrics } from '../../../hooks/useMetrics'
import { useMetricsSession } from '../../../hooks/useMetricsSession'
import { useBunkStaff } from '../../../hooks/useBunkStaff'
import { buildSessionDateLookup } from '../../../utils/sessionUtils'
import { SessionBunkHeatmap } from '../../../components/metrics/SessionBunkHeatmap'
import { MetricsQueryGuard } from '../../../components/metrics/MetricsQueryGuard'

export default function BunkRetentionPage() {
  const { currentYear } = useCurrentYear()
  const { campSessions } = useMetricsSession()

  const priorYear = currentYear - 1

  // No session filter params — always unfiltered
  const { data, isLoading, error } = useRetentionMetrics(priorYear, currentYear)

  const { data: bunkStaffData } = useBunkStaff(priorYear)
  const sessionDateLookup = useMemo(() => buildSessionDateLookup(campSessions), [campSessions])

  return (
    <MetricsQueryGuard
      isLoading={isLoading}
      error={error}
      data={data}
      label="bunk retention"
      emptyMessage="No bunk retention data available"
    >
      {(data) =>
        data.by_session_bunk ? (
          <SessionBunkHeatmap
            data={data.by_session_bunk}
            sessionDateLookup={sessionDateLookup}
            bunkStaff={bunkStaffData}
          />
        ) : null
      }
    </MetricsQueryGuard>
  )
}
