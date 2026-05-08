import { useState } from 'react'

import type { SolverRunsFilters } from '../../../utils/queryKeys'

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

export interface SolverFiltersBarProps {
  filters: SolverRunsFilters
  onFiltersChange: (next: SolverRunsFilters) => void
  visibleColumns: string[]
  onColumnsChange: (next: string[]) => void
}

export function SolverFiltersBar({
  filters,
  onFiltersChange,
  visibleColumns,
  onColumnsChange,
}: SolverFiltersBarProps) {
  const [showPicker, setShowPicker] = useState(false)
  const groups = Array.from(new Set(ALL_COLUMNS.map((c) => c.group)))

  const toggleColumn = (key: string) =>
    onColumnsChange(
      visibleColumns.includes(key)
        ? visibleColumns.filter((k) => k !== key)
        : [...visibleColumns, key]
    )

  return (
    <div className="relative mb-4 flex items-center gap-3 text-sm">
      <select
        aria-label="sessions"
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5"
        value={filters.sessionId ?? ''}
        onChange={(e) => {
          const next: SolverRunsFilters = { ...filters }
          if (e.target.value) {
            next.sessionId = Number(e.target.value)
          } else {
            delete next.sessionId
          }
          onFiltersChange(next)
        }}
      >
        <option value="">All sessions</option>
        <option value="1">Session 1</option>
        <option value="2">Session 2</option>
        <option value="3">Session 3</option>
        <option value="4">Session 4</option>
      </select>
      <label className="flex items-center gap-1.5 text-gray-600">
        <input
          type="checkbox"
          checked={filters.hideFailed ?? false}
          onChange={(e) => onFiltersChange({ ...filters, hideFailed: e.target.checked })}
        />
        Hide failed
      </label>
      <div className="relative ml-auto flex items-center gap-2">
        <button
          onClick={() => setShowPicker((v) => !v)}
          className="rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:text-gray-900"
        >
          ⚙ Columns ({visibleColumns.length}/{ALL_COLUMNS.length})
        </button>
        {showPicker ? (
          <div className="absolute top-[calc(100%+6px)] right-0 z-20 w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            <div className="mb-2 text-xs font-semibold">Configure columns</div>
            <div className="mb-3 flex gap-1.5">
              <button
                onClick={() => onColumnsChange(COMPACT_COLUMNS)}
                className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
              >
                Compact
              </button>
              <button
                onClick={() => onColumnsChange(DEFAULT_VISIBLE_COLUMNS)}
                className="bg-forest-500 rounded px-2 py-1 text-xs text-white"
              >
                Default
              </button>
              <button
                onClick={() => onColumnsChange(ALL_COLUMNS_KEYS)}
                className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
              >
                All
              </button>
            </div>
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    {group}
                  </div>
                  {ALL_COLUMNS.filter((c) => c.group === group).map((c) => (
                    <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(c.key)}
                        onChange={() => toggleColumn(c.key)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
