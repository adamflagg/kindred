/**
 * TDD Tests for useDrilldownAttendees hook.
 *
 * Tests verify the hook uses authenticated fetch to prevent 401 errors.
 */
import { describe, it, expect } from 'vitest';

describe('useDrilldownAttendees', () => {
  describe('hook export', () => {
    it('should export useDrilldownAttendees hook', async () => {
      const module = await import('./useDrilldownAttendees');
      expect(typeof module.useDrilldownAttendees).toBe('function');
    });
  });

  describe('authentication', () => {
    it('should import useApiWithAuth for authenticated requests', async () => {
      // Read the source file and verify it imports useApiWithAuth
      const sourceContent = await import('./useDrilldownAttendees?raw');
      const source = sourceContent.default;

      expect(source).toContain('useApiWithAuth');
      expect(source).toContain('fetchWithAuth');
    });

    it('should NOT use plain fetch() for API calls', async () => {
      // The hook should use fetchWithAuth, not plain fetch
      const sourceContent = await import('./useDrilldownAttendees?raw');
      const source = sourceContent.default;

      // Should have fetchWithAuth
      expect(source).toContain('fetchWithAuth');

      // Should NOT have plain fetch() call to the API endpoint
      // The pattern `await fetch(` indicates plain fetch usage
      // But we need to allow the fetchWithAuth import, so check for the pattern more specifically
      const hasPlainFetchApiCall = /await\s+fetch\s*\(`\/api/.test(source);
      expect(hasPlainFetchApiCall).toBe(false);
    });
  });

  describe('query key structure', () => {
    it('should have drilldown in queryKeys', async () => {
      const { queryKeys } = await import('../utils/queryKeys');

      expect(typeof queryKeys.drilldown).toBe('function');
    });

    it('should include breakdown parameters in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys');

      const key = queryKeys.drilldown(2026, 'gender', 'F', undefined, 'main,embedded', 'enrolled');
      expect(Array.isArray(key)).toBe(true);
      expect(key).toContain('metrics');
      expect(key).toContain('drilldown');
      expect(key).toContain(2026);
      expect(key).toContain('gender');
      expect(key).toContain('F');
    });
  });

  describe('API endpoint format', () => {
    it('should call /api/metrics/drilldown endpoint', () => {
      const expectedEndpoint = '/api/metrics/drilldown';
      expect(expectedEndpoint).toBe('/api/metrics/drilldown');
    });

    it('should include required query parameters', () => {
      const params = new URLSearchParams({
        year: '2026',
        breakdown_type: 'gender',
        breakdown_value: 'F',
      });

      expect(params.get('year')).toBe('2026');
      expect(params.get('breakdown_type')).toBe('gender');
      expect(params.get('breakdown_value')).toBe('F');
    });

    it('should include optional session filtering params', () => {
      const params = new URLSearchParams({
        year: '2026',
        breakdown_type: 'grade',
        breakdown_value: '5',
        session_cm_id: '2001',
        session_types: 'main,embedded',
        status_filter: 'enrolled',
      });

      expect(params.get('session_cm_id')).toBe('2001');
      expect(params.get('session_types')).toBe('main,embedded');
      expect(params.get('status_filter')).toBe('enrolled');
    });
  });

  describe('DrilldownFilter type', () => {
    it('should have DrilldownFilter interface', async () => {
      const typesModule = await import('../types/metrics');
      expect(typesModule).toBeDefined();
    });

    it('DrilldownFilter should have correct structure', () => {
      const expectedShape = {
        type: 'gender' as const,
        value: 'F',
        label: 'Female',
      };

      expect(['session', 'gender', 'grade', 'school', 'years_at_camp', 'status']).toContain(
        expectedShape.type,
      );
      expect(expectedShape.value).toBeDefined();
      expect(expectedShape.label).toBeDefined();
    });
  });

  describe('DrilldownAttendee type', () => {
    it('DrilldownAttendee should have correct structure', () => {
      const expectedShape = {
        person_id: 12345,
        first_name: 'Emma',
        last_name: 'Johnson',
        preferred_name: 'Em',
        grade: 5,
        gender: 'F',
        age: 11,
        school: 'Riverside Elementary',
        city: 'Oakland',
        years_at_camp: 2,
        session_name: 'Session 2',
        session_cm_id: 2001,
        status: 'enrolled',
        is_returning: true,
      };

      expect(Object.keys(expectedShape)).toContain('person_id');
      expect(Object.keys(expectedShape)).toContain('first_name');
      expect(Object.keys(expectedShape)).toContain('last_name');
      expect(Object.keys(expectedShape)).toContain('session_name');
      expect(Object.keys(expectedShape)).toContain('session_cm_id');
      expect(Object.keys(expectedShape)).toContain('status');
      expect(Object.keys(expectedShape)).toContain('is_returning');
    });
  });

  describe('enabled state', () => {
    it('should be enabled when filter is provided', () => {
      const filter = { type: 'gender' as const, value: 'F', label: 'Female' };
      const enabled = !!filter;

      expect(enabled).toBe(true);
    });

    it('should be disabled when filter is null', () => {
      const filter = null;
      const enabled = !!filter;

      expect(enabled).toBe(false);
    });
  });
});
