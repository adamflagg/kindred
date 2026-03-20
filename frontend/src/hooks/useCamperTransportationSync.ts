import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the camper transportation extraction sync.
 */
export const useCamperTransportationSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/camper-transportation?year=${year}`,
  displayName: 'Camper Transportation',
  alreadyRunningMessage: 'Camper Transportation sync is already running.',
})
