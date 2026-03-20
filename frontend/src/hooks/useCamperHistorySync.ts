import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the camper history computation sync.
 */
export const useCamperHistorySync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/camper-history?year=${year}`,
  displayName: 'Camper History',
  alreadyRunningMessage: 'Camper History sync is already running.',
})
