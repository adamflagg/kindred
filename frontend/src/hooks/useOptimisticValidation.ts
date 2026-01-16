/**
 * useOptimisticValidation Hook
 *
 * Validates request changes locally before sending to backend,
 * preventing 400 errors and offering merge as conflict resolution.
 *
 * This hook checks if a proposed change to a bunk request would conflict
 * with any existing requests (same requester + same requestee + same type).
 */

import { useState, useCallback, useMemo } from 'react';
import type { BunkRequestsResponse } from '../types/pocketbase-types';
import type { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

export interface ValidationParams {
  requestId: string;
  requesterId: number;
  newRequesteeId: number;
  newType: BunkRequestsRequestTypeOptions;
  sessionId: number;
}

export interface Conflict {
  conflictingRequestId: string;
  conflictingRequest: BunkRequestsResponse;
  suggestedResolution: 'merge';
}

export interface UseOptimisticValidationResult {
  conflicts: Conflict[];
  hasConflicts: boolean;
  canSubmit: boolean;
  validateChange: (params: ValidationParams) => void;
  clearConflicts: () => void;
}

export function useOptimisticValidation(
  existingRequests: BunkRequestsResponse[]
): UseOptimisticValidationResult {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const validateChange = useCallback(
    (params: ValidationParams) => {
      const { requestId, requesterId, newRequesteeId, newType, sessionId } = params;

      // Find conflicts: requests with same requester, requestee, type, and session
      // Exclude the request being edited from conflict detection
      const foundConflicts: Conflict[] = [];

      for (const existing of existingRequests) {
        // Skip if this is the same request being edited
        if (existing.id === requestId) {
          continue;
        }

        // Check for conflict: same requester, requestee, type, and session
        if (
          existing.requester_id === requesterId &&
          existing.requestee_id === newRequesteeId &&
          existing.request_type === newType &&
          existing.session_id === sessionId
        ) {
          foundConflicts.push({
            conflictingRequestId: existing.id,
            conflictingRequest: existing,
            suggestedResolution: 'merge',
          });
        }
      }

      setConflicts(foundConflicts);
    },
    [existingRequests]
  );

  const clearConflicts = useCallback(() => {
    setConflicts([]);
  }, []);

  const hasConflicts = useMemo(() => conflicts.length > 0, [conflicts]);
  const canSubmit = useMemo(() => !hasConflicts, [hasConflicts]);

  return {
    conflicts,
    hasConflicts,
    canSubmit,
    validateChange,
    clearConflicts,
  };
}
