import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useSyncStatusAPI, type SyncStatus, type SyncStatusResponse } from './useSyncStatusAPI';
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
          const parts: string[] = [];
          if (summary.created > 0) parts.push(`${summary.created} created`);
          if (summary.updated > 0) parts.push(`${summary.updated} updated`);
          if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
          if (summary.errors > 0) parts.push(`${summary.errors} errors`);

          const statsText = parts.length > 0 ? parts.join(', ') : 'no changes';
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
