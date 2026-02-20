/**
 * BunkRetentionPage - Dedicated bunk retention heatmap tab.
 *
 * Calls useRetentionMetrics WITHOUT session filter params so the heatmap
 * always shows the true picture: "of campers in last year's bunk,
 * how many came back to camp at all?" — regardless of session dropdown.
 */

import { useMemo } from 'react'
import { BedDouble } from 'lucide-react'
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground flex items-center gap-2 text-2xl font-bold">
          <BedDouble className="text-primary h-6 w-6" />
          Returning Campers by {priorYear} Bunk
        </h1>
        <p className="text-muted-foreground mt-1">
          Percentage of campers from each bunk who returned to camp in any form
        </p>
      </div>

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
          ) : (
            <p className="text-muted-foreground py-8 text-center">
              No bunk retention data available
            </p>
          )
        }
      </MetricsQueryGuard>
    </div>
  )
}
