/**
 * Session hooks barrel export
 * Re-export all hooks and types for external use
 */

// Types
export type {
  SessionHierarchy,
  SolverOperations,
  CamperMovement,
} from './types';

// Pure functions
export {
  getSubSessions,
  getAgSessions,
  shouldShowAgArea,
} from './useSessionHierarchy';

export {
  useCamperMovement,
  parseCompositeCamperId,
  type ParsedCamperId,
  type UseCamperMovementOptions,
  type UseCamperMovementReturn,
} from './useCamperMovement';

// Hooks
export {
  useSessionHierarchy,
  type UseSessionHierarchyOptions,
  type UseSessionHierarchyResult,
} from './useSessionHierarchy';

export {
  useSolverOperations,
  type UseSolverOperationsOptions,
  type UseSolverOperationsReturn,
  type SolverRunResultWithStats,
  type SolverStats,
  type FetchWithAuthFn,
} from './useSolverOperations';

export {
  useSessionBunks,
  useSessionCampers,
  useBunkRequestsCount,
  extractBunkIds,
  filterAgBunks,
  deduplicateBunksByName,
  mergeCampers,
  buildBunkRequestsFilter,
  type UseSessionBunksOptions,
  type UseSessionCampersOptions,
  type UseBunkRequestsCountOptions,
} from './useSessionData';
