import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  useSyncStatusAPI,
  type SyncStatus,
  type SyncStatusResponse,
  type SubStats,
} from './useSyncStatusAPI'
import { invalidateSyncData } from '../utils/queryClient'

// Map sync type IDs to display names
const SYNC_DISPLAY_NAMES: Record<string, string> = {
  // Global sync types (cross-year)
  person_tag_defs: 'Tag Definitions',
  custom_field_defs: 'Field Definitions',
  staff_lookups: 'Staff Lookups',
  financial_lookups: 'Financial Lookups',
  // Current year sync types
  session_groups: 'Session Groups',
  sessions: 'Sessions',
  divisions: 'Divisions',
  attendees: 'Attendees',
  persons: 'Persons',
  bunks: 'Bunks',
  bunk_plans: 'Bunk Plans',
  bunk_assignments: 'Assignments',
  staff: 'Staff',
  financial_transactions: 'Financial Transactions',
  bunk_requests: 'Intake Requests',
  process_requests: 'Process Requests',
  // Transform phase (derived tables)
  family_camp_derived: 'Weekend Programs',
  lodging_assignments: 'Lodging Assignments',
  staff_skills: 'Staff Skills',
  financial_aid_applications: 'FA Applications',
  household_demographics: 'Demographics',
  camper_dietary: 'Dietary',
  camper_transportation: 'Transportation',
  quest_registrations: 'Quest Registrations',
  staff_applications: 'Staff Applications',
  staff_vehicle_info: 'Staff Vehicles',
  normalize_geographic: 'Normalize Geo',
  enrollment_snapshots: 'Enrollment Snapshots',
  // Export phase
  multi_workbook_export: 'Sheets Export',
  // On-demand sync types
  person_custom_values: 'Person Custom Values',
  household_custom_values: 'Household Custom Values',
}

// Helper to format stats for a single entity. Exported so kindred#2356's fix can be
// pinned against the real production function rather than a test-local reimplementation.
//
// `skipped` and `skipped_values` are deliberately separate segments, never merged: `skipped`
// is a RECORD count (matches `created`/`updated`/`errors`' unit), while `skipped_values`
// counts discarded custom-field VALUES. Usually those values belong to a record that WAS
// still created (an unmapped field, camper_transportation/staff_applications/
// staff_vehicle_info); staff_applications also has one gate (kindred#2277) where the
// record was NEVER created and the person's dropped answers still land here, alongside
// their own single `skipped` increment for the record. Only those three services ever
// set `skipped_values` -- collapsing the two made "274 created, 557 skipped" read as 557
// dropped applications when it was really 557 dropped field answers across a smaller set
// of rows, some created and some not.
export function formatStatsText(stats: SubStats, label: string): string {
  const parts: string[] = []
  if (stats.created > 0) parts.push(`${stats.created} created`)
  if (stats.updated > 0) parts.push(`${stats.updated} updated`)
  if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
  if (stats.skipped_values && stats.skipped_values > 0) {
    parts.push(`${stats.skipped_values} values skipped`)
  }
  if (stats.errors > 0) parts.push(`${stats.errors} errors`)
  if (parts.length === 0) return ''
  return label ? `${label}: ${parts.join(', ')}` : parts.join(', ')
}

// Track previous statuses to detect transitions
type PreviousStatuses = Record<string, string>

/**
 * Hook that monitors sync status polling and fires toasts when syncs complete.
 * Detects transitions from 'running' -> 'success' or 'running' -> 'failed'.
 */
export function useSyncCompletionToasts(): SyncStatusResponse | null | undefined {
  const { data: syncStatus } = useSyncStatusAPI()
  const previousStatuses = useRef<PreviousStatuses>({})

  useEffect(() => {
    if (!syncStatus) return

    // Check each sync type for status transitions
    const syncTypes = Object.keys(SYNC_DISPLAY_NAMES)

    for (const syncType of syncTypes) {
      const status = syncStatus[syncType as keyof SyncStatusResponse] as SyncStatus | undefined
      if (!status) continue

      const prevStatus = previousStatuses.current[syncType]
      const currentStatus = status.status

      // Detect completion: was running, now success or failed
      if (prevStatus === 'running' && (currentStatus === 'success' || currentStatus === 'failed')) {
        // Invalidate all sync-related caches to ensure fresh data
        invalidateSyncData()

        const displayName = SYNC_DISPLAY_NAMES[syncType]
        const summary = status.summary

        if (currentStatus === 'failed') {
          // Error toast
          const errorMsg = status.error ?? 'Unknown error'
          toast(`${displayName} sync failed: ${errorMsg}`, {
            icon: '❌',
            duration: 8000,
            className: 'toast-lodge toast-lodge-error',
            style: {
              borderLeft: '4px solid hsl(0, 72%, 51%)',
            },
          })
        } else if (summary) {
          // Success toast with stats
          let statsText: string

          // For persons sync with sub_stats, show combined stats (persons + households)
          // Note: Tags are now stored as multi-select relation on persons, not as separate sub-stats
          if (syncType === 'persons' && summary.sub_stats) {
            const statsParts: string[] = []

            // Main persons stats
            const personsText = formatStatsText(summary, 'Persons')
            if (personsText) statsParts.push(personsText)

            // Households sub-stats
            const householdsStats = summary.sub_stats['households']
            if (householdsStats) {
              const householdsText = formatStatsText(householdsStats, 'Households')
              if (householdsText) statsParts.push(householdsText)
            }

            statsText = statsParts.length > 0 ? statsParts.join('\n') : 'no changes'
          } else {
            // Standard stats formatting for other syncs -- including camper_transportation
            // and staff_applications, kindred#2356's reason for routing this through the
            // same formatStatsText the persons/households branch above uses rather than a
            // second hand-copied field list that could re-diverge on the next counter added.
            // No label (''): the outer toast message already prefixes displayName.
            const text = formatStatsText(summary, '')
            statsText = text || 'no changes'
          }

          const hasErrors = summary.errors > 0

          if (hasErrors) {
            toast(`${displayName} completed with issues: ${statsText}`, {
              icon: '⚠️',
              duration: 6000,
              className: 'toast-lodge toast-lodge-error',
              style: {
                borderLeft: '4px solid hsl(0, 72%, 51%)',
              },
            })
          } else {
            toast.success(`${displayName} complete: ${statsText}`, {
              duration: 5000,
            })
          }
        } else {
          // Success but no summary
          toast.success(`${displayName} sync complete`, {
            duration: 4000,
          })
        }
      }

      // Update previous status
      previousStatuses.current[syncType] = currentStatus
    }
  }, [syncStatus])

  return syncStatus
}
