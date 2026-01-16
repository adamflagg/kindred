/**
 * TDD Tests for useOptimisticValidation Hook
 *
 * Tests the hook that validates request changes locally before sending to backend,
 * preventing 400 errors and offering merge as conflict resolution.
 *
 * Following TDD: These tests are written FIRST to define expected behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useOptimisticValidation } from './useOptimisticValidation';
import type { BunkRequestsResponse } from '../types/pocketbase-types';
import { BunkRequestsRequestTypeOptions } from '../types/pocketbase-types';

// Helper to create mock request
function createMockRequest(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
  return {
    id: 'req_1',
    collectionId: 'bunk_requests',
    collectionName: 'bunk_requests',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    requester_id: 12345,
    requestee_id: 67890,
    request_type: BunkRequestsRequestTypeOptions.bunk_with,
    session_id: 1000001,
    priority: 3,
    confidence_score: 0.95,
    source: 'family',
    source_field: 'share_bunk_with',
    status: 'pending',
    year: 2025,
    is_placeholder: false,
    metadata: {},
    ...overrides,
  } as BunkRequestsResponse;
}

describe('useOptimisticValidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('initial state', () => {
    it('returns no conflicts initially', () => {
      const existingRequests: BunkRequestsResponse[] = [];
      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      expect(result.current.conflicts).toEqual([]);
      expect(result.current.hasConflicts).toBe(false);
    });
  });

  describe('validateChange', () => {
    it('detects conflict when changing to existing request target', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 12345,
          requestee_id: 99999,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 99999, // Same as existing
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(true);
      expect(result.current.conflicts.length).toBe(1);
      expect(result.current.conflicts[0]?.conflictingRequestId).toBe('existing_1');
    });

    it('does not report conflict for same request being edited', () => {
      const existingRequests = [
        createMockRequest({
          id: 'req_1',
          requester_id: 12345,
          requestee_id: 67890,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_1', // Same as the existing request
          requesterId: 12345,
          newRequesteeId: 67890,
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(false);
    });

    it('detects conflict when changing type to match existing request', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 12345,
          requestee_id: 67890,
          request_type: BunkRequestsRequestTypeOptions.not_bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 67890,
          newType: BunkRequestsRequestTypeOptions.not_bunk_with, // Now matches
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(true);
    });

    it('clears conflicts when change no longer conflicts', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 12345,
          requestee_id: 99999,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      // First, create a conflict
      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 99999,
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(true);

      // Now change to a different target - no conflict
      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 88888, // Different target
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(false);
      expect(result.current.conflicts).toEqual([]);
    });

    it('handles different requesters (no conflict for different people)', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 99999, // Different requester
          requestee_id: 67890,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345, // Different requester
          newRequesteeId: 67890,
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(false);
    });
  });

  describe('conflict resolution', () => {
    it('provides conflicting request details for merge option', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 12345,
          requestee_id: 99999,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
          source_field: 'bunking_notes',
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 99999,
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.conflicts[0]).toEqual(
        expect.objectContaining({
          conflictingRequestId: 'existing_1',
          conflictingRequest: expect.objectContaining({
            source_field: 'bunking_notes',
          }),
          suggestedResolution: 'merge',
        })
      );
    });

    it('clearConflicts resets the conflict state', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 12345,
          requestee_id: 99999,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 99999,
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.hasConflicts).toBe(true);

      act(() => {
        result.current.clearConflicts();
      });

      expect(result.current.hasConflicts).toBe(false);
      expect(result.current.conflicts).toEqual([]);
    });
  });

  describe('canSubmit', () => {
    it('returns true when no conflicts', () => {
      const existingRequests: BunkRequestsResponse[] = [];
      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      expect(result.current.canSubmit).toBe(true);
    });

    it('returns false when there are conflicts', () => {
      const existingRequests = [
        createMockRequest({
          id: 'existing_1',
          requester_id: 12345,
          requestee_id: 99999,
          request_type: BunkRequestsRequestTypeOptions.bunk_with,
        }),
      ];

      const { result } = renderHook(() => useOptimisticValidation(existingRequests));

      act(() => {
        result.current.validateChange({
          requestId: 'req_being_edited',
          requesterId: 12345,
          newRequesteeId: 99999,
          newType: BunkRequestsRequestTypeOptions.bunk_with,
          sessionId: 1000001,
        });
      });

      expect(result.current.canSubmit).toBe(false);
    });
  });
});
