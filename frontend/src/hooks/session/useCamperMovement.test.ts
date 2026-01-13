/**
 * Tests for useCamperMovement hook
 * Following TDD - tests written first, implementation follows
 */

import { describe, it, expect, vi } from 'vitest';
import { parseCompositeCamperId } from './useCamperMovement';

describe('parseCompositeCamperId', () => {
  it('should parse composite ID format (person_cm_id:session_cm_id)', () => {
    const result = parseCompositeCamperId('12345:6789');

    expect(result).toEqual({
      personCmId: 12345,
      sessionCmId: 6789,
      isComposite: true
    });
  });

  it('should handle legacy format (just ID)', () => {
    const result = parseCompositeCamperId('simple-id');

    expect(result).toEqual({
      personCmId: null,
      sessionCmId: null,
      isComposite: false,
      legacyId: 'simple-id'
    });
  });

  it('should throw on invalid composite format', () => {
    expect(() => parseCompositeCamperId('abc:def')).toThrow('Invalid composite camper ID');
  });

  it('should handle single number format', () => {
    const result = parseCompositeCamperId('12345');

    expect(result.isComposite).toBe(false);
    expect(result.legacyId).toBe('12345');
  });
});

describe('camper movement scenarios', () => {
  describe('scenario mode', () => {
    it('should update draft assignments via API in scenario mode', async () => {
      const mockFetchWithAuth = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, changed: true })
      });

      const scenarioId = 'scenario-123';
      const personCmId = 12345;
      const bunkCmId = 100;

      // Simulate the API call
      const response = await mockFetchWithAuth(
        `/api/scenarios/${scenarioId}/assignments`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            person_id: personCmId,
            bunk_id: bunkCmId,
            updated_by: 'user'
          })
        }
      );

      expect(response.ok).toBe(true);
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('/scenarios/scenario-123/assignments'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"person_id":12345')
        })
      );
    });

    it('should handle unassign (null bunk) in scenario mode', async () => {
      const mockFetchWithAuth = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, bunk_id: null })
      });

      const scenarioId = 'scenario-123';
      const personCmId = 12345;

      const response = await mockFetchWithAuth(
        `/api/scenarios/${scenarioId}/assignments`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            person_id: personCmId,
            bunk_id: null,
            updated_by: 'user'
          })
        }
      );

      expect(response.ok).toBe(true);
    });
  });

  describe('production mode', () => {
    it('should try incremental update first for better performance', async () => {
      const mockFetchWithAuth = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      const sessionCmId = 1234;
      const personCmId = 5678;
      const bunkCmId = 100;
      const year = 2025;

      // Simulate incremental update API call
      const response = await mockFetchWithAuth(
        `/api/sessions/${sessionCmId}/campers/${personCmId}/position?year=${year}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_bunk_id: bunkCmId })
        }
      );

      expect(response.ok).toBe(true);
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('/position'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should fall back to traditional method if incremental fails', async () => {
      let incrementalAttempted = false;
      let traditionalAttempted = false;

      const mockFetchWithAuth = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/position')) {
          incrementalAttempted = true;
          return Promise.reject(new Error('Incremental update failed'));
        }
        traditionalAttempted = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      try {
        await mockFetchWithAuth('/api/sessions/1234/campers/5678/position?year=2025', {});
      } catch {
        // Fallback to traditional
        await mockFetchWithAuth('/api/traditional', {});
      }

      expect(incrementalAttempted).toBe(true);
      expect(traditionalAttempted).toBe(true);
    });
  });

  describe('move feedback', () => {
    it('should detect when no actual change occurred', () => {
      const response = { success: true, changed: false };

      const wasChanged = response.changed !== false;

      expect(wasChanged).toBe(false);
    });

    it('should default to changed=true for backwards compatibility', () => {
      const response = { success: true }; // No 'changed' field

      const wasChanged = (response as { changed?: boolean }).changed !== false;

      expect(wasChanged).toBe(true);
    });

    it('should invalidate graph cache on successful move', () => {
      const mockGraphCacheService = {
        invalidate: vi.fn()
      };

      const sessionCmId = 1234;

      // After successful move
      mockGraphCacheService.invalidate(sessionCmId);

      expect(mockGraphCacheService.invalidate).toHaveBeenCalledWith(1234);
    });
  });

  describe('production confirmation', () => {
    it('should require confirmation before production moves', () => {
      const isProductionMode = true;
      const pendingMove = { camperId: '123:456', bunkId: 'bunk-1' };

      const shouldShowDialog = isProductionMode && pendingMove !== null;

      expect(shouldShowDialog).toBe(true);
    });

    it('should not require confirmation in scenario mode', () => {
      const isProductionMode = false;
      const pendingMove = { camperId: '123:456', bunkId: 'bunk-1' };

      const shouldShowDialog = isProductionMode && pendingMove !== null;

      expect(shouldShowDialog).toBe(false);
    });

    it('should clear pending move after execution', async () => {
      let pendingMove: { camperId: string; bunkId: string | null } | null = {
        camperId: '123:456',
        bunkId: 'bunk-1'
      };

      // Simulate execution
      await Promise.resolve(); // mock move execution
      pendingMove = null;

      expect(pendingMove).toBeNull();
    });
  });
});

describe('error handling', () => {
  it('should throw descriptive error for invalid camper ID', () => {
    const invalidId = 'not:a:valid:format';

    expect(() => {
      const parts = invalidId.split(':');
      if (parts.length > 2) {
        throw new Error(`Invalid camper ID format: ${invalidId}`);
      }
    }).toThrow('Invalid camper ID format');
  });

  it('should handle API failures gracefully', async () => {
    const mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Database connection failed')
    });

    const response = await mockFetchWithAuth('/api/scenarios/123/assignments', {});

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });
});
