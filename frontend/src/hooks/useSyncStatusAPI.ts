import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'

// Sub-entity stats for combined syncs (e.g., persons includes households)
export interface SubStats {
  created: number
  updated: number
  skipped: number
  errors: number
  // Per-record transform failures inside this sub-entity. This is where #2284's counter
  // actually shows up first: `persons` is a combined sync and its reclassified reject site
  // is in the household half, which reports here and nowhere else.
  rejected?: number
  // Discarded custom-field VALUES, not records (kindred#2356). Only camper_transportation,
  // staff_applications, and staff_vehicle_info set this -- usually one unmapped BUS-*/
  // App-*/SVI-* answer discarded while the record it belongs to is still created;
  // staff_applications also counts a gated person's dropped App-* answers here even
  // though their record was never created (kindred#2277). Deliberately separate from
  // `skipped`, which stays a record count everywhere else: folding this in made
  // "N skipped" read as N dropped records when it was really N dropped answers across
  // some smaller, partly-overlapping set of rows.
  skipped_values?: number
}

// Queued sync item from the sync queue
export interface QueuedSyncItem {
  id: string
  year: number
  type: 'unified' | 'phase' | 'individual' // Type of queued sync
  service: string
  include_custom_values?: boolean
  position: number
  queued_at: string
}

// Progress of the current sync sequence (remaining jobs to run)
export interface CurrentRunProgress {
  type: 'daily' | 'historical' | 'weekly' | 'custom_values'
  total_jobs: number
  completed_jobs: number
  remaining_jobs: string[] | null
}

export interface SyncStatus {
  status: 'idle' | 'running' | 'success' | 'failed' | 'pending'
  start_time?: string
  end_time?: string
  error?: string
  /**
   * The weekend this run was started FOR, absent when it covers everything
   * (kindred#2601, `Status.Session` in pocketbase/sync/orchestrator.go).
   *
   * ⚠️ ABSENT MEANS EVERY WEEKEND, not "unknown". The nightly cron refreshes the
   * whole family-camp cohort, so a consumer must treat a missing session as
   * MATCHING — reading it as "not mine" would silently stop the cron from
   * driving any weekend's readout.
   *
   * ITS ONE CONSUMER IS `runBelongsHere`, which asks it about a run that is
   * RUNNING: is the chain I can see the one this surface started? Freshness is
   * no longer asked of it — one slot per job cannot say when a weekend that is
   * not the last one refreshed was last covered, so that moved to
   * `weekendHousingSyncedAt` off the weekend's own payload (kindred#2617).
   */
  session?: string
  summary?: {
    created: number
    updated: number
    skipped: number
    errors: number
    // Discarded custom-field VALUES, not records (kindred#2356). See SubStats above --
    // camper_transportation, staff_applications, and staff_vehicle_info are the only
    // services that set this.
    skipped_values?: number
    // Per-record transform failures: an upstream record could not be turned into a row.
    // Warn-only for its first season (#2284) — surfaced here, never failing a run.
    rejected?: number
    // Staff records dropped because the same person appeared under more than one
    // CampMinder status in one run (#2267). Only ever set by the `staff` service — the
    // first status seen wins (see pocketbase/sync/staff.go's allStaffStatuses), and this
    // is the count of every later status that lost that collapse.
    duplicate_staff_status?: number
    already_processed?: number // For process_requests: records already processed
    prod_audit_warnings?: number // For stranded_assignment_cleanup: stranded prod assignments (observe-only)
    lodging_prod_audit_warnings?: number // For stranded_assignment_cleanup: stranded lodging prod assignments (observe-only)
    duration?: number
    sub_stats?: Record<string, SubStats> // For combined syncs (e.g., persons includes households)
  }
  year?: number // Year being synced (0 or undefined = current year)
}

/**
 * Total rejected records for one run: the service's own count plus every sub-entity's.
 *
 * The sum is not decorative. `Stats.Rejected` can exist ONLY in a sub-entity — a persons
 * sync rejecting a household reports it as `sub_stats.households.rejected` and leaves the
 * parent's count at zero (pocketbase/sync/persons.go GetStats). Rendering the top-level
 * number alone therefore shows nothing at all for the first service the campaign makes
 * reject anything.
 *
 * It matters more here than for the other counters because Rejected is warn-only for its
 * first season (#2284): it never fails a run, so this badge is the only thing that tells an
 * operator it is climbing — and a service sitting at rejected > 0 run after run is also the
 * signal that its orphan sweep has been skipping (#2295).
 *
 * One level deep, matching the backend's totalInfrastructureErrors: SubStats is populated by
 * combined syncs and is never nested further.
 */
export function totalRejected(summary: SyncStatus['summary']): number {
  if (!summary) return 0

  const nested = Object.values(summary.sub_stats ?? {}).reduce(
    (sum, sub) => sum + (sub.rejected ?? 0),
    0
  )
  return (summary.rejected ?? 0) + nested
}

// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
export interface SyncStatusResponse {
  session_groups: SyncStatus
  sessions: SyncStatus
  attendees: SyncStatus
  person_tag_defs: SyncStatus
  custom_field_defs: SyncStatus
  persons: SyncStatus // Combined sync: persons + households
  bunks: SyncStatus
  bunk_plans: SyncStatus
  bunk_assignments: SyncStatus
  bunk_requests: SyncStatus
  process_requests: SyncStatus
  divisions: SyncStatus
  staff: SyncStatus
  financial_transactions: SyncStatus
  staff_lookups: SyncStatus
  financial_lookups: SyncStatus
  // Transform phase (derived tables)
  family_camp_derived: SyncStatus
  lodging_assignments: SyncStatus
  staff_skills: SyncStatus
  financial_aid_applications: SyncStatus
  household_demographics: SyncStatus
  camper_dietary: SyncStatus
  camper_transportation: SyncStatus
  quest_registrations: SyncStatus
  staff_applications: SyncStatus
  staff_vehicle_info: SyncStatus
  normalize_geographic: SyncStatus
  enrollment_snapshots: SyncStatus
  stranded_assignment_cleanup: SyncStatus
  // Export phase
  multi_workbook_export: SyncStatus
  // On-demand custom value syncs (expensive, 1 API call per entity)
  person_custom_values: SyncStatus
  household_custom_values: SyncStatus
  // The BOUNDED daily family-camp custom-values pass (kindred#2482) — NOT the
  // unrestricted pair above. These two dominate the family-camp refresh chain
  // either way — ~96% of it when it covers the season, ~85% when scoped to one
  // weekend (kindred#2601) — and they only became visible here in PR #2591;
  // while they were absent from the
  // backend's `statusSyncTypes` the client saw nothing running for the whole
  // run, stopped polling, and could never detect the cutover
  // (kindred#2478 §4.2c).
  person_custom_values_family_camp: SyncStatus
  household_custom_values_family_camp: SyncStatus
  // Published alongside them by PR #2591: a registered daily Process-phase job
  // whose two neighbours (`bunk_requests`, `process_requests`) were already here.
  reconcile_request_lifecycle: SyncStatus
  // Special flags
  _daily_sync_running?: boolean
  _historical_sync_running?: boolean
  _historical_sync_year?: number
  _weekly_sync_running?: boolean
  // Configured year from backend (CAMPMINDER_SEASON_ID)
  _configured_year?: number
  // Sync queue
  _queue?: QueuedSyncItem[]
  _queue_length?: number
  // Current run progress (remaining jobs in active sequence)
  _current_run?: CurrentRunProgress
  // Most recent bunk_requests CSV upload (filename + RFC3339 timestamp).
  // Absent if no CSV has been uploaded for the current data dir.
  _bunk_requests_upload?: {
    filename: string
    uploaded_at: string
  }
}

// On 401 the hook returns null instead of a fake `{}` cast to SyncStatusResponse.
// The previous empty-object sentinel lied to TypeScript — every field looked
// populated and consumers crashed at runtime when they accessed nested data.
// `null` forces every call site to guard, which the compiler now enforces.

export function useSyncStatusAPI(
  opts: {
    enabled?: boolean
    /**
     * Poll every 3 s regardless of what the payload reports.
     *
     * For a `useSyncSequenceRun` run, which has TWO kinds of window in which
     * the payload says nothing is happening while the run is very much alive:
     *
     * - the ARMING GAP, between the POST that starts a targeted refresh
     *   returning `{"status":"started"}` and the orchestrator marking the
     *   chain's first job running;
     * - every GAP BETWEEN TWO SEQUENTIAL JOBS — `runSyncAndWait` waits on a
     *   500 ms ticker, and `RunSyncSequence` sets no run-type flag and takes
     *   no queue entry, so nothing below reports a chain in flight.
     *
     * The data-driven `refetchInterval` below returns `false` for both — and
     * React Query CLEARS the interval when it does. In the first that means
     * polling never starts and the run is never seen; in the second it means
     * polling STOPS MID-CHAIN, and nothing but a window focus restarts it.
     *
     * The caller is responsible for dropping this again, which the hook that
     * sets it does on every exit: the cutover, an abandon, and both timeouts.
     *
     * Each React Query OBSERVER owns its own refetch timer, so one consumer
     * asking for this does not change the interval any other consumer of the
     * same cache entry is on.
     */
    forcePolling?: boolean
  } = {}
) {
  const { isLoading } = useAuth()
  const outerEnabled = opts.enabled ?? true
  const forcePolling = opts.forcePolling ?? false
  const queryClient = useQueryClient()

  // Fresh-login race: the very first /sync/status request can fire before
  // PocketBase has attached the auth token to the SDK's outbound headers,
  // returning 401. Without this subscription the page sits forever showing
  // a null season-dropdown — staff have to manually reload to recover.
  // Invalidating on the invalid→valid transition makes the page un-stall
  // on its own as soon as the auth store catches up.
  useEffect(() => {
    let prevValid = pb.authStore.isValid
    return pb.authStore.onChange(() => {
      const nowValid = pb.authStore.isValid
      if (nowValid && !prevValid) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
      }
      prevValid = nowValid
    })
  }, [queryClient])

  return useQuery<SyncStatusResponse | null>({
    queryKey: queryKeys.syncStatus(),
    queryFn: async (): Promise<SyncStatusResponse | null> => {
      try {
        const response = await pb.send('/api/custom/sync/status', {
          method: 'GET',
        })
        return response as SyncStatusResponse
      } catch (err) {
        // Swallow 401 silently — pb.afterSend already clears auth and redirects to /login.
        const status = (err as { status?: number } | null)?.status
        if (status === 401) {
          return null
        }
        throw err
      }
    },
    // Poll every 3 seconds if running or queue has items, stop polling otherwise
    refetchInterval: (query) => {
      // A caller knows a run is in flight that the payload cannot show — the
      // arming gap, or a gap between two of its jobs. Checked before the
      // no-data guard, because a caller that presses before the first status
      // response needs polling too.
      if (forcePolling) return 3000

      const data = query.state.data
      if (!data) return false // Don't poll if no data yet

      // Check if daily sync is running
      const dailySyncRunning = data._daily_sync_running ?? false

      // Check if historical sync is running
      const historicalSyncRunning = data._historical_sync_running ?? false

      // Check if queue has items
      const hasQueuedItems = (data._queue_length ?? 0) > 0

      // Check if any individual sync is running or pending
      const hasActiveSync = Object.entries(data).some(([key, value]) => {
        // Skip the special fields
        if (key.startsWith('_')) return false
        const status = (value as SyncStatus).status
        return status === 'running' || status === 'pending'
      })

      // 3 seconds while any sync is running, queued, or queue has items
      return hasActiveSync || dailySyncRunning || historicalSyncRunning || hasQueuedItems
        ? 3000
        : false
    },
    // Always refetch on window focus to get latest status
    refetchOnWindowFocus: true,
    enabled: !isLoading && outerEnabled,
  })
}
