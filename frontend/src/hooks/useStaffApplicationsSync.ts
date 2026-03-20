import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the staff applications extraction sync.
 */
export const useStaffApplicationsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/staff-applications?year=${year}`,
  displayName: 'Staff Applications',
  alreadyRunningMessage: 'Staff Applications sync is already running.',
})
