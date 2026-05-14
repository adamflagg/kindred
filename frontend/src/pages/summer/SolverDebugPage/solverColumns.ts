// Column definitions for SolverDebugPage table + filters bar.
// Extracted from SolverFiltersBar.tsx so the component file only exports React
// components (required by the react-refresh/only-export-components ESLint rule).

export const ALL_COLUMNS = [
  { key: 'source', label: 'Source', group: 'Identification' },
  { key: 'budget', label: 'Budget', group: 'Identification' },
  { key: 'status', label: 'Status', group: 'Identification' },
  { key: 'sha', label: 'SHA', group: 'Identification' },
  { key: 'sweep', label: 'Sweep', group: 'Identification' },
  { key: 'walltime_seconds', label: 'Wall time', group: 'Timing' },
  { key: 'deterministic_time', label: 'Det. work', group: 'Timing' },
  { key: 'user_time_seconds', label: 'User time', group: 'Timing' },
  { key: 'optimality_gap', label: 'Gap', group: 'Quality' },
  { key: 'gap_integral', label: 'Convergence', group: 'Quality' },
  { key: 'num_solutions_found', label: 'Solutions', group: 'Quality' },
  { key: 'num_branches', label: 'Branches', group: 'Search' },
  { key: 'num_conflicts', label: 'Conflicts', group: 'Search' },
  { key: 'model_num_variables_constraints', label: 'Vars / Cons', group: 'Model' },
  { key: 'num_booleans', label: 'Booleans', group: 'Model' },
  { key: 'num_integer_variables', label: 'Integers', group: 'Model' },
  { key: 'num_bool_or', label: 'bool_or', group: 'Model' },
  // PR1: outcome group
  { key: 'mp_request_rate', label: 'Optimized', group: 'Outcome' },
  { key: 'mp_camper_rate', label: 'Acceptable', group: 'Outcome' },
  { key: 'all_request_rate', label: 'Request rate', group: 'Outcome' },
  { key: 'all_camper_rate', label: 'Camper rate', group: 'Outcome' },
  { key: 'satisfied_request_count', label: 'Req met', group: 'Outcome' },
  { key: 'total_requests', label: 'Req total', group: 'Outcome' },
  { key: 'impossible_requests', label: 'Impossible', group: 'Outcome' },
  { key: 'affected_campers', label: 'Affected', group: 'Outcome' },
  // PR1: size group
  { key: 'total_persons', label: 'Persons', group: 'Size' },
  { key: 'total_bunks', label: 'Bunks', group: 'Size' },
  { key: 'num_workers', label: 'Workers', group: 'Size' },
  // PR1: churn group
  { key: 'assignments_changed', label: 'Δ assignments', group: 'Churn' },
  { key: 'new_assignments', label: 'New', group: 'Churn' },
  // PR1: quality additions
  { key: 'objective_value', label: 'Objective', group: 'Quality' },
  // Tier 2 plateau metrics (Stream 2, Phase 2)
  { key: 'lp_root_gap', label: 'LP root gap', group: 'Quality' },
  { key: 'bound_gain_after_plateau', label: 'Bound gain', group: 'Quality' },
  { key: 'objective_plateau_time', label: 'Plateau onset', group: 'Timing' },
  { key: 'time_to_first_solution', label: 'Time to 1st', group: 'Timing' },
  { key: 'presolve_compression_ratio', label: 'Presolve compression', group: 'Model' },
  // presolve_booleans_pre is intentionally not a column — it renders as a drill-down
  // sub-row under num_booleans (see its `parent` in metricRegistry.ts).
] as const

export const DEFAULT_VISIBLE_COLUMNS: string[] = [
  'source',
  'budget',
  'status',
  'sha',
  'sweep',
  'mp_request_rate', // PR1: headline outcome
  'mp_camper_rate', // PR1: headline outcome
  'walltime_seconds',
  'deterministic_time',
  'optimality_gap',
  'num_branches',
  'num_conflicts',
  'model_num_variables_constraints',
]

export const COMPACT_COLUMNS: string[] = [
  'source',
  'budget',
  'status',
  'walltime_seconds',
  'optimality_gap',
  'sha',
]

export const ALL_COLUMNS_KEYS: string[] = ALL_COLUMNS.map((c) => c.key)
