/**
 * Service for social graph API endpoints
 * Provides methods for fetching session and bunk social graphs
 */
import type { GraphData } from '../types/graph'

const API_BASE = '/api'

export const socialGraphService = {
  /**
   * Fetch social network graph data for a session.
   * When `scenarioId` is provided, the backend sources bunk assignments from
   * the scenario's draft assignments instead of the production (CampMinder) data.
   */
  async getSessionSocialGraph(
    sessionCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    scenarioId?: string | null
  ): Promise<GraphData> {
    const params = new URLSearchParams({
      year: String(year),
      include_metrics: 'true',
    })
    if (scenarioId) {
      params.set('scenario_id', scenarioId)
    }
    const response = await fetchWithAuth(
      `${API_BASE}/sessions/${sessionCmId}/social-graph?${params.toString()}`
    )
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch session social graph: ${response.status} - ${errorText}`)
    }
    return response.json()
  },

  /**
   * Fetch social network graph data for a specific bunk.
   * When `scenarioId` is provided, the backend sources bunk membership from
   * the scenario's draft assignments instead of the production (CampMinder) data.
   */
  async getBunkSocialGraph(
    bunkCmId: number,
    sessionCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    scenarioId?: string | null
  ): Promise<GraphData> {
    const params = new URLSearchParams({
      session_cm_id: String(sessionCmId),
      year: String(year),
    })
    if (scenarioId) {
      params.set('scenario_id', scenarioId)
    }
    const response = await fetchWithAuth(
      `${API_BASE}/bunks/${bunkCmId}/social-graph?${params.toString()}`
    )
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch bunk social graph: ${response.status} - ${errorText}`)
    }
    return response.json()
  },
}
