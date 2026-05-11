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
] as const

export const DEFAULT_VISIBLE_COLUMNS: string[] = [
  'source',
  'budget',
  'status',
  'sha',
  'sweep',
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
