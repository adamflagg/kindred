import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the financial aid applications computation sync.
 */
export const useFinancialAidApplicationsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/financial-aid-applications?year=${year}`,
  displayName: 'FA Applications',
  alreadyRunningMessage: 'FA Applications sync is already running.',
})
