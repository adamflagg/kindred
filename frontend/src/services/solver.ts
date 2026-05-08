import type { Constraint, SolverRun } from '../types/app-types'
import type { SweepRequest, SweepResponse } from '../types/api-generated'

export type { SweepRequest, SweepResponse }

export async function postRunSweep(req: SweepRequest): Promise<SweepResponse> {
  const res = await fetch('/api/solver/run-sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Sweep request failed: ${res.status}`)
  return (await res.json()) as SweepResponse
}

export async function postCancelSweep(sweepId: string): Promise<void> {
  const res = await fetch(`/api/solver/run-sweep/${sweepId}/cancel`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Sweep cancel failed: ${res.status}`)
}

interface CapacityBreakdownItem {
  campers: number
  beds: number
  sufficient: boolean
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
    unsatisfiable_requests: Array<{
      requester: string
      request_type: string
      requested_cm_id: string
      reason: string
    }>
    capacity_breakdown?: {
      boys: CapacityBreakdownItem
      girls: CapacityBreakdownItem
      ag: CapacityBreakdownItem
    }
  }
}

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
