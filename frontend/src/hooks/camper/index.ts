/**
 * Camper hooks barrel export
 * Re-export all hooks and types for external use
 */

// Types
export type {
  HistoricalRecord,
  OriginalBunkData,
  SatisfactionStatus,
  SatisfactionResult,
  SatisfactionMap,
  SiblingWithEnrollment,
} from './types';

// Hooks
export { useCamperEnrollment, type UseCamperEnrollmentResult } from './useCamperEnrollment';
export { useCamperHistory, type UseCamperHistoryResult } from './useCamperHistory';
export { useSiblings, type UseSiblingsResult } from './useSiblings';
export { useOriginalBunkData, type UseOriginalBunkDataResult } from './useOriginalBunkData';
export { useAllBunkRequests, type EnhancedBunkRequest, type UseAllBunkRequestsResult } from './useAllBunkRequests';
export { useSatisfactionData, type UseSatisfactionDataResult } from './useSatisfactionData';
