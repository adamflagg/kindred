import { useInfiniteQuery } from '@tanstack/react-query'

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
  // Tier 1 observability (Stream 2, issue #1380)
  num_reified_linear?: number
  max_linear_coefficient?: number
  soft_constraints_by_module?: Record<string, number>
  request_density_histogram?: Record<string, number>
  objective_value?: number | null
  total_requests?: number | null
  total_persons?: number | null
  total_bunks?: number | null
  satisfied_request_count?: number | null
  assignments_changed?: number | null
  new_assignments?: number | null
  request_validation?: {
    total_requests?: number
    possible_requests?: number
    impossible_requests?: number
    affected_campers?: number
    unsatisfied_no_possible?: number
    unsatisfied_material_parent_unmet?: number
    unsatisfied_other_unmet?: number
    mp_requests_total?: number
    mp_requests_satisfied?: number
    mp_campers_total?: number
    mp_campers_satisfied?: number
    all_campers_total?: number
    all_campers_satisfied?: number
    // Tier 1 observability (Stream 2, issue #1380)
    impossible_by_reason?: Record<string, number>
  }
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

// PocketBase JS SDK returns JSON-typed fields as already-parsed values, not
// strings — see frontend/src/hooks/useSyncStatus.ts for the same pattern.
interface RawSolverRunRecord {
  id: string
  run_id: string
  status: string
  created: string
  session_id?: number | null
  started_at?: string | null
  completed_at?: string | null
  stats?: SolverRunStats | null
  details?: SolverRunDetails | null
  error?: { message?: string } | null
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseRecord(rec: RawSolverRunRecord): SolverRun {
  const out: SolverRun = {
    id: rec.id,
    run_id: rec.run_id,
    status: rec.status,
    created: rec.created,
    error: isObject(rec.error) ? (rec.error as { message?: string }) : null,
  }
  if (typeof rec.session_id === 'number') out.session_id = rec.session_id
  if (typeof rec.started_at === 'string') out.started_at = rec.started_at
  if (typeof rec.completed_at === 'string') out.completed_at = rec.completed_at
  if (isObject(rec.stats)) out.stats = rec.stats as SolverRunStats
  if (isObject(rec.details)) out.details = rec.details as SolverRunDetails
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

interface SolverRunsPage {
  items: SolverRun[]
  totalItems: number
}

const PER_PAGE = 100

export function useSolverRuns(filters: SolverRunsFilters, options?: UseSolverRunsOptions) {
  const pollMs = options?.pollMs ?? false
  return useInfiniteQuery({
    queryKey: queryKeys.solverRuns(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<SolverRunsPage> => {
      const filterParts: string[] = []
      const filterParams: Record<string, unknown> = {}
      if (filters.year !== undefined) {
        filterParts.push('year = {:year}')
        filterParams['year'] = filters.year
      }
      if (filters.sessionId !== undefined) {
        filterParts.push('session_id = {:sessionId}')
        filterParams['sessionId'] = filters.sessionId
      }
      if (filters.hideFailed) {
        filterParts.push('status != "failed" && status != "error"')
      }
      if (filters.sourceKind && filters.sourceKind !== 'all') {
        filterParts.push('details.source_kind = {:sourceKind}')
        filterParams['sourceKind'] = filters.sourceKind
      }
      if (filters.manualOnly) {
        // sweep_id is null for runs that aren't part of a sweep; PB JSON field
        // semantics treat absent and empty consistently, so match both forms.
        filterParts.push('(details.sweep_id = null || details.sweep_id = "")')
      } else if (filters.sweepId) {
        filterParts.push('details.sweep_id = {:sweepId}')
        filterParams['sweepId'] = filters.sweepId
      }
      if (filters.since) {
        filterParts.push('created >= {:since}')
        filterParams['since'] = filters.since
      }
      const filterStr = filterParts.length ? pb.filter(filterParts.join(' && '), filterParams) : ''

      const result = await pb.collection('solver_runs').getList(pageParam as number, PER_PAGE, {
        filter: filterStr,
        sort: '-created',
      })

      return {
        items: (result.items as unknown as RawSolverRunRecord[]).map(parseRecord),
        totalItems: result.totalItems,
      }
    },
    getNextPageParam: (_lastPage, allPages, lastPageParam) => {
      const fetched = allPages.reduce((sum, p) => sum + p.items.length, 0)
      const total = allPages[0]?.totalItems ?? 0
      return fetched < total ? (lastPageParam as number) + 1 : undefined
    },
    staleTime: 5_000,
    refetchInterval: pollMs === false ? false : pollMs,
    refetchIntervalInBackground: false,
  })
}
