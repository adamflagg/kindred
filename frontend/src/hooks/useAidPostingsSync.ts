import { createSyncMutation } from './createSyncMutation'

/**
 * Hook for running the campership ledger (aid_postings) sync for one season.
 */
export const useAidPostingsSync = createSyncMutation<number>({
  endpoint: (year) => `/api/custom/sync/aid-postings?year=${year}`,
  displayName: 'Aid Ledger',
  alreadyRunningMessage: 'Aid Ledger sync is already running.',
})
