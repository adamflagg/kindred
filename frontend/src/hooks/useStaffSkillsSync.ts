import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the staff skills extraction sync.
 */
export const useStaffSkillsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/staff-skills?year=${year}`,
  displayName: 'Staff Skills',
  alreadyRunningMessage: 'Staff Skills sync is already running.',
})
