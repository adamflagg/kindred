export type MetricInterpretation = 'lower-better' | 'higher-better' | 'context'
export type MetricFormat = 'integer' | 'decimal' | 'percent' | 'duration'
export type MetricGroup =
  | 'timing'
  | 'quality'
  | 'search'
  | 'model'
  | 'context'
  | 'outcome'
  | 'size'
  | 'churn'

export type HighlightRule = { mode: 'on-delta' } | { mode: 'diverges-from'; from: string }

export interface MetricMeta {
  key: string
  label: string
  description: string
  interpretation: MetricInterpretation
  format: MetricFormat
  group: MetricGroup
  parent?: string // sub-rows render indented under this metric key
  highlight?: HighlightRule
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
    label: 'Model Booleans',
    description: 'Boolean variables in the solved model.',
    interpretation: 'context',
    format: 'integer',
    group: 'model',
  },
  num_integer_variables: {
    key: 'num_integer_variables',
    label: 'Model Integers',
    description: 'Integer (non-boolean) variables in the solved model.',
    interpretation: 'context',
    format: 'integer',
    group: 'model',
  },
  model_num_variables: {
    key: 'model_num_variables',
    label: 'Model variables',
    description: 'Total decision variables in the model.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
  },
  model_num_constraints: {
    key: 'model_num_constraints',
    label: 'Model constraints',
    description: 'Total constraints in the model.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
  },
  num_bool_or: {
    key: 'num_bool_or',
    label: 'bool_or constraints',
    description:
      'Disjunctive (bool_or) constraints in the model; cleanup signal — fewer = simpler.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
    parent: 'model_num_constraints',
    highlight: { mode: 'on-delta' },
  },
  num_linear: {
    key: 'num_linear',
    label: 'linear constraints',
    description: 'Linear constraints in the model.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
    parent: 'model_num_constraints',
  },
  num_bool_and: {
    key: 'num_bool_and',
    label: 'bool_and constraints',
    description: 'Conjunctive (bool_and) constraints in the model.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
    parent: 'model_num_constraints',
  },
  num_lin_max: {
    key: 'num_lin_max',
    label: 'lin_max constraints',
    description: 'Lin_max / lin_min constraints in the model; cleanup signal — fewer = simpler.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'model',
    parent: 'model_num_constraints',
    highlight: { mode: 'on-delta' },
  },
  mp_request_rate: {
    key: 'mp_request_rate',
    label: 'Optimized (MP req)',
    description:
      'Material-parent requests honored / MP requests total. 100% is the ideal outcome — every parent priority request satisfied.',
    interpretation: 'higher-better',
    format: 'percent',
    group: 'outcome',
  },
  mp_camper_rate: {
    key: 'mp_camper_rate',
    label: 'Acceptable (MP camper)',
    description:
      'Campers with ≥1 MP request satisfied / Campers with ≥1 MP request. 100% means every camper with a parent priority got at least one MP request honored.',
    interpretation: 'higher-better',
    format: 'percent',
    group: 'outcome',
  },
  all_request_rate: {
    key: 'all_request_rate',
    label: 'Request rate',
    description: 'All requests honored / all requests total, across every source bucket.',
    interpretation: 'higher-better',
    format: 'percent',
    group: 'outcome',
  },
  all_camper_rate: {
    key: 'all_camper_rate',
    label: 'Camper rate',
    description: 'Campers with ≥1 any-source request satisfied / campers with ≥1 request.',
    interpretation: 'higher-better',
    format: 'percent',
    group: 'outcome',
  },
  mp_requests_satisfied: {
    key: 'mp_requests_satisfied',
    label: 'MP req met',
    description: 'Number of material-parent requests the solver honored.',
    interpretation: 'higher-better',
    format: 'integer',
    group: 'outcome',
    parent: 'mp_request_rate',
  },
  mp_requests_total: {
    key: 'mp_requests_total',
    label: 'MP req total',
    description: 'Total resolved material-parent requests in scope this run.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
    parent: 'mp_request_rate',
  },
  mp_campers_satisfied: {
    key: 'mp_campers_satisfied',
    label: 'MP campers met',
    description: 'Campers with ≥1 material-parent request satisfied.',
    interpretation: 'higher-better',
    format: 'integer',
    group: 'outcome',
    parent: 'mp_camper_rate',
  },
  mp_campers_total: {
    key: 'mp_campers_total',
    label: 'MP campers total',
    description: 'Campers with ≥1 resolved material-parent request.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
    parent: 'mp_camper_rate',
  },
  all_campers_satisfied: {
    key: 'all_campers_satisfied',
    label: 'Campers met',
    description: 'Campers with ≥1 request of any source satisfied.',
    interpretation: 'higher-better',
    format: 'integer',
    group: 'outcome',
    parent: 'all_camper_rate',
  },
  all_campers_total: {
    key: 'all_campers_total',
    label: 'Campers total',
    description: 'Campers with ≥1 resolved request of any source.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
    parent: 'all_camper_rate',
  },
  satisfied_request_count: {
    key: 'satisfied_request_count',
    label: 'Req met',
    description: 'Total requests honored across all sources.',
    interpretation: 'higher-better',
    format: 'integer',
    group: 'outcome',
    parent: 'all_request_rate',
  },
  total_requests: {
    key: 'total_requests',
    label: 'Req total',
    description: 'Total resolved requests in scope this run, across all sources.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
    parent: 'all_request_rate',
  },
  impossible_requests: {
    key: 'impossible_requests',
    label: 'Impossible',
    description:
      'Requests that can never be satisfied (cross-session, requestee absent, etc.). Floor on unsatisfiability.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
  },
  affected_campers: {
    key: 'affected_campers',
    label: 'Affected campers',
    description: 'Campers with ≥1 impossible request — blast radius of the impossibility floor.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
    parent: 'impossible_requests',
  },
  unsatisfied_no_possible: {
    key: 'unsatisfied_no_possible',
    label: 'No-possible',
    description:
      'Campers with only impossible requests. Should equal affected_campers; divergence is a bug signal.',
    interpretation: 'context',
    format: 'integer',
    group: 'outcome',
    parent: 'impossible_requests',
    highlight: { mode: 'diverges-from', from: 'affected_campers' },
  },
  unsatisfied_material_parent_unmet: {
    key: 'unsatisfied_material_parent_unmet',
    label: 'Failed-all w/ MP-possible',
    description:
      'Campers who got zero requests satisfied AND had ≥1 possible MP request. The worst-case parent-priority failures.',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'outcome',
  },
  unsatisfied_other_unmet: {
    key: 'unsatisfied_other_unmet',
    label: 'Failed-all no MP',
    description:
      'Campers who got zero requests satisfied AND had only non-MP possible requests (STAFF / IMMATERIAL_PARENT).',
    interpretation: 'lower-better',
    format: 'integer',
    group: 'outcome',
  },
  total_persons: {
    key: 'total_persons',
    label: 'Persons',
    description: 'Campers in scope this run.',
    interpretation: 'context',
    format: 'integer',
    group: 'size',
  },
  total_bunks: {
    key: 'total_bunks',
    label: 'Bunks',
    description: 'Cabins in scope this run.',
    interpretation: 'context',
    format: 'integer',
    group: 'size',
  },
  num_workers: {
    key: 'num_workers',
    label: 'Workers',
    description: 'CP-SAT parallel worker count.',
    interpretation: 'context',
    format: 'integer',
    group: 'size',
  },
  time_budget_seconds: {
    key: 'time_budget_seconds',
    label: 'Budget',
    description: 'Time limit configured for this run.',
    interpretation: 'context',
    format: 'duration',
    group: 'size',
  },
  assignments_changed: {
    key: 'assignments_changed',
    label: 'Assignments changed',
    description:
      'Number of campers placed differently than the prior draft. 0 means the solver returned the same answer.',
    interpretation: 'context',
    format: 'integer',
    group: 'churn',
  },
  new_assignments: {
    key: 'new_assignments',
    label: 'New assignments',
    description: 'Number of campers receiving a placement this run (existing or new).',
    interpretation: 'context',
    format: 'integer',
    group: 'churn',
  },
  objective_value: {
    key: 'objective_value',
    label: 'Objective',
    description:
      'Raw weighted score from the solver. Higher = better, BUT only when constraint/objective weights match between compared runs. Different weights mechanically inflate or deflate this number — see config_snapshot.',
    interpretation: 'context',
    format: 'integer',
    group: 'quality',
  },
}

/** Subset rendered in pin-to-compare delta panel (numeric, comparable). */
export const COMPARABLE_METRICS: readonly string[] = [
  // outcome (PR1)
  'mp_request_rate',
  'mp_camper_rate',
  'mp_requests_satisfied',
  'mp_requests_total',
  'mp_campers_satisfied',
  'mp_campers_total',
  'all_request_rate',
  'all_camper_rate',
  'satisfied_request_count',
  'total_requests',
  'all_campers_satisfied',
  'all_campers_total',
  'impossible_requests',
  'affected_campers',
  'unsatisfied_no_possible',
  'unsatisfied_material_parent_unmet',
  'unsatisfied_other_unmet',
  // timing
  'walltime_seconds',
  'user_time_seconds',
  'deterministic_time',
  // quality
  'objective_value',
  'optimality_gap',
  'gap_integral',
  'best_objective_bound',
  'num_solutions_found',
  // churn (PR1)
  'assignments_changed',
  'new_assignments',
  // search
  'num_branches',
  'num_conflicts',
  // model
  'model_num_variables',
  'num_booleans',
  'num_integer_variables',
  'model_num_constraints',
  // model > constraint sub-types
  'num_linear',
  'num_bool_and',
  'num_bool_or',
  'num_lin_max',
  // size (PR1)
  'total_persons',
  'total_bunks',
  'num_workers',
  'time_budget_seconds',
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
