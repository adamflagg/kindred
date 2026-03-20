import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the family camp derived tables computation sync.
 */
export const useFamilyCampDerivedSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/family-camp-derived?year=${year}`,
  displayName: 'Family Camp Derived',
  alreadyRunningMessage: 'Family Camp Derived sync is already running.',
})
