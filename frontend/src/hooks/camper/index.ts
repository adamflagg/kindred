/**
 * Camper hooks barrel export
 * Re-export all hooks and types for external use
 */

// Types
export type { HistoricalRecord, OriginalBunkData, SiblingWithEnrollment } from './types'

// Hooks
export { useCamperEnrollment, type UseCamperEnrollmentResult } from './useCamperEnrollment'
export { useCamperHistory, type UseCamperHistoryResult } from './useCamperHistory'
export { fetchCamperJourney, fetchParentMainSessions } from './fetchCamperJourney'
export { useSiblings, type UseSiblingsResult } from './useSiblings'
export { useOriginalBunkData, type UseOriginalBunkDataResult } from './useOriginalBunkData'
export {
  useAllBunkRequests,
  type EnhancedBunkRequest,
  type UseAllBunkRequestsResult,
} from './useAllBunkRequests'
