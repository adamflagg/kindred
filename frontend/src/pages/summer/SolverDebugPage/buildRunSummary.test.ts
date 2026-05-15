import { describe, expect, it } from 'vitest'

import { buildRunSummary, hasNonEmptyBuckets } from './buildRunSummary'

import type { SolverRun } from '../../../hooks/useSolverRuns'

const fullRun: SolverRun = {
  id: 'rec_a',
  run_id: 'run_abc',
  status: 'success',
  created: '2026-05-12T12:00:00Z',
  stats: {
    status: 'FEASIBLE',
    walltime_seconds: 600.12,
    user_time_seconds: 600.13,
    deterministic_time: 393,
    time_budget_seconds: 600,
    num_workers: 8,
    best_objective_bound: 171260,
    optimality_gap: 0.0476,
    gap_integral: 3547.6,
    num_solutions_found: 1,
    num_branches: 2418,
    num_conflicts: 0,
    num_booleans: 5561,
    num_integer_variables: 2456,
    model_num_variables: 11657,
    model_num_constraints: 23644,
    constraint_type_breakdown: { linear: 21922, bool_and: 1022, bool_or: 684, lin_max: 16 },
    solution_info: 'graph_arc_lns (d=4.32e-01 s=2332 t=0.10 p=0.49 stall=91 h=base)',
    objective_value: 163473,
    total_persons: 193,
    total_bunks: 17,
    satisfied_request_count: 405,
    total_requests: 504,
    assignments_changed: 0,
    new_assignments: 193,
    request_validation: {
      mp_requests_satisfied: 281,
      mp_requests_total: 326,
      mp_campers_satisfied: 157,
      mp_campers_total: 164,
      all_campers_satisfied: 174,
      all_campers_total: 188,
      all_requests_satisfied: 401,
      all_requests_total: 500,
      affected_campers: 4,
      impossible_requests: 4,
      unsatisfied_no_possible: 0,
      unsatisfied_material_parent_unmet: 6,
      unsatisfied_other_unmet: 8,
    },
  },
  details: {
    git_sha: 'a85c6acfb7e77c59e13b6dd625cc673c6645e2dd',
    source_label: '2 · CM',
    sweep_label: 'post 1364-287k MSO penalty',
    config_snapshot: {
      'constraint.grade_ratio.max_percentage': '67',
      'constraint.must_satisfy_one.penalty': '287600',
    },
  },
}

describe('buildRunSummary', () => {
  it('includes top-level run_id and a context block', () => {
    const out = buildRunSummary(fullRun)
    expect(out.run_id).toBe('run_abc')
    expect(out.context).toEqual({
      source: '2 · CM',
      status: 'FEASIBLE',
      git_sha: 'a85c6acfb7e77c59e13b6dd625cc673c6645e2dd',
      sweep_label: 'post 1364-287k MSO penalty',
    })
  })

  it('formats percent metrics as "NN.NN%" strings', () => {
    const out = buildRunSummary(fullRun)
    expect(out.outcome_requests?.['mp_request_rate']).toBe('86.20%')
    expect(out.outcome_requests?.['all_request_rate']).toBe('80.20%')
    expect(out.outcome_campers?.['mp_camper_rate']).toBe('95.73%')
    expect(out.outcome_campers?.['all_camper_rate']).toBe('92.55%')
    expect(out.quality?.['optimality_gap']).toBe('4.76%')
  })

  it('formats duration metrics as "N.Ns" strings', () => {
    const out = buildRunSummary(fullRun)
    expect(out.timing?.['walltime_seconds']).toBe('600.1s')
    expect(out.timing?.['user_time_seconds']).toBe('600.1s')
    expect(out.size?.['time_budget_seconds']).toBe('600.0s')
  })

  it('keeps integer/decimal metrics as raw numbers', () => {
    const out = buildRunSummary(fullRun)
    expect(out.outcome_requests?.['mp_requests_satisfied']).toBe(281)
    expect(out.outcome_requests?.['mp_requests_total']).toBe(326)
    expect(out.outcome_requests?.['satisfied_request_count']).toBe(405)
    expect(out.timing?.['deterministic_time']).toBe(393)
    expect(out.quality?.['objective_value']).toBe(163473)
    expect(out.quality?.['gap_integral']).toBe(3547.6)
    expect(out.search?.['num_branches']).toBe(2418)
    expect(out.model?.['model_num_variables']).toBe(11657)
  })

  it('omits keys whose value is null or undefined', () => {
    const sparse: SolverRun = {
      id: 'rec_b',
      run_id: 'run_xyz',
      status: 'success',
      created: '2026-05-12T12:00:00Z',
      stats: {
        status: 'FEASIBLE',
        walltime_seconds: 12.3,
      },
      details: {},
    }
    const out = buildRunSummary(sparse)
    expect(out.timing).toEqual({ walltime_seconds: '12.3s' })
    expect(out.model).toBeUndefined()
    expect(out.context).toEqual({ status: 'FEASIBLE' })
  })

  it('falls back to run.status when stats.status is absent (in-flight run)', () => {
    const inFlight: SolverRun = {
      id: 'rec_inflight',
      run_id: 'run_inflight',
      status: 'running',
      created: '2026-05-12T12:00:00Z',
      stats: {},
      details: {},
    }
    const out = buildRunSummary(inFlight)
    expect(out.context.status).toBe('running')
  })

  it('preserves group order: context, outcome groups, size, timing, quality, churn, search, model', () => {
    const out = buildRunSummary(fullRun)
    expect(Object.keys(out)).toEqual([
      'run_id',
      'context',
      'outcome_requests',
      'outcome_campers',
      'size',
      'timing',
      'quality',
      'churn',
      'search',
      'model',
      'solution_strategy',
      'constraint_type_breakdown',
      'config_snapshot',
    ])
  })

  describe('Tier 1 observability dict fields (issue #1388)', () => {
    const withTier1: SolverRun = {
      ...fullRun,
      stats: {
        ...fullRun.stats,
        soft_constraints_by_module: { must_satisfy: 167, grade_ratio: 96 },
        request_density_histogram_by_bucket: {
          material_parent: { '1': 30, '2': 50 },
          immaterial_parent: { '1': 8 },
          staff: {},
        },
        request_validation: {
          ...(fullRun.stats?.request_validation ?? {}),
          impossible_by_reason: {
            material_parent: { target_not_in_solver: 2, cross_session: 1 },
            immaterial_parent: {},
            staff: { malformed: 1 },
          },
        },
      },
    }

    it('includes soft_constraints_by_module when non-empty', () => {
      const out = buildRunSummary(withTier1)
      expect(out.soft_constraints_by_module).toEqual({ must_satisfy: 167, grade_ratio: 96 })
    })

    it('includes request_density_histogram_by_bucket when a bucket is non-empty', () => {
      const out = buildRunSummary(withTier1)
      expect(out.request_density_histogram_by_bucket).toEqual({
        material_parent: { '1': 30, '2': 50 },
        immaterial_parent: { '1': 8 },
        staff: {},
      })
    })

    it('includes impossible_request_breakdown when a bucket is non-empty', () => {
      const out = buildRunSummary(withTier1)
      expect(out.impossible_request_breakdown).toEqual({
        material_parent: { target_not_in_solver: 2, cross_session: 1 },
        immaterial_parent: {},
        staff: { malformed: 1 },
      })
    })

    it('omits dict fields when every bucket is empty', () => {
      const empty: SolverRun = {
        ...fullRun,
        stats: {
          ...fullRun.stats,
          soft_constraints_by_module: {},
          request_density_histogram_by_bucket: {
            material_parent: {},
            immaterial_parent: {},
            staff: {},
          },
          request_validation: {
            ...(fullRun.stats?.request_validation ?? {}),
            impossible_by_reason: {
              material_parent: {},
              immaterial_parent: {},
              staff: {},
            },
          },
        },
      }
      const out = buildRunSummary(empty)
      expect(out.soft_constraints_by_module).toBeUndefined()
      expect(out.request_density_histogram_by_bucket).toBeUndefined()
      expect(out.impossible_request_breakdown).toBeUndefined()
    })

    it('serializes Tier 1 dict fields after constraint_type_breakdown, before config_snapshot', () => {
      const out = buildRunSummary(withTier1)
      expect(Object.keys(out)).toEqual([
        'run_id',
        'context',
        'outcome_requests',
        'outcome_campers',
        'size',
        'timing',
        'quality',
        'churn',
        'search',
        'model',
        'solution_strategy',
        'constraint_type_breakdown',
        'soft_constraints_by_module',
        'request_density_histogram_by_bucket',
        'impossible_request_breakdown',
        'config_snapshot',
      ])
    })
  })

  describe('hasNonEmptyBuckets', () => {
    it('returns false when every bucket is empty', () => {
      expect(hasNonEmptyBuckets({ material_parent: {}, immaterial_parent: {}, staff: {} })).toBe(
        false
      )
    })

    it('returns true when at least one bucket has an entry', () => {
      expect(
        hasNonEmptyBuckets({ material_parent: {}, immaterial_parent: { '1': 8 }, staff: {} })
      ).toBe(true)
    })

    it('returns false for an empty dict', () => {
      expect(hasNonEmptyBuckets({})).toBe(false)
    })
  })

  it('includes solution_strategy when solution_info is set, omits otherwise', () => {
    const out = buildRunSummary(fullRun)
    expect(out.solution_strategy).toBe(
      'graph_arc_lns (d=4.32e-01 s=2332 t=0.10 p=0.49 stall=91 h=base)'
    )

    const { solution_info: _omit, ...statsNoInfo } = fullRun.stats ?? {}
    void _omit
    const noInfo: SolverRun = { ...fullRun, stats: statsNoInfo }
    const outNoInfo = buildRunSummary(noInfo)
    expect(outNoInfo.solution_strategy).toBeUndefined()
  })

  it('passes constraint_type_breakdown through as raw numbers', () => {
    const out = buildRunSummary(fullRun)
    expect(out.constraint_type_breakdown).toEqual({
      linear: 21922,
      bool_and: 1022,
      bool_or: 684,
      lin_max: 16,
    })
  })

  it('passes config_snapshot through unchanged', () => {
    const out = buildRunSummary(fullRun)
    expect(out.config_snapshot).toEqual({
      'constraint.grade_ratio.max_percentage': '67',
      'constraint.must_satisfy_one.penalty': '287600',
    })
  })

  it('omits constraint_type_breakdown / config_snapshot when absent', () => {
    const minimal: SolverRun = {
      id: 'rec_c',
      run_id: 'run_min',
      status: 'success',
      created: '2026-05-12T12:00:00Z',
      stats: { status: 'FEASIBLE' },
      details: {},
    }
    const out = buildRunSummary(minimal)
    expect(out.constraint_type_breakdown).toBeUndefined()
    expect(out.config_snapshot).toBeUndefined()
    expect(out.solution_strategy).toBeUndefined()
  })

  it('formats integer constraint sub-rows pulled from constraint_type_breakdown', () => {
    const out = buildRunSummary(fullRun)
    expect(out.model?.['num_linear']).toBe(21922)
    expect(out.model?.['num_bool_and']).toBe(1022)
    expect(out.model?.['num_bool_or']).toBe(684)
    expect(out.model?.['num_lin_max']).toBe(16)
  })
})
