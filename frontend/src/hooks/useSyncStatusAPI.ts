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
  summary?: {
    created: number
    updated: number
    skipped: number
    errors: number
    already_processed?: number // For process_requests: records already processed
    prod_audit_warnings?: number // For stranded_assignment_cleanup: stranded prod assignments (observe-only)
    lodging_prod_audit_warnings?: number // For stranded_assignment_cleanup: stranded lodging prod assignments (observe-only)
    duration?: number
    sub_stats?: Record<string, SubStats> // For combined syncs (e.g., persons includes households)
  }
  year?: number // Year being synced (0 or undefined = current year)
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
  google_sheets_export: SyncStatus
  // Transform phase (derived tables)
  camper_history: SyncStatus
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

export function useSyncStatusAPI(opts: { enabled?: boolean } = {}) {
  const { isLoading } = useAuth()
  const outerEnabled = opts.enabled ?? true
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
