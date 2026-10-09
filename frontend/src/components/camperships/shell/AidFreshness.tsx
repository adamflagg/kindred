import { canOpenCamperships } from '../../../config/programAccess'
import { useAidSyncInvalidation } from '../../../hooks/camperships/useAidSyncInvalidation'
import { usePermissions } from '../../../hooks/usePermissions'
import {
  useSyncStatusAPI,
  type SyncStatus,
  type SyncStatusResponse,
} from '../../../hooks/useSyncStatusAPI'
import { buildSyncTooltip } from '../../../utils/syncTooltip'
import { FreshnessChip } from '../../FreshnessChip'

/**
 * "Aid apps synced 18h ago · Ledger synced 18h ago" (D5; intake health rides on them, D69).
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
    ['Aid apps', 'FA applications', jobs.financial_aid_applications],
    ['Ledger', 'aid ledger', jobs.aid_postings],
  ]
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      {lines.map(([label, kind, job]) =>
        job?.end_time ? (
          <FreshnessChip
            key={label}
            noun={label}
            verb="synced"
            at={job.end_time}
            title={buildSyncTooltip(kind, job)}
          />
        ) : null
      )}
    </div>
  )
}
