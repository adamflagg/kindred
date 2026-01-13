/**
 * Service for social graph API endpoints
 * Provides methods for fetching session and bunk social graphs
 */
import type { GraphData } from '../types/graph';

const API_BASE = '/api';

export const socialGraphService = {
  /**
   * Fetch social network graph data for a session
   */
  async getSessionSocialGraph(
    sessionCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<GraphData> {
    const response = await fetchWithAuth(
      `${API_BASE}/sessions/${sessionCmId}/social-graph?year=${year}&include_metrics=true`
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch session social graph: ${response.status} - ${errorText}`);
    }
    return response.json();
  },

  /**
   * Fetch social network graph data for a specific bunk
   */
  async getBunkSocialGraph(
    bunkCmId: number,
    sessionCmId: number,
    year: number,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<GraphData> {
    const response = await fetchWithAuth(
      `${API_BASE}/bunks/${bunkCmId}/social-graph?session_cm_id=${sessionCmId}&year=${year}`
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch bunk social graph: ${response.status} - ${errorText}`);
    }
    return response.json();
  },
};
