import { describe, expect, it } from 'vitest'

import { buildComparisonSummary } from './buildComparisonSummary'

import type { SolverRun } from '../../../hooks/useSolverRuns'

const runA: SolverRun = {
  id: 'rec_a',
  run_id: 'run_aaa',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: {
    status: 'FEASIBLE',
    walltime_seconds: 45.2,
    optimality_gap: 0.08,
    num_branches: 8421,
    objective_value: 100000,
    request_validation: {
      mp_requests_satisfied: 200,
      mp_requests_total: 300,
      mp_campers_satisfied: 100,
      mp_campers_total: 150,
      all_campers_satisfied: 140,
      all_campers_total: 180,
    },
    satisfied_request_count: 250,
    total_requests: 320,
  },
  details: {
    git_sha: 'aaa1111',
    source_label: '2 · CM',
    sweep_label: 'baseline',
  },
}

const runB: SolverRun = {
  id: 'rec_b',
  run_id: 'run_bbb',
  status: 'success',
  created: '2026-05-08T11:14:00Z',
  stats: {
    status: 'FEASIBLE',
    walltime_seconds: 23.1,
    optimality_gap: 0.04,
    num_branches: 3210,
    objective_value: 120000,
    request_validation: {
      mp_requests_satisfied: 250,
      mp_requests_total: 300,
      mp_campers_satisfied: 120,
      mp_campers_total: 150,
      all_campers_satisfied: 160,
      all_campers_total: 180,
    },
    satisfied_request_count: 280,
    total_requests: 320,
  },
  details: {
    git_sha: 'bbb2222',
    source_label: '2 · CM',
    sweep_label: 'after-tuning',
  },
}

describe('buildComparisonSummary', () => {
  it('emits a discriminating `kind` field and the two run summaries with titles', () => {
    const out = buildComparisonSummary(runA, runB)
    expect(out.kind).toBe('solver_run_comparison')
    expect(out.run_a.run_id).toBe('run_aaa')
    expect(out.run_b.run_id).toBe('run_bbb')
    expect(out.run_a.title).toMatch(/baseline/)
    expect(out.run_b.title).toMatch(/after-tuning/)
  })

  it('computes deltas with a/b/delta_raw/delta_formatted/direction per metric', () => {
    const out = buildComparisonSummary(runA, runB)
    const wall = out.deltas['walltime_seconds']
    expect(wall).toBeDefined()
    expect(wall?.a).toBe('45.2s')
    expect(wall?.b).toBe('23.1s')
    expect(wall?.delta_raw).toBeCloseTo(-22.1, 1)
    expect(wall?.delta_formatted).toMatch(/-22\.1s/)
    // walltime is lower-better; B is faster → improved
    expect(wall?.direction).toBe('improved')
  })

  it('marks a regression when a lower-better metric increases', () => {
    const slower: SolverRun = {
      ...runB,
      stats: { ...runB.stats, walltime_seconds: 60.0 },
    }
    const out = buildComparisonSummary(runA, slower)
    const wall = out.deltas['walltime_seconds']
    expect(wall?.direction).toBe('regressed')
  })

  it('marks higher-better improvements correctly (mp_request_rate going up)', () => {
    const out = buildComparisonSummary(runA, runB)
    // a=200/300=66.67%, b=250/300=83.33% → +16.67 → improved (higher-better)
    expect(out.deltas['mp_request_rate']?.direction).toBe('improved')
  })

  it('marks unchanged when delta is exactly zero', () => {
    const out = buildComparisonSummary(runA, runA)
    expect(out.deltas['walltime_seconds']?.direction).toBe('unchanged')
    expect(out.deltas['walltime_seconds']?.delta_raw).toBe(0)
  })

  it('marks missing when either side has no value', () => {
    const partial: SolverRun = { ...runA, stats: { status: 'FEASIBLE' } }
    const out = buildComparisonSummary(partial, runB)
    expect(out.deltas['walltime_seconds']?.direction).toBe('missing')
    expect(out.deltas['walltime_seconds']?.a).toBeNull()
  })

  it('omits the deltas entry entirely when a metric is absent on BOTH runs', () => {
    const minimalA: SolverRun = { ...runA, stats: { status: 'FEASIBLE' } }
    const minimalB: SolverRun = { ...runB, stats: { status: 'FEASIBLE' } }
    const out = buildComparisonSummary(minimalA, minimalB)
    expect(out.deltas['walltime_seconds']).toBeUndefined()
  })

  it('treats objective_value as higher-better when config snapshots match', () => {
    const aCfg: SolverRun = { ...runA, details: { ...runA.details, config_snapshot: { x: '1' } } }
    const bCfg: SolverRun = { ...runB, details: { ...runB.details, config_snapshot: { x: '1' } } }
    const out = buildComparisonSummary(aCfg, bCfg)
    // a=100000, b=120000 → +20000 → improved (higher-better when configs match)
    expect(out.deltas['objective_value']?.direction).toBe('improved')
  })
})
