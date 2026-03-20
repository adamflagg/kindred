import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the camper dietary extraction sync.
 */
export const useCamperDietarySync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/camper-dietary?year=${year}`,
  displayName: 'Camper Dietary',
  alreadyRunningMessage: 'Camper Dietary sync is already running.',
})
