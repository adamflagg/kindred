import { queryKeys } from '../../utils/queryKeys'
import { useSyncFinishInvalidation } from '../useSyncFinishInvalidation'
import type { SyncStatusResponse } from '../useSyncStatusAPI'

/** The jobs whose writes every Camperships read depends on. */
const AID_JOBS = ['aid_postings', 'financial_aid_applications'] as const

/**
 * A completed ledger or FA-applications sync refreshes every Camperships read (spec §10). Manage ›
 * Sync's completion toasts invalidate SYNC_DEPENDENT_PREFIXES (which include 'financial-aid'), but
 * registrar and finance staff don't sit on that tab. This watches the two jobs' finished end times
 * on the status the secondary bar already reads, and invalidates when either moves to a new one
 * (useSyncFinishInvalidation, which carries the accepted lag of a tab left open overnight).
 */
export function useAidSyncInvalidation(status: SyncStatusResponse | null | undefined): void {
  useSyncFinishInvalidation(status, AID_JOBS, queryKeys.aidPrefix())
}
