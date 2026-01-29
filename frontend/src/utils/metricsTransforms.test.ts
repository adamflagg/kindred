/**
 * Tests for metricsTransforms utilities - TDD tests written first.
 *
 * These tests define the expected behavior of the transform functions.
 * Implementation must conform to these tests.
 */

import { describe, it, expect } from 'vitest';
import {
  transformGenderData,
  transformGradeData,
  transformSessionData,
  transformSessionLengthData,
  transformSummerYearsData,
  transformFirstSummerYearData,
  transformNewVsReturningData,
  transformRetentionSessionData,
  transformRetentionSummerYearsData,
  transformRetentionFirstSummerYearData,
  transformPriorSessionData,
  transformDemographicTableData,
  getTrendDirection,
} from './metricsTransforms';

// ============================================================================
// Registration transforms
// ============================================================================

describe('transformGenderData', () => {
  it('transforms gender breakdown to chart data', () => {
    const input = [
      { gender: 'M', count: 60, percentage: 60 },
      { gender: 'F', count: 40, percentage: 40 },
    ];

    const result = transformGenderData(input);

    expect(result).toEqual([
      { name: 'M', value: 60, percentage: 60 },
      { name: 'F', value: 40, percentage: 40 },
    ]);
  });

  it('handles null gender as Unknown', () => {
    const input = [{ gender: null, count: 10, percentage: 100 }];

    const result = transformGenderData(input as any);

    expect(result[0]!.name).toBe('Unknown');
  });

  it('returns empty array for undefined input', () => {
    expect(transformGenderData(undefined)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(transformGenderData([])).toEqual([]);
  });
});

describe('transformGradeData', () => {
  it('transforms grade breakdown to chart data with grade prefix', () => {
    const input = [
      { grade: 5, count: 30, percentage: 30 },
      { grade: 6, count: 70, percentage: 70 },
    ];

    const result = transformGradeData(input);

    expect(result).toEqual([
      { name: 'Grade 5', value: 30, percentage: 30 },
      { name: 'Grade 6', value: 70, percentage: 70 },
    ]);
  });

  it('handles null grade as Unknown', () => {
    const input = [{ grade: null, count: 10, percentage: 100 }];

    const result = transformGradeData(input);

    expect(result[0]!.name).toBe('Unknown');
  });

  it('returns empty array for undefined input', () => {
    expect(transformGradeData(undefined)).toEqual([]);
  });
});

describe('transformSessionData', () => {
  it('transforms session breakdown to chart data with utilization', () => {
    const input = [
      { session_name: 'Session 2', count: 100, utilization: 85.5 },
      { session_name: 'Session 3', count: 120, utilization: 90.0 },
    ];

    const dateLookup = {
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
    };

    const result = transformSessionData(input, dateLookup);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('value', 100);
    expect(result[0]).toHaveProperty('percentage', 85.5);
  });

  it('handles null utilization as 0', () => {
    const input = [{ session_name: 'Session 1', count: 50, utilization: null }];
    const dateLookup = { 'Session 1': '2026-06-01' };

    const result = transformSessionData(input as any, dateLookup);

    expect(result[0]!.percentage).toBe(0);
  });

  it('returns empty array for undefined input', () => {
    expect(transformSessionData(undefined, {})).toEqual([]);
  });

  it('sorts sessions by date and differentiates Taste of Camp sessions', () => {
    const input = [
      { session_name: 'Session 2', count: 100, utilization: 85 },
      { session_name: 'Taste of Camp 2', count: 30, utilization: 80 },
      { session_name: 'Taste of Camp 1', count: 25, utilization: 75 },
    ];

    const dateLookup = {
      'Taste of Camp 1': '2026-06-01',
      'Taste of Camp 2': '2026-06-08',
      'Session 2': '2026-06-15',
    };

    const result = transformSessionData(input, dateLookup);

    // Should be sorted by date, names preserved as-is
    expect(result[0]!.name).toBe('Taste of Camp 1');
    expect(result[1]!.name).toBe('Taste of Camp 2');
    expect(result[2]!.name).toBe('Session 2');
  });
});

describe('transformSessionLengthData', () => {
  it('transforms session length breakdown to chart data', () => {
    const input = [
      { length_category: '2-week', count: 80, percentage: 80 },
      { length_category: '4-week+', count: 20, percentage: 20 },
    ];

    const result = transformSessionLengthData(input);

    expect(result).toEqual([
      { name: '2-week', value: 80, percentage: 80 },
      { name: '4-week+', value: 20, percentage: 20 },
    ]);
  });

  it('returns empty array for undefined input', () => {
    expect(transformSessionLengthData(undefined)).toEqual([]);
  });
});

describe('transformSummerYearsData', () => {
  it('transforms summer years with singular/plural labels', () => {
    const input = [
      { summer_years: 1, count: 50, percentage: 50 },
      { summer_years: 2, count: 30, percentage: 30 },
      { summer_years: 5, count: 20, percentage: 20 },
    ];

    const result = transformSummerYearsData(input);

    expect(result).toEqual([
      { name: '1 summer', value: 50, percentage: 50 },
      { name: '2 summers', value: 30, percentage: 30 },
      { name: '5 summers', value: 20, percentage: 20 },
    ]);
  });

  it('returns empty array for undefined input', () => {
    expect(transformSummerYearsData(undefined)).toEqual([]);
  });
});

describe('transformFirstSummerYearData', () => {
  it('transforms first summer year to chart data', () => {
    const input = [
      { first_summer_year: 2020, count: 30, percentage: 30 },
      { first_summer_year: 2022, count: 70, percentage: 70 },
    ];

    const result = transformFirstSummerYearData(input);

    expect(result).toEqual([
      { name: '2020', value: 30, percentage: 30 },
      { name: '2022', value: 70, percentage: 70 },
    ]);
  });

  it('returns empty array for undefined input', () => {
    expect(transformFirstSummerYearData(undefined)).toEqual([]);
  });
});

describe('transformNewVsReturningData', () => {
  it('transforms new vs returning counts to chart data', () => {
    const input = {
      new_count: 40,
      returning_count: 60,
      new_percentage: 40,
      returning_percentage: 60,
    };

    const result = transformNewVsReturningData(input);

    expect(result).toEqual([
      { name: 'New Campers', value: 40, percentage: 40 },
      { name: 'Returning', value: 60, percentage: 60 },
    ]);
  });

  it('returns empty array for undefined input', () => {
    expect(transformNewVsReturningData(undefined)).toEqual([]);
  });
});

// ============================================================================
// Retention transforms
// ============================================================================

describe('transformRetentionSessionData', () => {
  it('transforms retention session breakdown with retention rate percentage', () => {
    const input = [
      { session_name: 'Session 2', base_count: 100, returned_count: 70, retention_rate: 0.7 },
    ];
    const dateLookup = { 'Session 2': '2026-06-15' };

    const result = transformRetentionSessionData(input, dateLookup);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('value', 70);
    expect(result[0]).toHaveProperty('percentage', 70); // retention_rate * 100
  });

  it('returns empty array for undefined input', () => {
    expect(transformRetentionSessionData(undefined, {})).toEqual([]);
  });

  it('sorts sessions by date and differentiates Taste of Camp sessions', () => {
    const input = [
      { session_name: 'Session 2', base_count: 100, returned_count: 70, retention_rate: 0.7 },
      { session_name: 'Taste of Camp 2', base_count: 30, returned_count: 24, retention_rate: 0.8 },
      { session_name: 'Taste of Camp 1', base_count: 25, returned_count: 20, retention_rate: 0.8 },
    ];

    const dateLookup = {
      'Taste of Camp 1': '2026-06-01',
      'Taste of Camp 2': '2026-06-08',
      'Session 2': '2026-06-15',
    };

    const result = transformRetentionSessionData(input, dateLookup);

    // Should be sorted by date, names preserved as-is
    expect(result[0]!.name).toBe('Taste of Camp 1');
    expect(result[1]!.name).toBe('Taste of Camp 2');
    expect(result[2]!.name).toBe('Session 2');
  });
});

describe('transformRetentionSummerYearsData', () => {
  it('transforms retention summer years with singular/plural and retention rate', () => {
    const input = [
      { summer_years: 1, base_count: 50, returned_count: 25, retention_rate: 0.5 },
      { summer_years: 3, base_count: 30, returned_count: 24, retention_rate: 0.8 },
    ];

    const result = transformRetentionSummerYearsData(input);

    expect(result).toEqual([
      { name: '1 summer', value: 25, percentage: 50 },
      { name: '3 summers', value: 24, percentage: 80 },
    ]);
  });

  it('returns empty array for undefined input', () => {
    expect(transformRetentionSummerYearsData(undefined)).toEqual([]);
  });
});

describe('transformRetentionFirstSummerYearData', () => {
  it('transforms retention first summer year with retention rate', () => {
    const input = [
      { first_summer_year: 2020, base_count: 40, returned_count: 32, retention_rate: 0.8 },
    ];

    const result = transformRetentionFirstSummerYearData(input);

    expect(result).toEqual([{ name: '2020', value: 32, percentage: 80 }]);
  });

  it('returns empty array for undefined input', () => {
    expect(transformRetentionFirstSummerYearData(undefined)).toEqual([]);
  });
});

describe('transformPriorSessionData', () => {
  it('transforms prior session data with retention rate', () => {
    const input = [
      { prior_session: 'Session 2', base_count: 80, returned_count: 64, retention_rate: 0.8 },
    ];
    const dateLookup = { 'Session 2': '2026-06-15' };

    const result = transformPriorSessionData(input, dateLookup);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('value', 64);
    expect(result[0]).toHaveProperty('percentage', 80);
  });

  it('returns empty array for undefined input', () => {
    expect(transformPriorSessionData(undefined, {})).toEqual([]);
  });

  it('sorts sessions by date and differentiates Taste of Camp sessions', () => {
    const input = [
      { prior_session: 'Session 2', base_count: 80, returned_count: 64, retention_rate: 0.8 },
      { prior_session: 'Taste of Camp 2', base_count: 30, returned_count: 24, retention_rate: 0.8 },
      { prior_session: 'Taste of Camp 1', base_count: 25, returned_count: 20, retention_rate: 0.8 },
    ];

    const dateLookup = {
      'Taste of Camp 1': '2026-06-01',
      'Taste of Camp 2': '2026-06-08',
      'Session 2': '2026-06-15',
    };

    const result = transformPriorSessionData(input, dateLookup);

    // Should be sorted by date, names preserved as-is
    expect(result[0]!.name).toBe('Taste of Camp 1');
    expect(result[1]!.name).toBe('Taste of Camp 2');
    expect(result[2]!.name).toBe('Session 2');
  });
});

describe('transformDemographicTableData', () => {
  it('transforms demographic data for retention tables', () => {
    const input = [
      { school: 'Oak Valley', base_count: 50, returned_count: 40, retention_rate: 0.8 },
      { school: 'Riverside', base_count: 30, returned_count: 21, retention_rate: 0.7 },
    ];

    const result = transformDemographicTableData(input, 'school');

    expect(result).toEqual([
      { name: 'Oak Valley', base_count: 50, returned_count: 40, retention_rate: 0.8 },
      { name: 'Riverside', base_count: 30, returned_count: 21, retention_rate: 0.7 },
    ]);
  });

  it('works with city field', () => {
    const input = [{ city: 'San Francisco', base_count: 20, returned_count: 16, retention_rate: 0.8 }];

    const result = transformDemographicTableData(input, 'city');

    expect(result[0]!.name).toBe('San Francisco');
  });

  it('works with synagogue field', () => {
    const input = [{ synagogue: 'Beth Israel', base_count: 15, returned_count: 12, retention_rate: 0.8 }];

    const result = transformDemographicTableData(input, 'synagogue');

    expect(result[0]!.name).toBe('Beth Israel');
  });

  it('returns empty array for undefined input', () => {
    expect(transformDemographicTableData(undefined, 'school')).toEqual([]);
  });
});

// ============================================================================
// Trend utilities
// ============================================================================

describe('getTrendDirection', () => {
  it('returns improving data for improving trend', () => {
    const result = getTrendDirection('improving');

    expect(result.label).toBe('Improving');
    expect(result.colorClass).toContain('emerald');
  });

  it('returns declining data for declining trend', () => {
    const result = getTrendDirection('declining');

    expect(result.label).toBe('Declining');
    expect(result.colorClass).toContain('red');
  });

  it('returns stable data for stable trend', () => {
    const result = getTrendDirection('stable');

    expect(result.label).toBe('Stable');
    expect(result.colorClass).toContain('muted');
  });

  it('returns stable data for unknown trend', () => {
    const result = getTrendDirection('unknown' as any);

    expect(result.label).toBe('Stable');
  });
});
