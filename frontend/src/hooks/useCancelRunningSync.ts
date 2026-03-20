import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for canceling the currently running sync.
 */
export const useCancelRunningSync = createSyncMutation({
  endpoint: '/api/custom/sync/running',
  method: 'DELETE',
  displayName: 'Cancel Sync',
  onSuccessMessage: () => 'Sync canceled',
})
