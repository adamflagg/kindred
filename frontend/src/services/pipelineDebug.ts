/**
 * Pipeline Debug API Service
 *
 * Provides methods for the pipeline debug tool endpoints.
 * Follows the same fetchWithAuth pattern as services/debug.ts.
 */

import type {
  PipelineRunsResponse,
  PipelineSummaryFilters,
  PipelineSummaryResponse,
  PipelineTrace,
  PipelineTracesResponse,
  PipelinePhase,
  RunPhaseResponse,
  RunFromPhaseRequest,
  RunFullTraceRequest,
  TogglePinResponse,
  PersonSearchResponse,
  OriginalRequestsResponse,
} from '../components/pipeline-debug/types'

const API_BASE = '/api/debug'

export const pipelineDebugService = {
  /**
   * List all pipeline debug runs, ordered by most recent first.
   */
  async fetchPipelineRuns(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PipelineRunsResponse> {
    const response = await fetchWithAuth(`${API_BASE}/pipeline-runs`)

    if (!response.ok) {
      throw new Error('Failed to fetch pipeline runs')
    }
    return response.json()
  },

  /**
   * Toggle the pinned state of a pipeline run.
   */
  async toggleRunPin(
    runId: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<TogglePinResponse> {
    const response = await fetchWithAuth(
      `${API_BASE}/pipeline-runs/${encodeURIComponent(runId)}/pin`,
      {
        method: 'POST',
      }
    )

    if (!response.ok) {
      throw new Error('Failed to toggle run pin')
    }
    return response.json()
  },

  /**
   * Fetch summary rows for a specific run with PB-native filtering and pagination.
   */
  async fetchPipelineSummary(
    runId: string,
    filters: PipelineSummaryFilters,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PipelineSummaryResponse> {
    const params = new URLSearchParams()
    if (filters.final_status) params.set('final_status', filters.final_status)
    if (filters.resolution_method) params.set('resolution_method', filters.resolution_method)
    if (filters.source_field) params.set('source_field', filters.source_field)
    if (filters.session_cm_id !== undefined) {
      params.set('session_cm_id', String(filters.session_cm_id))
    }
    if (filters.phase3_triggered !== undefined) {
      params.set('phase3_triggered', String(filters.phase3_triggered))
    }
    if (filters.pre_p1_action) params.set('pre_p1_action', filters.pre_p1_action)
    if (filters.min_confidence !== undefined) {
      params.set('min_confidence', String(filters.min_confidence))
    }
    if (filters.max_confidence !== undefined) {
      params.set('max_confidence', String(filters.max_confidence))
    }
    if (filters.page !== undefined) params.set('page', String(filters.page))
    if (filters.per_page !== undefined) params.set('per_page', String(filters.per_page))
    if (filters.sort) params.set('sort', filters.sort)
    if (filters.search) params.set('search', filters.search)

    const queryString = params.toString()
    const url = `${API_BASE}/pipeline-runs/${encodeURIComponent(runId)}/summary${queryString ? `?${queryString}` : ''}`
    const response = await fetchWithAuth(url)

    if (!response.ok) {
      throw new Error('Failed to fetch pipeline summary')
    }
    return response.json()
  },

  /**
   * Fetch full trace data for a single trace (drill-down view).
   */
  async fetchPipelineTrace(
    traceId: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PipelineTrace> {
    const response = await fetchWithAuth(
      `${API_BASE}/pipeline-traces/${encodeURIComponent(traceId)}`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch pipeline trace')
    }
    const data = await response.json()
    return data.trace
  },

  /**
   * Fetch all traces for a specific camper across all runs.
   */
  async fetchTracesByCamper(
    cmId: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PipelineTracesResponse> {
    const response = await fetchWithAuth(
      `${API_BASE}/pipeline-traces/by-camper/${encodeURIComponent(String(cmId))}`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch traces for camper')
    }
    return response.json()
  },

  /**
   * Cascade from a specified phase through all remaining phases.
   * Creates a new trace with fresh data from the starting phase onward.
   */
  async runFromPhase(
    phase: PipelinePhase,
    request: RunFromPhaseRequest,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<RunPhaseResponse> {
    const response = await fetchWithAuth(
      `${API_BASE}/run-from-phase/${encodeURIComponent(phase)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail ?? `Failed to run from ${phase}`)
    }
    return response.json()
  },

  /**
   * Run the full pipeline for a single record with tracing enabled.
   * Returns the new trace ID for navigation.
   */
  async runFullTrace(
    request: RunFullTraceRequest,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<RunPhaseResponse> {
    const response = await fetchWithAuth(`${API_BASE}/run-full-trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail ?? 'Failed to run full trace')
    }
    return response.json()
  },

  /**
   * Fetch original bunk requests with optional filters (for Browse tab).
   */
  async fetchOriginalRequests(
    year: number,
    filters: { session_cm_id?: number; source_field?: string; limit?: number },
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<OriginalRequestsResponse> {
    const params = new URLSearchParams({ year: String(year) })
    if (filters.session_cm_id) params.set('session_cm_id', String(filters.session_cm_id))
    if (filters.source_field) params.set('source_field', filters.source_field)
    if (filters.limit) params.set('limit', String(filters.limit))
    const response = await fetchWithAuth(`${API_BASE}/original-requests?${params}`)
    if (!response.ok) throw new Error('Failed to fetch original requests')
    return response.json()
  },

  /**
   * Search persons by name for the New Trace modal.
   */
  async searchPersons(
    query: string,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PersonSearchResponse> {
    const params = new URLSearchParams({ q: query, year: String(year) })
    const response = await fetchWithAuth(`${API_BASE}/search-persons?${params}`)
    if (!response.ok) throw new Error('Failed to search persons')
    return response.json()
  },

  /**
   * Fetch original bunk requests for a specific camper by CampMinder ID.
   */
  async fetchOriginalRequestsByCamper(
    cmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<OriginalRequestsResponse> {
    const response = await fetchWithAuth(
      `${API_BASE}/original-requests/by-camper/${cmId}?year=${year}`
    )
    if (!response.ok) throw new Error('Failed to fetch original requests')
    return response.json()
  },
}
