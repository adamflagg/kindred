import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useSyncStatusAPI, type SyncStatus, type SyncStatusResponse, type SubStats } from './useSyncStatusAPI';
import { invalidateSyncData } from '../utils/queryClient';

// Map sync type IDs to display names
const SYNC_DISPLAY_NAMES: Record<string, string> = {
  sessions: 'Sessions',
  attendees: 'Attendees',
  persons: 'Persons',
  bunks: 'Bunks',
  bunk_plans: 'Bunk Plans',
  bunk_assignments: 'Assignments',
  bunk_requests: 'Bunk Requests',
  process_requests: 'Process Requests',
};

// Helper to format stats for a single entity
function formatStatsText(stats: SubStats, label: string): string {
  const parts: string[] = [];
  if (stats.created > 0) parts.push(`${stats.created} created`);
  if (stats.updated > 0) parts.push(`${stats.updated} updated`);
  if (stats.errors > 0) parts.push(`${stats.errors} errors`);
  if (parts.length === 0) return '';
  return `${label}: ${parts.join(', ')}`;
}

// Track previous statuses to detect transitions
type PreviousStatuses = Record<string, string>;

/**
 * Hook that monitors sync status polling and fires toasts when syncs complete.
 * Detects transitions from 'running' -> 'success' or 'running' -> 'failed'.
 */
export function useSyncCompletionToasts() {
  const { data: syncStatus } = useSyncStatusAPI();
  const previousStatuses = useRef<PreviousStatuses>({});

  useEffect(() => {
    if (!syncStatus) return;

    // Check each sync type for status transitions
    const syncTypes = Object.keys(SYNC_DISPLAY_NAMES);

    for (const syncType of syncTypes) {
      const status = syncStatus[syncType as keyof SyncStatusResponse] as SyncStatus | undefined;
      if (!status) continue;

      const prevStatus = previousStatuses.current[syncType];
      const currentStatus = status.status;

      // Detect completion: was running, now success or failed
      if (prevStatus === 'running' && (currentStatus === 'success' || currentStatus === 'failed')) {
        // Invalidate all sync-related caches to ensure fresh data
        invalidateSyncData();

        const displayName = SYNC_DISPLAY_NAMES[syncType];
        const summary = status.summary;

        if (currentStatus === 'failed') {
          // Error toast
          const errorMsg = status.error || 'Unknown error';
          toast(`${displayName} sync failed: ${errorMsg}`, {
            icon: '❌',
            duration: 8000,
            className: 'toast-lodge toast-lodge-error',
            style: {
              borderLeft: '4px solid hsl(0, 72%, 51%)',
            },
          });
        } else if (summary) {
          // Success toast with stats
          let statsText: string;

          // For persons sync with sub_stats, show combined stats (persons + households)
          // Note: Tags are now stored as multi-select relation on persons, not as separate sub-stats
          if (syncType === 'persons' && summary.sub_stats) {
            const statsParts: string[] = [];

            // Main persons stats
            const personsText = formatStatsText(summary, 'Persons');
            if (personsText) statsParts.push(personsText);

            // Households sub-stats
            const householdsStats = summary.sub_stats['households'];
            if (householdsStats) {
              const householdsText = formatStatsText(householdsStats, 'Households');
              if (householdsText) statsParts.push(householdsText);
            }

            statsText = statsParts.length > 0 ? statsParts.join('\n') : 'no changes';
          } else {
            // Standard stats formatting for other syncs
            const parts: string[] = [];
            if (summary.created > 0) parts.push(`${summary.created} created`);
            if (summary.updated > 0) parts.push(`${summary.updated} updated`);
            if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
            if (summary.errors > 0) parts.push(`${summary.errors} errors`);
            statsText = parts.length > 0 ? parts.join(', ') : 'no changes';
          }

          const hasErrors = summary.errors > 0;

          if (hasErrors) {
            toast(`${displayName} completed with issues: ${statsText}`, {
              icon: '⚠️',
              duration: 6000,
              className: 'toast-lodge toast-lodge-error',
              style: {
                borderLeft: '4px solid hsl(0, 72%, 51%)',
              },
            });
          } else {
            toast.success(`${displayName} complete: ${statsText}`, {
              duration: 5000,
            });
          }
        } else {
          // Success but no summary
          toast.success(`${displayName} sync complete`, {
            duration: 4000,
          });
        }
      }

      // Update previous status
      previousStatuses.current[syncType] = currentStatus;
    }
  }, [syncStatus]);

  return syncStatus;
}
