import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the lodging assignment ingest.
 */
export const useLodgingAssignmentsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/lodging-assignments?year=${year}`,
  displayName: 'Lodging Assignments',
  alreadyRunningMessage: 'Lodging Assignments sync is already running.',
})
