import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the household demographics computation sync.
 */
export const useHouseholdDemographicsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/household-demographics?year=${year}`,
  displayName: 'Household Demographics',
  alreadyRunningMessage: 'Household Demographics sync is already running.',
})
