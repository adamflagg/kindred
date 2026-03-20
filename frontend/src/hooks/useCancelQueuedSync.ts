import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for canceling a queued sync by its ID.
 */
export const useCancelQueuedSync = createSyncMutation<string>({
  endpoint: (queueId) => `/api/custom/sync/queue/${queueId}`,
  method: 'DELETE',
  displayName: 'Cancel Queued Sync',
  onSuccessMessage: () => 'Queued sync canceled',
})
