import { describe, expect, it } from 'vitest'

import { COMPARABLE_METRICS, METRIC_REGISTRY, formatMetric, getMetric } from './metricRegistry'

describe('METRIC_REGISTRY', () => {
  it('every entry has required fields', () => {
    Object.values(METRIC_REGISTRY).forEach((m) => {
      expect(m.key).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.description).toBeTruthy()
      expect(['lower-better', 'higher-better', 'context']).toContain(m.interpretation)
      expect(['integer', 'decimal', 'percent', 'duration']).toContain(m.format)
      expect(['timing', 'quality', 'search', 'model', 'context']).toContain(m.group)
    })
  })

  it('keys are stable (snapshot test for accidental rename detection)', () => {
    expect(Object.keys(METRIC_REGISTRY).sort()).toEqual(
      [
        'walltime_seconds',
        'user_time_seconds',
        'deterministic_time',
        'best_objective_bound',
        'optimality_gap',
        'gap_integral',
        'num_solutions_found',
        'num_branches',
        'num_conflicts',
        'num_booleans',
        'num_integer_variables',
        'model_num_variables',
        'model_num_constraints',
        'num_bool_or',
      ].sort()
    )
  })

  it('COMPARABLE_METRICS is a subset of registry keys', () => {
    COMPARABLE_METRICS.forEach((k) => {
      expect(METRIC_REGISTRY).toHaveProperty(k)
    })
  })
})

describe('getMetric', () => {
  it('returns the entry for a known key', () => {
    expect(getMetric('walltime_seconds').label).toBe('Wall time')
  })

  it('returns a generic fallback for unknown keys instead of throwing', () => {
    expect(() => getMetric('not_a_real_metric')).not.toThrow()
    const fallback = getMetric('not_a_real_metric')
    expect(fallback.label).toBe('not_a_real_metric')
    expect(fallback.format).toBe('integer')
  })
})

describe('formatMetric', () => {
  it('formats percent', () => {
    expect(formatMetric('optimality_gap', 0.023)).toBe('2.30%')
  })
  it('formats duration', () => {
    expect(formatMetric('walltime_seconds', 23.1)).toBe('23.1s')
  })
  it('formats integer', () => {
    expect(formatMetric('num_branches', 8421)).toBe('8,421')
  })
  it('returns "—" for null', () => {
    expect(formatMetric('user_time_seconds', null)).toBe('—')
  })
})
