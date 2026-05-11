export type MetricInterpretation = 'lower-better' | 'higher-better' | 'context'
export type MetricFormat = 'integer' | 'decimal' | 'percent' | 'duration'
export type MetricGroup = 'timing' | 'quality' | 'search' | 'model' | 'context'

export interface MetricMeta {
  key: string
  label: string
  description: string
  interpretation: MetricInterpretation
  format: MetricFormat
  group: MetricGroup
}

export const METRIC_REGISTRY: Record<string, MetricMeta> = {
  walltime_seconds: {
    key: 'walltime_seconds',
    label: 'Wall time',
    description: 'Real seconds the solver ran.',
    interpretation: 'lower-better',
    format: 'duration',
    group: 'timing',
  },
  user_time_seconds: {
    key: 'user_time_seconds',
    label: 'User time',
    description: 'CPU time across workers; higher than walltime indicates parallel work.',
    interpretation: 'context',
    format: 'duration',
    group: 'timing',
  },
  deterministic_time: {
    key: 'deterministic_time',
    label: 'Det. work',
    description: 'Hardware-independent measure of solver work; comparable across machines.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'timing',
  },
  best_objective_bound: {
    key: 'best_objective_bound',
    label: 'Best bound',
    description: 'Proven lower (or upper) bound on the best possible objective.',
    interpretation: 'context',
    format: 'integer',
    group: 'quality',
  },
  optimality_gap: {
    key: 'optimality_gap',
    label: 'Gap',
    description: 'Distance between solution and proven best bound; 0% = OPTIMAL.',
    interpretation: 'lower-better',
    format: 'percent',
    group: 'quality',
  },
  gap_integral: {
    key: 'gap_integral',
    label: 'Convergence (∫gap)',
    description: 'Cumulative integral of the gap over time; lower = converged faster.',
    interpretation: 'lower-better',
    format: 'decimal',
    group: 'quality',
  },
  num_solutions_found: {
    key: 'num_solutions_found',
    label: 'Solutions',
    description: 'Intermediate solutions found before final answer; more = solver kept improving.',
    interpretation: 'higher-better',
    format: 'integer',
    group: 'quality',
  },
  num_branches: {
    key: 'num_branches',
    label: 'Branches',
    description: 'Search-tree branches explored; lower = tighter search.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'search',
  },
  num_conflicts: {
    key: 'num_conflicts',
    label: 'Conflicts',
    description: 'Search-tree backtracks; lower = fewer dead ends.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'search',
  },
  num_booleans: {
    key: 'num_booleans',
    label: 'Booleans',
    description: 'Boolean variables in the solved model.',
    interpretation: 'context',
    format: 'integer',
    group: 'model',
  },
  num_integer_variables: {
    key: 'num_integer_variables',
    label: 'Integers',
    description: 'Integer (non-boolean) variables in the solved model.',
    interpretation: 'context',
    format: 'integer',
    group: 'model',
  },
  model_num_variables: {
    key: 'model_num_variables',
    label: 'Variables',
    description: 'Total decision variables in the model.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
  },
  model_num_constraints: {
    key: 'model_num_constraints',
    label: 'Constraints',
    description: 'Total constraints in the model.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
  },
  num_bool_or: {
    key: 'num_bool_or',
    label: 'bool_or',
    description:
      'Disjunctive (bool_or) constraints in the model; cleanup signal — fewer = simpler.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
  },
}

/** Subset rendered in pin-to-compare delta panel (numeric, comparable). */
export const COMPARABLE_METRICS: readonly string[] = [
  'walltime_seconds',
  'deterministic_time',
  'optimality_gap',
  'gap_integral',
  'num_branches',
  'num_conflicts',
  'num_solutions_found',
  'model_num_variables',
  'model_num_constraints',
  'num_bool_or',
] as const

export function getMetric(key: string): MetricMeta {
  return (
    METRIC_REGISTRY[key] ?? {
      key,
      label: key,
      description: '',
      format: 'integer',
      interpretation: 'context',
      group: 'context',
    }
  )
}

export function formatMetric(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const meta = getMetric(key)
  switch (meta.format) {
    case 'percent':
      return `${(value * 100).toFixed(2)}%`
    case 'duration':
      return `${value.toFixed(1)}s`
    case 'integer':
      return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    case 'decimal':
      return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  }
}
