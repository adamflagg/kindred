/**
 * Debug API Service
 *
 * Provides methods for the Phase 1 AI parse analysis debug tool.
 */

const API_BASE = '/api/debug';

// Types matching backend schemas
export interface ParsedIntent {
  request_type: string;
  target_name: string | null;
  keywords_found: string[];
  parse_notes: string;
  reasoning: string;
  list_position: number;
  needs_clarification: boolean;
  temporal_info: {
    date: string | null;
    is_superseded: boolean;
    supersedes_reason: string | null;
  } | null;
}

export interface ParseAnalysisItem {
  id: string;
  original_request_id: string;
  requester_name: string | null;
  requester_cm_id: number | null;
  source_field: string | null;
  original_text: string | null;
  parsed_intents: ParsedIntent[];
  is_valid: boolean;
  error_message: string | null;
  token_count: number | null;
  processing_time_ms: number | null;
  prompt_version: string | null;
  created: string | null;
}

export interface ParseAnalysisDetailItem extends ParseAnalysisItem {
  ai_raw_response: Record<string, unknown> | null;
}

export interface ParseAnalysisListResponse {
  items: ParseAnalysisItem[];
  total: number;
}

export interface OriginalRequestItem {
  id: string;
  requester_name: string | null;
  requester_cm_id: number | null;
  source_field: string;
  original_text: string;
  year: number;
  processed: boolean;
}

export interface OriginalRequestsListResponse {
  items: OriginalRequestItem[];
  total: number;
}

export interface Phase1OnlyRequest {
  original_request_ids: string[];
  force_reparse: boolean;
}

export interface Phase1OnlyResponse {
  results: ParseAnalysisItem[];
  total_tokens: number;
}

export interface ClearAnalysisResponse {
  deleted_count: number;
}

export type SourceFieldType = 'bunk_with' | 'not_bunk_with' | 'bunking_notes' | 'internal_notes';

export interface ParseAnalysisFilters {
  session_cm_id?: number | undefined;
  source_field?: SourceFieldType | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface OriginalRequestsFilters {
  year: number;
  session_cm_id?: number;
  source_field?: SourceFieldType;
  limit?: number;
}

// Prompt Editor Types

export interface PromptListItem {
  name: string;
  filename: string;
  modified_at: string | null;
}

export interface PromptListResponse {
  prompts: PromptListItem[];
}

export interface PromptContentResponse {
  name: string;
  content: string;
  modified_at: string | null;
}

export interface PromptUpdateRequest {
  content: string;
}

export interface PromptUpdateResponse {
  name: string;
  success: boolean;
}

export const debugService = {
  /**
   * List parse analysis results with optional filters
   */
  async listParseAnalysis(
    filters: ParseAnalysisFilters,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<ParseAnalysisListResponse> {
    const params = new URLSearchParams();
    if (filters.session_cm_id) params.set('session_cm_id', String(filters.session_cm_id));
    if (filters.source_field) params.set('source_field', filters.source_field);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const url = `${API_BASE}/parse-analysis${params.toString() ? `?${params}` : ''}`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to fetch parse analysis results');
    }
    return response.json();
  },

  /**
   * Get detailed parse analysis result by ID
   */
  async getParseAnalysisDetail(
    id: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<ParseAnalysisDetailItem> {
    const response = await fetchWithAuth(`${API_BASE}/parse-analysis/${id}`);

    if (!response.ok) {
      throw new Error('Failed to fetch parse analysis detail');
    }
    return response.json();
  },

  /**
   * Run Phase 1 parsing on selected original requests
   */
  async parsePhase1Only(
    request: Phase1OnlyRequest,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<Phase1OnlyResponse> {
    const response = await fetchWithAuth(`${API_BASE}/parse-phase1-only`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to run Phase 1 parsing');
    }
    return response.json();
  },

  /**
   * Clear all parse analysis results
   */
  async clearParseAnalysis(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<ClearAnalysisResponse> {
    const response = await fetchWithAuth(`${API_BASE}/parse-analysis`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to clear parse analysis results');
    }
    return response.json();
  },

  /**
   * List original bunk requests for debug selection
   */
  async listOriginalRequests(
    filters: OriginalRequestsFilters,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<OriginalRequestsListResponse> {
    const params = new URLSearchParams();
    params.set('year', String(filters.year));
    if (filters.session_cm_id) params.set('session_cm_id', String(filters.session_cm_id));
    if (filters.source_field) params.set('source_field', filters.source_field);
    if (filters.limit) params.set('limit', String(filters.limit));

    const response = await fetchWithAuth(`${API_BASE}/original-requests?${params}`);

    if (!response.ok) {
      throw new Error('Failed to fetch original requests');
    }
    return response.json();
  },

  // ============================================================================
  // Prompt Editor Methods
  // ============================================================================

  /**
   * List available prompt files
   */
  async listPrompts(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PromptListResponse> {
    const response = await fetchWithAuth(`${API_BASE}/prompts`);

    if (!response.ok) {
      throw new Error('Failed to fetch prompts list');
    }
    return response.json();
  },

  /**
   * Get the content of a specific prompt
   */
  async getPrompt(
    name: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PromptContentResponse> {
    const response = await fetchWithAuth(`${API_BASE}/prompts/${encodeURIComponent(name)}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Prompt '${name}' not found`);
      }
      throw new Error('Failed to fetch prompt content');
    }
    return response.json();
  },

  /**
   * Update a prompt's content
   */
  async updatePrompt(
    name: string,
    content: string,
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  ): Promise<PromptUpdateResponse> {
    const response = await fetchWithAuth(`${API_BASE}/prompts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content } satisfies PromptUpdateRequest),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Prompt '${name}' not found`);
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to update prompt');
    }
    return response.json();
  },
};
