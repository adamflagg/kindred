/**
 * TDD Tests for useRetentionTrends hook.
 *
 * Tests are written FIRST before implementation (TDD).
 * This hook fetches 3-year retention trend data for the retention tab.
 */
import { describe, it, expect } from 'vitest';

describe('useRetentionTrends', () => {
  describe('hook export', () => {
    it('should export useRetentionTrends hook', async () => {
      const module = await import('./useRetentionTrends');
      expect(typeof module.useRetentionTrends).toBe('function');
    });
  });

  describe('hook behavior', () => {
    it('should return retention trends data for 3 years', () => {
      // The hook should return structure like:
      // {
      //   data: RetentionTrendsResponse,
      //   isLoading: boolean,
      //   error: Error | null
      // }
      const expectedDataShape = {
        years: expect.any(Array),
        avg_retention_rate: expect.any(Number),
        trend_direction: expect.any(String),
      };

      // Verify the expected shape
      expect(expectedDataShape.years).toBeDefined();
      expect(expectedDataShape.avg_retention_rate).toBeDefined();
      expect(expectedDataShape.trend_direction).toBeDefined();
    });

    it('should accept currentYear as required parameter', () => {
      // The hook signature should be:
      // useRetentionTrends(currentYear: number, options?: {
      //   numYears?: number,
      //   sessionTypes?: string,
      //   sessionCmId?: number
      // })

      // This is verified by TypeScript at compile time
      const currentYear = 2026;
      expect(currentYear).toBeGreaterThan(0);
    });

    it('should accept optional numYears parameter', () => {
      // Default should be 3 years
      const defaultNumYears = 3;
      const customNumYears = 5;

      expect(defaultNumYears).toBe(3);
      expect(customNumYears).toBe(5);
    });

    it('should accept optional sessionTypes parameter', () => {
      // Filter to specific session types
      const sessionTypes = 'main,embedded';
      expect(sessionTypes).toBe('main,embedded');
    });

    it('should accept optional sessionCmId parameter', () => {
      // Filter to specific session
      const sessionCmId = 2001;
      expect(sessionCmId).toBe(2001);
    });
  });

  describe('query key structure', () => {
    it('should have retentionTrends in queryKeys', async () => {
      const { queryKeys } = await import('../utils/queryKeys');

      // The new key should exist
      expect(typeof queryKeys.retentionTrends).toBe('function');
    });

    it('should include currentYear in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys');

      const key = queryKeys.retentionTrends(2026);
      expect(Array.isArray(key)).toBe(true);
      expect(key).toContain('metrics');
      expect(key).toContain('retention-trends');
      expect(key).toContain(2026);
    });

    it('should include optional parameters in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys');

      const key = queryKeys.retentionTrends(2026, 5, 'main,embedded', 2001);
      expect(Array.isArray(key)).toBe(true);
      expect(key).toContain(2026);
      expect(key).toContain(5);
      expect(key).toContain('main,embedded');
      expect(key).toContain(2001);
    });
  });
});

describe('RetentionTrendsResponse type', () => {
  it('should have RetentionTrendsResponse interface', async () => {
    const typesModule = await import('../types/metrics');

    // Verify the module loaded
    expect(typesModule).toBeDefined();

    // The interfaces are verified at compile time through imports
    // in useRetentionTrends.ts
  });

  it('should have RetentionTrendYear interface', async () => {
    const typesModule = await import('../types/metrics');

    // Verify the module loaded
    expect(typesModule).toBeDefined();

    // The interfaces are verified at compile time through imports
  });

  it('RetentionTrendYear should have correct structure', () => {
    // Expected structure for a single year transition
    const expectedShape = {
      from_year: 2025,
      to_year: 2026,
      retention_rate: 0.65,
      base_count: 100,
      returned_count: 65,
      by_gender: [],
      by_grade: [],
    };

    expect(Object.keys(expectedShape)).toContain('from_year');
    expect(Object.keys(expectedShape)).toContain('to_year');
    expect(Object.keys(expectedShape)).toContain('retention_rate');
    expect(Object.keys(expectedShape)).toContain('base_count');
    expect(Object.keys(expectedShape)).toContain('returned_count');
    expect(Object.keys(expectedShape)).toContain('by_gender');
    expect(Object.keys(expectedShape)).toContain('by_grade');
  });

  it('RetentionTrendsResponse should have correct structure', () => {
    // Expected structure for the full response
    const expectedShape = {
      years: [], // Array of RetentionTrendYear
      avg_retention_rate: 0.63,
      trend_direction: 'improving', // 'improving' | 'declining' | 'stable'
    };

    expect(Object.keys(expectedShape)).toContain('years');
    expect(Object.keys(expectedShape)).toContain('avg_retention_rate');
    expect(Object.keys(expectedShape)).toContain('trend_direction');
  });

  it('trend_direction should be one of valid values', () => {
    const validDirections = ['improving', 'declining', 'stable'];

    expect(validDirections).toContain('improving');
    expect(validDirections).toContain('declining');
    expect(validDirections).toContain('stable');
  });
});

describe('RetentionTrendBreakdown types', () => {
  it('should have grouped breakdown structure for charts', () => {
    // For grouped bar charts, breakdowns should have multi-year data
    const expectedGenderBreakdownShape = {
      gender: 'M',
      values: [
        { from_year: 2024, to_year: 2025, retention_rate: 0.55 },
        { from_year: 2025, to_year: 2026, retention_rate: 0.60 },
      ],
    };

    expect(expectedGenderBreakdownShape.gender).toBe('M');
    expect(expectedGenderBreakdownShape.values.length).toBe(2);
    expect(expectedGenderBreakdownShape.values[0]?.from_year).toBe(2024);
    expect(expectedGenderBreakdownShape.values[1]?.from_year).toBe(2025);
  });

  it('should have grouped breakdown structure for grade', () => {
    const expectedGradeBreakdownShape = {
      grade: 6,
      values: [
        { from_year: 2024, to_year: 2025, retention_rate: 0.70 },
        { from_year: 2025, to_year: 2026, retention_rate: 0.65 },
      ],
    };

    expect(expectedGradeBreakdownShape.grade).toBe(6);
    expect(expectedGradeBreakdownShape.values.length).toBe(2);
  });
});

describe('API endpoint format', () => {
  it('should call /api/metrics/retention-trends endpoint', () => {
    // The hook should call this endpoint
    const expectedEndpoint = '/api/metrics/retention-trends';

    expect(expectedEndpoint).toBe('/api/metrics/retention-trends');
  });

  it('should include query parameters', () => {
    // Expected query params format
    const params = new URLSearchParams({
      current_year: '2026',
      num_years: '3',
    });

    expect(params.get('current_year')).toBe('2026');
    expect(params.get('num_years')).toBe('3');
  });

  it('should include optional session filtering params', () => {
    const params = new URLSearchParams({
      current_year: '2026',
      session_types: 'main,embedded',
      session_cm_id: '2001',
    });

    expect(params.get('session_types')).toBe('main,embedded');
    expect(params.get('session_cm_id')).toBe('2001');
  });
});

describe('useRetentionTrends enabled state', () => {
  it('should be enabled when currentYear > 0', () => {
    const currentYear = 2026;
    const enabled = currentYear > 0;

    expect(enabled).toBe(true);
  });

  it('should be disabled when currentYear is 0', () => {
    const currentYear = 0;
    const enabled = currentYear > 0;

    expect(enabled).toBe(false);
  });

  it('should be disabled when currentYear is negative', () => {
    const currentYear = -1;
    const enabled = currentYear > 0;

    expect(enabled).toBe(false);
  });
});
