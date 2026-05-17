import type { Constraint, SolverRun } from '../types/app-types'
import type { SweepRequest, SweepResponse } from '../types/api-generated'

export type { SweepRequest, SweepResponse }

type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

// FastAPI HTTPException(detail=...) lands in the response body as { detail: <whatever> }.
// For our solver routes that's typically either a plain string or { detail: string, ... }.
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && 'detail' in detail) {
      const inner = (detail as { detail?: unknown }).detail
      if (typeof inner === 'string') return inner
    }
  } catch {
    // Body was empty or not JSON — fall through to status-only message.
  }
  return `${fallback}: ${res.status}`
}

export async function postRunSweep(
  fetchWithAuth: FetchWithAuth,
  req: SweepRequest
): Promise<SweepResponse> {
  const res = await fetchWithAuth('/api/solver/run-sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Sweep request failed'))
  return (await res.json()) as SweepResponse
}

export async function postCancelSweep(
  fetchWithAuth: FetchWithAuth,
  sweepId: string
): Promise<void> {
  const res = await fetchWithAuth(`/api/solver/run-sweep/${sweepId}/cancel`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Sweep cancel failed'))
}

interface CapacityBreakdownItem {
  campers: number
  beds: number
  sufficient: boolean
}

export interface ImpossibilityReportItem {
  request_id: string
  reason_code: string
  reason_message: string
  request_type: string
  requester: { cm_id: number; name: string; grade: number; gender: string }
  requestee: { cm_id: number; name: string; grade: number; gender: string } | null
  detail: Record<string, unknown>
  bucket: 'material_parent' | 'immaterial_parent' | 'staff' | null
}

export interface EntirelyImpossibleMpCamper {
  cm_id: number
  name: string
  grade: number
  gender: string
  reason_codes: string[]
}

export interface ImpossibilityReport {
  total_impossible: number
  affected_campers: number
  by_reason: Record<string, ImpossibilityReportItem[]>
  flat: ImpossibilityReportItem[]
  mp_campers_entirely_impossible?: EntirelyImpossibleMpCamper[]
  // Optional because callers (e.g. the admin modal) intentionally tolerate a
  // missing/legacy payload — see the defensive-rendering test in
  // SolverDebugImpossibilityModal.test.tsx.
  by_bucket_count?: Record<string, number>
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  statistics: {
    total_campers: number
    total_bunks: number
    total_capacity: number
    total_requests: number
    campers_with_requests: number
    campers_without_requests: number
    capacity_breakdown?: {
      boys: CapacityBreakdownItem
      girls: CapacityBreakdownItem
      ag: CapacityBreakdownItem
    }
  }
  impossibility_report: ImpossibilityReport
}

/** Full statistics payload returned by the post-check validation endpoint. */
export interface ValidationStatistics {
  total_campers: number
  assigned_campers: number
  unassigned_campers: number
  total_requests: number
  satisfied_requests: number
  request_satisfaction_rate: number
  bunks_at_capacity: number
  bunks_under_capacity: number
  bunks_over_capacity: number
  material_parent_requests?: number
  satisfied_material_parent_requests?: number
  material_parent_request_satisfaction_rate?: number
  campers_with_unsatisfied_material_parent_requests?: number
  unsatisfied_material_parent_persons?: Array<{ cm_id: number; name: string }>
  best_effort_parent_requests?: number
  satisfied_best_effort_parent_requests?: number
  best_effort_parent_request_satisfaction_rate?: number
  /** Staff bunk requests (distinct from parent requests). */
  staff_requests?: number
  satisfied_staff_requests?: number
  staff_request_satisfaction_rate?: number
  campers_with_unsatisfied_staff_requests?: number
  /** Count of not_bunk_with constraint violations. */
  negative_request_violations?: number
  /** Campers in bunks with no socially connected peers (isolation risk count). */
  isolation_risks?: number
  field_stats: Record<
    string,
    {
      total: number
      satisfied: number
      satisfaction_rate: number
    }
  >
  negative_request_violations_detail?: Array<{
    requester_cm_id: string
    target_cm_id: string
    requester_name: string
    target_name: string
    bunk_cm_id: string
    bunk_name: string
  }>
  priority_unsuccessfuls?: Array<{
    requester_cm_id: string
    target_cm_id: string
    requester_name: string
    target_name: string
    raw_text: string
  }>
  /** TG-6: camper-level two-tier MP coverage. */
  mp_campers_total?: number
  mp_campers_with_at_least_one_satisfied?: number
  mp_campers_with_all_satisfied?: number
  /** TG-polish: one entry per unsatisfied MP request, with names + bunk placement. */
  unsatisfied_material_parent_detail?: Array<{
    requester_cm_id: string
    requester_name: string
    target_cm_id: string
    target_name: string
    requester_bunk_name: string
    target_bunk_name: string
  }>
  /** TG-polish: per-gender bunk capacity + assigned counts. */
  capacity_by_gender?: {
    female: { capacity: number; assigned: number }
    male: { capacity: number; assigned: number }
  }
}

// Shared cache type for the pre-check query — written by PreValidateRequestsButton
// (via queryClient.setQueryData) and read by ValidateBunkingButton's useQuery.
// Exporting the inferred return type keeps the writer and reader locked together.
export type PreCheckCacheValue = Awaited<ReturnType<typeof solverService.preValidateRequests>>

interface BunkingValidationResult {
  is_valid: boolean
  errors: Array<{
    type: string
    message: string
    details?: Record<string, unknown>
  }>
  warnings: Array<{
    type: string
    message: string
    details?: Record<string, unknown>
  }>
  summary: {
    total_campers: number
    total_bunks: number
    assigned_campers: number
    unassigned_campers: number
    empty_bunks: number
    constraint_violations: number
  }
}

export interface SolverScoreResult {
  scenario_id: string | null
  session_id: number
  year: number
  total_score: number
  request_satisfaction_score: number
  soft_penalty_score: number
  total_requests: number
  satisfied_requests: number
  satisfaction_rate: number
  field_scores: Record<string, { total: number; satisfied: number; raw_score: number }>
  penalties: Record<string, number>
}

// Get the Solver API URL prefix (internal only)
// All solver endpoints are now under /api/*
const getSolverApiUrl = () => {
  return '/api'
}

const SOLVER_API_URL = getSolverApiUrl()

// Solver runs up to its requested time_limit, then needs a tail to write
// assignments to PocketBase before the run record flips to "completed".
// Without this buffer, a solve that uses its full time_limit appears as a
// frontend timeout even though the backend ultimately succeeds.
export const POLL_BUFFER_SECONDS = 30

export interface SolverRequest {
  session_id: string
  constraints: Constraint[]
  locked_bunks: string[]
}

export interface SolverResponse {
  status: 'success' | 'error'
  solver_run_id?: string
  message?: string
  error?: string
}

export const solverService = {
  async runSolver(
    sessionId: string,
    year: number,
    scenarioId: string | null | undefined,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    timeLimit: number = 60,
    respectLocks: boolean = true
  ): Promise<SolverRun> {
    try {
      // Call solver API directly
      const response = await fetchWithAuth(`${SOLVER_API_URL}/solver/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_cm_id: parseInt(sessionId),
          year: year,
          apply_results: false,
          time_limit: timeLimit,
          scenario: scenarioId ?? null,
          respect_locks: respectLocks,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Solver API error: ${error}`)
      }

      const result = await response.json()

      if (!result.run_id) {
        throw new Error('No run ID returned from solver')
      }

      // Poll for completion (solver runs async)
      return await this.pollSolverStatus(result.run_id, fetchWithAuth, timeLimit)
    } catch (error) {
      console.error('Solver error:', error)
      throw error
    }
  },

  async pollSolverStatus(
    solverRunId: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    timeLimitSeconds = 60
  ): Promise<SolverRun> {
    const effectiveLimit = Math.max(1, Math.floor(timeLimitSeconds))
    const maxAttempts = effectiveLimit + POLL_BUFFER_SECONDS
    for (let i = 0; i < maxAttempts; i++) {
      // Poll the solver service API for status
      const response = await fetchWithAuth(`${SOLVER_API_URL}/solver/run/${solverRunId}`)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get solver status: ${response.status} - ${errorText}`)
      }

      const runStatus = await response.json()

      if (runStatus.status === 'completed') {
        // Transform the API response to match our SolverRun type
        return {
          id: solverRunId,
          session: runStatus.session_id ?? '',
          status: 'completed',
          started_at: runStatus.started_at ?? new Date().toISOString(),
          completed_at: runStatus.completed_at ?? new Date().toISOString(),
          results: runStatus.results,
          // Don't include error_message when undefined
          created: runStatus.created_at ?? new Date().toISOString(),
          updated: runStatus.updated_at ?? new Date().toISOString(),
        }
      }

      if (runStatus.status === 'failed') {
        const errorMsg = runStatus.error_message ?? 'Solver failed'
        console.error('Solver failed with error:', errorMsg)
        throw new Error(errorMsg)
      }

      // Wait 1 second before next poll
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error('Solver timeout - took longer than expected')
  },

  async applySolverResults(
    solverRunId: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<void> {
    const response = await fetchWithAuth(`${SOLVER_API_URL}/solver/apply/${solverRunId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to apply solver results: ${error}`)
    }

    await response.json()
  },

  // Helper to validate constraints before solving
  validateConstraints(constraints: Constraint[]): string[] {
    const errors: string[] = []

    constraints.forEach((constraint, index) => {
      // Skip validation if using new person1/person2 fields
      if (!constraint.campers) {
        return
      }

      if (constraint.campers.length === 0) {
        errors.push(`Constraint ${index + 1} has no campers`)
      }

      if (constraint.type === 'pair_together' && constraint.campers.length !== 2) {
        errors.push(`Pair constraint ${index + 1} must have exactly 2 campers`)
      }

      if (constraint.type === 'keep_apart' && constraint.campers.length < 2) {
        errors.push(`Keep apart constraint ${index + 1} must have at least 2 campers`)
      }
    })

    return errors
  },

  // Validate bunking assignments
  async validateBunking(
    sessionId: string,
    year: number,
    scenarioId: string | undefined,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<BunkingValidationResult> {
    try {
      const response = await fetchWithAuth(`${SOLVER_API_URL}/validate-bunking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_cm_id: parseInt(sessionId),
          year: year,
          scenario: scenarioId,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Validation API error: ${error}`)
      }

      const result = await response.json()
      return result
    } catch (error) {
      console.error('Validation error:', error)
      throw error
    }
  },

  // Clear all assignments in a scenario
  async clearScenarioAssignments(
    scenarioId: string,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<{ message: string; deleted_count?: number }> {
    try {
      const response = await fetchWithAuth(`${SOLVER_API_URL}/scenarios/${scenarioId}/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ year }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Clear assignments API error: ${error}`)
      }

      const result = await response.json()
      return result
    } catch (error) {
      console.error('Clear assignments error:', error)
      throw error
    }
  },

  // Pre-validate requests to check for unsatisfiable constraints
  async preValidateRequests(
    sessionCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<ValidationResult> {
    try {
      const response = await fetchWithAuth(`${SOLVER_API_URL}/solver/pre-validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_cm_id: sessionCmId,
          year: year,
          apply_results: false,
          time_limit: 60,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Pre-validation API error: ${error}`)
      }

      const result = await response.json()
      return result
    } catch (error) {
      console.error('Pre-validation error:', error)
      throw error
    }
  },

  // Get solver optimization score for a scenario
  async getScenarioScore(
    sessionCmId: number,
    year: number,
    scenarioId: string | null,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<SolverScoreResult> {
    try {
      const scenarioParam = scenarioId ? `&scenario_id=${scenarioId}` : ''
      const response = await fetchWithAuth(
        `${SOLVER_API_URL}/scenarios/score?session_id=${sessionCmId}&year=${year}${scenarioParam}`
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Scenario score API error: ${error}`)
      }

      return response.json()
    } catch (error) {
      console.error('Scenario score error:', error)
      throw error
    }
  },

  // Update assignment in a scenario (draft mode)
  async updateScenarioAssignment(
    scenarioId: string,
    personCmId: number,
    bunkCmId: number | null,
    sessionCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<unknown> {
    const response = await fetchWithAuth(`${SOLVER_API_URL}/scenarios/${scenarioId}/assignments`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_cm_id: sessionCmId,
        year: year,
        person_id: personCmId,
        bunk_id: bunkCmId,
        updated_by: 'user',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Failed to update scenario assignment:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        requestData: { person_id: personCmId, bunk_id: bunkCmId },
      })
      throw new Error(
        `Failed to update scenario assignment: ${response.status} ${response.statusText}`
      )
    }

    return response.json()
  },

  // Incremental position update for a camper (production mode)
  async updateCamperPosition(
    sessionCmId: number,
    personCmId: number,
    bunkCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<{ success: boolean; result?: unknown }> {
    try {
      const response = await fetchWithAuth(
        `${SOLVER_API_URL}/sessions/${sessionCmId}/campers/${personCmId}/position?year=${year}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            new_bunk_id: bunkCmId,
          }),
        }
      )

      if (response.ok) {
        const result = await response.json()
        return { success: true, result }
      }
      return { success: false }
    } catch (error) {
      console.warn('Incremental update failed, falling back to traditional method:', error)
      return { success: false }
    }
  },
}
