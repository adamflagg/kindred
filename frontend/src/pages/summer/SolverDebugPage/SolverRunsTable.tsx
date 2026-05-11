import { Zap } from 'lucide-react'
import { Fragment } from 'react'

import { REPO_URL } from '../../../constants/repo'

import { formatMetric, getMetric } from './metricRegistry'

import type { SolverRun } from '../../../hooks/useSolverRuns'

interface SolverRunsTableProps {
  runs: SolverRun[]
  visibleColumns: string[]
  pinnedRunIds: string[] // index 0 = slot A, index 1 = slot B
  onTogglePin: (runId: string) => void
  onRowClick: (run: SolverRun) => void
  hasNextPage?: boolean
  fetchNextPage?: () => void
  totalItems?: number
}

function effectiveStatus(run: SolverRun): string | undefined {
  // OR-Tools terminal status wins when present; otherwise show PB lifecycle.
  return run.stats?.status ?? run.status
}

function effectiveStatusLabel(status: string | undefined): string {
  if (!status) return '—'
  if (status === 'started' || status === 'running') return 'running'
  if (status === 'pending') return 'pending'
  return status // OR-Tools statuses already uppercase
}

function statusChipClass(status?: string): string {
  switch (status) {
    case 'OPTIMAL':
      return 'bg-green-100 text-green-800'
    case 'FEASIBLE':
      return 'bg-yellow-100 text-yellow-800'
    case 'INFEASIBLE':
    case 'MODEL_INVALID':
      return 'bg-red-100 text-red-800'
    case 'pending':
      return 'bg-gray-200 text-gray-700'
    case 'started':
    case 'running':
      return 'bg-blue-100 text-blue-800 animate-pulse'
    case 'success':
      return 'bg-green-100 text-green-800'
    case 'failed':
    case 'error':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export function SolverRunsTable({
  runs,
  visibleColumns,
  pinnedRunIds,
  onTogglePin,
  onRowClick,
  hasNextPage,
  fetchNextPage,
  totalItems,
}: SolverRunsTableProps) {
  const pinSlot = (id: string): 'A' | 'B' | null => {
    const idx = pinnedRunIds.indexOf(id)
    return idx === 0 ? 'A' : idx === 1 ? 'B' : null
  }

  const showCol = (k: string) => visibleColumns.includes(k)

  return (
    <div className="shadow-lodge overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead className="border-b border-gray-200 bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
          <tr>
            <th className="w-8 px-3 py-2.5 text-center">📌</th>
            <th className="px-3 py-2.5 text-left font-medium">Time</th>
            {showCol('source') && <th className="px-3 py-2.5 text-left font-medium">Source</th>}
            {showCol('budget') && <th className="px-3 py-2.5 text-left font-medium">Budget</th>}
            {showCol('status') && <th className="px-3 py-2.5 text-left font-medium">Status</th>}
            {showCol('walltime_seconds') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('walltime_seconds').description}
              >
                Wall
              </th>
            )}
            {showCol('deterministic_time') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('deterministic_time').description}
              >
                Det.work
              </th>
            )}
            {showCol('user_time_seconds') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('user_time_seconds').description}
              >
                User
              </th>
            )}
            {showCol('optimality_gap') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('optimality_gap').description}
              >
                Gap
              </th>
            )}
            {showCol('gap_integral') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('gap_integral').description}
              >
                ∫gap
              </th>
            )}
            {showCol('num_solutions_found') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('num_solutions_found').description}
              >
                Sol.
              </th>
            )}
            {showCol('num_branches') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('num_branches').description}
              >
                Branches
              </th>
            )}
            {showCol('num_conflicts') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('num_conflicts').description}
              >
                Confl.
              </th>
            )}
            {showCol('model_num_variables_constraints') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={`${getMetric('model_num_variables').description} / ${getMetric('model_num_constraints').description}`}
              >
                Vars / Cons
              </th>
            )}
            {showCol('num_booleans') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('num_booleans').description}
              >
                Booleans
              </th>
            )}
            {showCol('num_integer_variables') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('num_integer_variables').description}
              >
                Integers
              </th>
            )}
            {showCol('num_bool_or') && (
              <th
                className="px-3 py-2.5 text-right font-medium"
                title={getMetric('num_bool_or').description}
              >
                bool_or
              </th>
            )}
            {showCol('sha') && <th className="px-3 py-2.5 text-left font-medium">SHA</th>}
            {showCol('sweep') && <th className="px-3 py-2.5 text-left font-medium">Sweep</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {runs.map((run, idx) => {
            const slot = pinSlot(run.id)
            const sha = run.details?.git_sha
            const prevSha = idx > 0 ? runs[idx - 1]?.details?.git_sha : undefined
            const showDivider = idx > 0 && sha !== prevSha
            // colspan = pin col + time col + each visible column
            const colSpan = 2 + visibleColumns.length
            return (
              <Fragment key={run.id}>
                {showDivider ? (
                  <tr data-sha-divider className="bg-gray-50/60">
                    <td
                      colSpan={colSpan}
                      className="px-5 py-1.5 text-center text-[11px] tracking-wide text-gray-500"
                    >
                      — {sha ? sha.slice(0, 7) : 'unknown'} —
                    </td>
                  </tr>
                ) : null}
                <tr
                  className={`hover:bg-forest-50/30 cursor-pointer ${
                    slot === 'A' ? 'bg-blue-50/40' : slot === 'B' ? 'bg-orange-50/40' : ''
                  }`}
                  onClick={() => onRowClick(run)}
                >
                  <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      aria-label={slot ? `Pin slot ${slot}` : `Pin run ${run.run_id}`}
                      onClick={() => onTogglePin(run.id)}
                      className="text-xs"
                    >
                      {slot === 'A' ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
                      ) : slot === 'B' ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-orange-700" />
                      ) : (
                        <span className="text-gray-300">○</span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {run.created.slice(5, 16).replace('T', ' ')}
                  </td>
                  {showCol('source') && (
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                      {run.details?.source_label ?? '—'}
                    </td>
                  )}
                  {showCol('budget') && (
                    <td className="px-3 py-2 text-gray-600">
                      {run.stats?.time_budget_seconds != null
                        ? `${run.stats.time_budget_seconds}s`
                        : '—'}
                    </td>
                  )}
                  {showCol('status') && (
                    <td className="px-3 py-2">
                      {(() => {
                        const status = effectiveStatus(run)
                        if (!status) return <span className="text-gray-400">—</span>
                        return (
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${statusChipClass(status)}`}
                          >
                            {effectiveStatusLabel(status)}
                          </span>
                        )
                      })()}
                    </td>
                  )}
                  {showCol('walltime_seconds') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('walltime_seconds', run.stats?.walltime_seconds)}
                    </td>
                  )}
                  {showCol('deterministic_time') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('deterministic_time', run.stats?.deterministic_time)}
                    </td>
                  )}
                  {showCol('user_time_seconds') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('user_time_seconds', run.stats?.user_time_seconds)}
                    </td>
                  )}
                  {showCol('optimality_gap') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('optimality_gap', run.stats?.optimality_gap)}
                    </td>
                  )}
                  {showCol('gap_integral') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('gap_integral', run.stats?.gap_integral)}
                    </td>
                  )}
                  {showCol('num_solutions_found') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('num_solutions_found', run.stats?.num_solutions_found)}
                    </td>
                  )}
                  {showCol('num_branches') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('num_branches', run.stats?.num_branches)}
                    </td>
                  )}
                  {showCol('num_conflicts') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('num_conflicts', run.stats?.num_conflicts)}
                    </td>
                  )}
                  {showCol('model_num_variables_constraints') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('model_num_variables', run.stats?.model_num_variables)} /{' '}
                      {formatMetric('model_num_constraints', run.stats?.model_num_constraints)}
                    </td>
                  )}
                  {showCol('num_booleans') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('num_booleans', run.stats?.num_booleans)}
                    </td>
                  )}
                  {showCol('num_integer_variables') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric('num_integer_variables', run.stats?.num_integer_variables)}
                    </td>
                  )}
                  {showCol('num_bool_or') && (
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatMetric(
                        'num_bool_or',
                        run.stats?.constraint_type_breakdown?.['bool_or'] ?? null
                      )}
                    </td>
                  )}
                  {showCol('sha') && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {sha ? (
                        <a
                          className="text-xs text-blue-600 hover:underline"
                          href={`${REPO_URL}/commit/${sha}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {sha.slice(0, 7)} ↗
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  {showCol('sweep') && (
                    <td className="px-3 py-2">
                      {run.details?.sweep_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-[10px] text-purple-800">
                          <Zap className="h-3 w-3" />{' '}
                          {run.details.sweep_label ?? run.details.sweep_id.slice(0, 8)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">— manual</span>
                      )}
                    </td>
                  )}
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {/* Footer: legend + Load more */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-3 text-xs text-gray-500">
        <span>
          Showing {runs.length} of {totalItems ?? runs.length} runs &nbsp;·&nbsp;
          <span className="inline-flex items-center gap-0.5 rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800">
            <Zap className="h-3 w-3" /> label
          </span>{' '}
          = part of a multi-budget sweep · &quot;manual&quot; = single ad-hoc run
        </span>
        {hasNextPage && fetchNextPage && (
          <button
            onClick={fetchNextPage}
            className="font-medium text-gray-700 hover:text-gray-900"
            type="button"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  )
}
