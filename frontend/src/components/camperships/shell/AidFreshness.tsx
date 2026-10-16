import { canOpenCamperships } from '../../../config/programAccess'
import { useAidSyncInvalidation } from '../../../hooks/camperships/useAidSyncInvalidation'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import {
  useSyncStatusAPI,
  type SyncStatus,
  type SyncStatusResponse,
} from '../../../hooks/useSyncStatusAPI'
import { freshnessRun } from '../../../utils/syncFreshness'
import { buildSyncTooltip } from '../../../utils/syncTooltip'
import { FreshnessChip } from '../../FreshnessChip'

/**
 * "Aid apps synced 18h ago · Ledger synced 18h ago" (D5; intake health rides on them, D69).
 * Summer's grammar: grey always (conditions, not events), relative inline, the absolute time in
 * the tooltip (#1706). Each line reads the job that writes its noun: `financial_aid_applications`
 * and `aid_postings`. `/api/custom/sync/status` asks only for a signed-in user, so registrar and
 * development read it too. The same status drives the sync invalidation (spec §10).
 *
 * Aid apps reads the season on screen (`?year=`). From Oct 15 the sync runs FA applications for two
 * seasons, and the unscoped payload holds whichever finished last, so it dated 2027's applications
 * by 2026's run. Only the two synced seasons can be asked for (the backend 400s any other), and an
 * older season is not re-synced at all, so there Aid apps shows nothing rather than another
 * season's time (useAnalyticsFreshness's rule). The Ledger keeps the unscoped run: aid_postings
 * runs once, for the primary, and covers every live season's ledger in that one run.
 */
export function AidFreshness() {
  const { hasPermission } = usePermissions()
  const canOpen = canOpenCamperships({ hasPermission })
  const { data: status } = useSyncStatusAPI({ enabled: canOpen })
  useAidSyncInvalidation(status)
  const year = useYear()
  // An older backend omits _synced_years; the scheduled runs cover the primary and the one before.
  const configured = status?._configured_year
  const syncedYears =
    status?._synced_years ?? (configured !== undefined ? [configured, configured - 1] : [])
  const inSynced = syncedYears.includes(year)
  // Across a season switch the hook keeps the previous season's payload as placeholder data: never show it.
  const { data: seasonStatus, isPlaceholderData } = useSyncStatusAPI({
    enabled: canOpen && inSynced,
    year: inSynced ? year : undefined,
  })
  if (!status) return null

  // A job that has never run is absent from the payload; Partial says so honestly.
  const jobs: Partial<SyncStatusResponse> = status
  const seasonJobs: Partial<SyncStatusResponse> | undefined =
    inSynced && seasonStatus && !isPlaceholderData ? seasonStatus : undefined
  // freshnessRun: a dry run dates nothing, so a line reads the job's last real run.
  const lines: Array<[string, string, SyncStatus | undefined]> = [
    ['Aid apps', 'FA applications', freshnessRun(seasonJobs?.financial_aid_applications)],
    ['Ledger', 'aid ledger', freshnessRun(jobs.aid_postings)],
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
