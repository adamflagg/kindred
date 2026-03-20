import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the Quest registrations extraction sync.
 */
export const useQuestRegistrationsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/quest-registrations?year=${year}`,
  displayName: 'Quest Registrations',
  alreadyRunningMessage: 'Quest Registrations sync is already running.',
})
