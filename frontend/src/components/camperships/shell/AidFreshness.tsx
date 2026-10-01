import { formatDistanceToNow } from 'date-fns'
import { Clock } from 'lucide-react'

import { canOpenCamperships } from '../../../config/programAccess'
import { useAidSyncInvalidation } from '../../../hooks/camperships/useAidSyncInvalidation'
import { usePermissions } from '../../../hooks/usePermissions'
import {
  useSyncStatusAPI,
  type SyncStatus,
  type SyncStatusResponse,
} from '../../../hooks/useSyncStatusAPI'
import { buildSyncTooltip } from '../../../utils/syncTooltip'

/**
 * "FA applications synced N ago · Ledger synced N ago" (D5; intake health rides on them, D69).
 * Summer's grammar: grey always (conditions, not events), relative inline, the absolute time in
 * the tooltip (#1706). Each line reads the job that writes its noun: `financial_aid_applications`
 * and `aid_postings`. `/api/custom/sync/status` asks only for a signed-in user, so registrar and
 * development read it too. The same status drives the sync invalidation (spec §10).
 */
export function AidFreshness() {
  const { hasPermission } = usePermissions()
  const { data: status } = useSyncStatusAPI({ enabled: canOpenCamperships({ hasPermission }) })
  useAidSyncInvalidation(status)
  if (!status) return null

  // A job that has never run is absent from the payload; Partial says so honestly.
  const jobs: Partial<SyncStatusResponse> = status
  const lines: Array<[string, string, SyncStatus | undefined]> = [
    ['FA applications', 'FA applications', jobs.financial_aid_applications],
    ['Ledger', 'aid ledger', jobs.aid_postings],
  ]
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      {lines.map(([label, kind, job]) =>
        job?.end_time ? (
          <span
            key={label}
            className="flex items-center gap-1.5 whitespace-nowrap"
            title={buildSyncTooltip(kind, job)}
          >
            <Clock className="h-3 w-3" />
            {label} synced {formatDistanceToNow(new Date(job.end_time), { addSuffix: true })}
          </span>
        ) : null
      )}
    </div>
  )
}
