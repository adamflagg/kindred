import { useQuery } from '@tanstack/react-query'

import { pb } from '../lib/pocketbase'
import { queryKeys, type SolverRunsFilters } from '../utils/queryKeys'

export interface SolverRunStats {
  status?: string
  status_code?: number
  walltime_seconds?: number | null
  user_time_seconds?: number | null
  deterministic_time?: number | null
  time_budget_seconds?: number
  num_workers?: number
  best_objective_bound?: number | null
  optimality_gap?: number | null
  gap_integral?: number | null
  num_solutions_found?: number | null
  solution_info?: string | null
  num_branches?: number
  num_conflicts?: number
  num_booleans?: number
  num_integer_variables?: number | null
  model_num_variables?: number
  model_num_constraints?: number
  constraint_type_breakdown?: Record<string, number>
  objective_value?: number | null
}

export interface SolverRunDetails {
  git_sha?: string
  config_snapshot?: Record<string, string>
  source_label?: string
  source_kind?: 'production' | 'scenario'
  scenario_id_at_run?: string | null
  session_attendee_count?: number
  sweep_id?: string | null
  sweep_label?: string | null
  time_limit_seconds?: number
}

export interface SolverRun {
  id: string
  run_id: string
  status: string
  session_id?: number
  started_at?: string
  completed_at?: string
  created: string
  stats?: SolverRunStats
  details?: SolverRunDetails
  error?: { message?: string } | null
}

interface RawSolverRunRecord {
  id: string
  run_id: string
  status: string
  created: string
  session_id?: number | null
  started_at?: string | null
  completed_at?: string | null
  stats?: string | null
  details?: string | null
  error?: string | null
}

function safeJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function parseRecord(rec: RawSolverRunRecord): SolverRun {
  const out: SolverRun = {
    id: rec.id,
    run_id: rec.run_id,
    status: rec.status,
    created: rec.created,
    error: safeJson<{ message?: string }>(rec.error) ?? null,
  }
  if (typeof rec.session_id === 'number') out.session_id = rec.session_id
  if (typeof rec.started_at === 'string') out.started_at = rec.started_at
  if (typeof rec.completed_at === 'string') out.completed_at = rec.completed_at
  const stats = safeJson<SolverRunStats>(rec.stats)
  if (stats) out.stats = stats
  const details = safeJson<SolverRunDetails>(rec.details)
  if (details) out.details = details
  return out
}

export interface UseSolverRunsOptions {
  /**
   * Polling interval in ms. Pass `false` (default) to disable polling.
   * Callers should opt-in only while a sweep is in flight to avoid burning
   * resources on an idle tab.
   */
  pollMs?: number | false
}

export function useSolverRuns(filters: SolverRunsFilters, options?: UseSolverRunsOptions) {
  const pollMs = options?.pollMs ?? false
  return useQuery({
    queryKey: queryKeys.solverRuns(filters),
    queryFn: async () => {
      const filterParts: string[] = []
      const filterParams: Record<string, unknown> = {}
      if (filters.sessionId !== undefined) {
        filterParts.push('session_id = {:sessionId}')
        filterParams['sessionId'] = filters.sessionId
      }
      if (filters.hideFailed) {
        filterParts.push('status != "failed" && status != "error"')
      }
      if (filters.since) {
        filterParts.push('created >= {:since}')
        filterParams['since'] = filters.since
      }
      const filterStr = filterParts.length ? pb.filter(filterParts.join(' && '), filterParams) : ''

      const result = await pb.collection('solver_runs').getList(1, 100, {
        filter: filterStr,
        sort: '-created',
      })

      return {
        items: (result.items as unknown as RawSolverRunRecord[]).map(parseRecord),
        totalItems: result.totalItems,
      }
    },
    staleTime: 5_000,
    refetchInterval: pollMs === false ? false : pollMs,
    refetchIntervalInBackground: false,
  })
}
