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
      expect([
        'timing',
        'quality',
        'search',
        'model',
        'context',
        'outcome_requests',
        'outcome_campers',
        'size',
        'churn',
      ]).toContain(m.group)
    })
  })

  it('keys are stable (snapshot test for accidental rename detection)', () => {
    expect(Object.keys(METRIC_REGISTRY).sort()).toEqual(
      [
        // existing 17
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
        'num_linear',
        'num_bool_and',
        'num_lin_max',
        // Tier 1 observability (Stream 2, issue #1380)
        'num_reified_linear',
        'max_linear_coefficient',
        // new PR1 keys
        'mp_request_rate',
        'mp_camper_rate',
        'all_request_rate',
        'all_camper_rate',
        'mp_requests_satisfied',
        'mp_requests_total',
        'mp_campers_satisfied',
        'mp_campers_total',
        'all_campers_satisfied',
        'all_campers_total',
        'all_requests_satisfied',
        'all_requests_total',
        'satisfied_request_count',
        'total_requests',
        'impossible_requests',
        'affected_campers',
        'unsatisfied_no_possible',
        'unsatisfied_material_parent_unmet',
        'unsatisfied_other_unmet',
        'total_persons',
        'total_bunks',
        'num_workers',
        'time_budget_seconds',
        'assignments_changed',
        'new_assignments',
        'objective_value',
        // Tier 2 plateau metrics (Stream 2, Phase 2)
        'lp_root_gap',
        'presolve_compression_ratio',
        'presolve_booleans_pre',
        'objective_plateau_time',
        'time_to_first_solution',
        'bound_gain_after_plateau',
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

describe('metric labels (mockup parity)', () => {
  it('prefixes model-group metrics with "Model"', () => {
    expect(getMetric('num_booleans').label).toBe('Model Booleans')
    expect(getMetric('num_integer_variables').label).toBe('Model Integers')
    expect(getMetric('model_num_variables').label).toBe('Model variables')
    expect(getMetric('model_num_constraints').label).toBe('Model constraints')
  })

  it('labels num_bool_or as "bool_or constraints"', () => {
    expect(getMetric('num_bool_or').label).toBe('bool_or constraints')
  })
})

describe('constraint-type metrics (mockup parity)', () => {
  it('includes new constraint-type metrics with parent and highlight', () => {
    const linear = getMetric('num_linear')
    expect(linear.parent).toBe('model_num_constraints')
    expect(linear.highlight).toBeFalsy()

    const lin_max = getMetric('num_lin_max')
    expect(lin_max.parent).toBe('model_num_constraints')
    expect(lin_max.highlight).toEqual({ mode: 'on-delta' })

    const bool_or = getMetric('num_bool_or')
    expect(bool_or.parent).toBe('model_num_constraints')
    expect(bool_or.highlight).toEqual({ mode: 'on-delta' })
  })

  it('COMPARABLE_METRICS surfaces all four constraint-type metrics', () => {
    expect(COMPARABLE_METRICS).toContain('num_linear')
    expect(COMPARABLE_METRICS).toContain('num_bool_and')
    expect(COMPARABLE_METRICS).toContain('num_bool_or')
    expect(COMPARABLE_METRICS).toContain('num_lin_max')
  })

  it('COMPARABLE_METRICS surfaces user_time and best_bound (parity with drilldown)', () => {
    expect(COMPARABLE_METRICS).toContain('user_time_seconds')
    expect(COMPARABLE_METRICS).toContain('best_objective_bound')
    expect(COMPARABLE_METRICS).toContain('num_booleans')
    expect(COMPARABLE_METRICS).toContain('num_integer_variables')
  })
})

describe('HighlightRule discriminated union (PR1)', () => {
  it('num_bool_or has on-delta highlight after PR1 migration', () => {
    const meta = getMetric('num_bool_or')
    expect(meta.highlight).toEqual({ mode: 'on-delta' })
  })

  it('num_lin_max has on-delta highlight after PR1 migration', () => {
    const meta = getMetric('num_lin_max')
    expect(meta.highlight).toEqual({ mode: 'on-delta' })
  })

  it('unsatisfied_no_possible diverges from affected_campers', () => {
    const meta = getMetric('unsatisfied_no_possible')
    expect(meta.highlight).toEqual({
      mode: 'diverges-from',
      from: 'affected_campers',
    })
  })
})

describe('MetricGroup type accepts outcome_requests/outcome_campers/size/churn', () => {
  it('mp_request_rate is in outcome_requests group', () => {
    expect(getMetric('mp_request_rate').group).toBe('outcome_requests')
  })

  it('partitions outcome metrics by accounting unit', () => {
    const expectedRequests = [
      'mp_request_rate',
      'all_request_rate',
      'mp_requests_satisfied',
      'mp_requests_total',
      'all_requests_satisfied',
      'all_requests_total',
      'satisfied_request_count',
      'total_requests',
      'impossible_requests',
    ]
    const expectedCampers = [
      'mp_camper_rate',
      'all_camper_rate',
      'mp_campers_satisfied',
      'mp_campers_total',
      'all_campers_satisfied',
      'all_campers_total',
      'affected_campers',
      'unsatisfied_no_possible',
      'unsatisfied_material_parent_unmet',
      'unsatisfied_other_unmet',
    ]
    for (const k of expectedRequests) {
      expect(getMetric(k).group).toBe('outcome_requests')
    }
    for (const k of expectedCampers) {
      expect(getMetric(k).group).toBe('outcome_campers')
    }
  })

  it('total_persons is in size group', () => {
    expect(getMetric('total_persons').group).toBe('size')
  })

  it('assignments_changed is in churn group', () => {
    expect(getMetric('assignments_changed').group).toBe('churn')
  })
})

describe('Tier 2 plateau metrics (Stream 2, Phase 2)', () => {
  it('registers the six new scalars with valid groups', () => {
    expect(getMetric('lp_root_gap').group).toBe('quality')
    expect(getMetric('presolve_compression_ratio').group).toBe('model')
    expect(getMetric('presolve_booleans_pre').group).toBe('model')
    expect(getMetric('presolve_booleans_pre').parent).toBe('num_booleans')
    expect(getMetric('objective_plateau_time').group).toBe('timing')
    expect(getMetric('time_to_first_solution').group).toBe('timing')
    expect(getMetric('bound_gain_after_plateau').group).toBe('quality')
    // format / interpretation spot-checks — the fields most likely to be silently wrong
    expect(getMetric('presolve_compression_ratio').format).toBe('percent')
    expect(getMetric('presolve_compression_ratio').interpretation).toBe('lower-better')
    expect(getMetric('lp_root_gap').format).toBe('percent')
    expect(getMetric('objective_plateau_time').format).toBe('duration')
  })

  it('surfaces the comparable Tier 2 scalars in COMPARABLE_METRICS', () => {
    for (const k of [
      'lp_root_gap',
      'presolve_compression_ratio',
      'presolve_booleans_pre',
      'objective_plateau_time',
      'time_to_first_solution',
      'bound_gain_after_plateau',
    ]) {
      expect(COMPARABLE_METRICS).toContain(k)
    }
  })
})
