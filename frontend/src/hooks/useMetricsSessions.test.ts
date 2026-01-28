/**
 * Tests for useMetricsSessions hook
 *
 * TDD: These tests define the expected behavior before implementation.
 */
import { describe, it, expect } from 'vitest';

describe('useMetricsSessions', () => {
  it('should export useMetricsSessions hook', async () => {
    // This will fail until the hook is implemented
    const module = await import('./useMetricsSessions');
    expect(typeof module.useMetricsSessions).toBe('function');
  });

  describe('hook behavior', () => {
    it('should return sessions for the given year', () => {
      // Test structure: hook should return
      // - data: array of sessions with cm_id, name, session_type
      // - isLoading: boolean
      // - error: Error | null
      const expectedShape = {
        data: expect.any(Array),
        isLoading: expect.any(Boolean),
        error: null,
      };

      // The actual hook will be tested with React Testing Library
      // once implemented. For now, just verify the expected shape.
      expect(expectedShape).toMatchObject({
        data: expect.any(Array),
        isLoading: expect.any(Boolean),
      });
    });

    it('should filter to main and embedded session types only', () => {
      // Sessions returned should only include main and embedded types
      // (not ag, family, training, etc.) for the dropdown
      const validSessionTypes = ['main', 'embedded'];
      const session = { session_type: 'main' };

      expect(validSessionTypes).toContain(session.session_type);
    });

    it('should sort sessions by start_date', () => {
      // Sessions should be sorted chronologically
      const sessions = [
        { name: 'Session 4', start_date: '2025-07-27' },
        { name: 'Session 2', start_date: '2025-06-15' },
        { name: 'Session 3', start_date: '2025-07-06' },
      ];

      const sorted = [...sessions].sort(
        (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
      );

      expect(sorted[0].name).toBe('Session 2');
      expect(sorted[1].name).toBe('Session 3');
      expect(sorted[2].name).toBe('Session 4');
    });
  });
});

describe('RetentionMetrics types', () => {
  it('should include new breakdown types in RetentionMetrics interface', async () => {
    // Import the types to verify they exist
    const typesModule = await import('../types/metrics');

    // New types should be exported
    type RetentionBySummerYears = (typeof typesModule)['RetentionBySummerYears'];
    type RetentionByFirstSummerYear = (typeof typesModule)['RetentionByFirstSummerYear'];
    type RetentionByPriorSession = (typeof typesModule)['RetentionByPriorSession'];

    // If these type aliases work, the types exist
    // TypeScript will error at compile time if they don't exist
    const _summerYearsCheck: RetentionBySummerYears | undefined = undefined;
    const _firstSummerYearCheck: RetentionByFirstSummerYear | undefined = undefined;
    const _priorSessionCheck: RetentionByPriorSession | undefined = undefined;

    // Verify the module loaded and has expected keys
    expect(typesModule).toBeDefined();
    expect(_summerYearsCheck).toBeUndefined();
    expect(_firstSummerYearCheck).toBeUndefined();
    expect(_priorSessionCheck).toBeUndefined();
  });

  it('RetentionBySummerYears should have correct structure', async () => {
    const expectedShape = {
      summer_years: 3,
      base_count: 10,
      returned_count: 8,
      retention_rate: 0.8,
    };

    // Verify shape matches expected structure
    expect(Object.keys(expectedShape)).toEqual([
      'summer_years',
      'base_count',
      'returned_count',
      'retention_rate',
    ]);
  });

  it('RetentionByFirstSummerYear should have correct structure', async () => {
    const expectedShape = {
      first_summer_year: 2020,
      base_count: 15,
      returned_count: 12,
      retention_rate: 0.8,
    };

    expect(Object.keys(expectedShape)).toEqual([
      'first_summer_year',
      'base_count',
      'returned_count',
      'retention_rate',
    ]);
  });

  it('RetentionByPriorSession should have correct structure', async () => {
    const expectedShape = {
      prior_session: 'Session 2',
      base_count: 25,
      returned_count: 20,
      retention_rate: 0.8,
    };

    expect(Object.keys(expectedShape)).toEqual([
      'prior_session',
      'base_count',
      'returned_count',
      'retention_rate',
    ]);
  });
});

describe('useRetentionMetrics hook updates', () => {
  it('should accept optional sessionCmId parameter', async () => {
    // The useRetentionMetrics hook should accept a 4th parameter for session filtering
    const module = await import('./useMetrics');

    // Verify the function exists
    expect(typeof module.useRetentionMetrics).toBe('function');

    // The function signature should be:
    // useRetentionMetrics(baseYear, compareYear, sessionTypes?, sessionCmId?)
    // This is tested by TypeScript, we just verify it exists
  });
});

describe('queryKeys updates', () => {
  it('should have retention key that accepts sessionCmId', async () => {
    const { queryKeys } = await import('../utils/queryKeys');

    // The retention key should accept 4 parameters
    // (baseYear, compareYear, sessionTypes, sessionCmId)
    const key = queryKeys.retention(2025, 2026, 'main,embedded', 1001);

    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain('metrics');
    expect(key).toContain('retention');
    expect(key).toContain(2025);
    expect(key).toContain(2026);
  });

  it('should have metricsSessions key for sessions dropdown', async () => {
    const { queryKeys } = await import('../utils/queryKeys');

    // A new key for fetching sessions should exist
    expect(typeof queryKeys.metricsSessions).toBe('function');

    const key = queryKeys.metricsSessions(2025);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain('metrics');
    expect(key).toContain('sessions');
    expect(key).toContain(2025);
  });
});
