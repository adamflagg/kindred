import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the staff vehicle info extraction sync.
 */
export const useStaffVehicleInfoSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/staff-vehicle-info?year=${year}`,
  displayName: 'Staff Vehicle Info',
  alreadyRunningMessage: 'Staff Vehicle Info sync is already running.',
})
