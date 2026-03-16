/**
 * TypeScript types for the Pipeline Debug tool.
 *
 * These types mirror the Python trace_models.py schema and API response shapes
 * for debug_pipeline_runs, debug_pipeline_traces, and debug_pipeline_summary.
 */

// =============================================================================
// trace_data JSON Schema — mirrors bunking/.../debug/trace_models.py
// =============================================================================

export interface RequesterInfo {
  cm_id: number
  name: string
  grade: string
}

export interface PrePhase1Trace {
  action: string // parsed | skipped_no_preference | skipped_no_session | etc.
  skip_reason: string | null
  original_text: string
  cleaned_text: string
  na_prefix_stripped: boolean
  staff_metadata: Record<string, unknown> | null
  field_path: string // ai_parse | socialize_direct_map
  socialize_mapped_value: string | null
  session_cm_ids: number[]
  requester_info: RequesterInfo
}

export interface SanitizationInfo {
  is_suspicious: boolean
  risk_level: string | null
  confidence_penalty: number
}

export interface ParsedIntentTrace {
  target_name: string
  request_type: string
  confidence: number
  keywords_found: string[]
  reasoning: string
  ai_reasoning_summary: string | null
  parse_notes: string
  needs_clarification: boolean
  temporal_info: {
    date: string | null
    is_superseded: boolean
    supersedes_reason: string | null
  } | null
  csv_position: number
}

export interface Phase1Trace {
  ran: boolean
  parse_request: Record<string, unknown>
  parsed_intents: ParsedIntentTrace[]
  ai_raw_response: Record<string, unknown>
  ai_reasoning_summary: string | null
  token_count: number | null
  processing_time_ms: number | null
  sanitization: SanitizationInfo
  is_valid: boolean
  error_message: string | null
}

export interface ValidationTrace {
  type_validation: {
    passed: boolean
    rejected: unknown[]
  }
  temporal_conflicts: {
    filtered: number
    details: unknown[]
  }
  source_text_validation: {
    rejected: number
    hallucinated_names: string[]
    unit_names: string[]
  }
}

export interface CandidateTrace {
  person_cm_id: number
  name: string
  session_cm_id: number | null
  grade: number | null
  school: string | null
  score_breakdown: Record<string, unknown>
}

export interface Phase2FinalResult {
  person_cm_id: number | null
  person_name: string | null
  confidence: number
  method: string
  is_resolved: boolean
  is_ambiguous: boolean
  confidence_factors: Record<string, unknown>
}

export interface SocialGraphDetails {
  enhanced: boolean
  connection_strength: number | null
  shared_friends: number | null
  smart_resolved: boolean
  candidates_reranked: boolean
}

export interface Phase2IntentTrace {
  target_name: string
  fast_path_tried: string[]
  fast_path_result: Record<string, unknown> | null
  pipeline_strategies_tried: Array<Record<string, unknown>>
  all_candidates: CandidateTrace[]
  final_result: Phase2FinalResult
  staff_filtered: boolean
  hallucination_detected: boolean
  social_graph_details: SocialGraphDetails
  spread_filter_applied: boolean
}

export interface PlaceholderExpansionTrace {
  triggered: boolean
  type: string | null
  expanded_count: number
  expanded_targets: Array<Record<string, unknown>>
}

export interface HistoricalVerificationTrace {
  ran: boolean
  boost_applied: boolean
  original_confidence: number | null
  boosted_confidence: number | null
}

export interface Phase3IntentTrace {
  target_name: string
  ran: boolean
  candidates_sent: Array<Record<string, unknown>>
  ai_context: Record<string, unknown>
  ai_selection: number | null
  ai_reasoning: string | null
  ai_reasoning_summary: string | null
  result: 'not_needed' | 'resolved' | 'no_match' | 'still_ambiguous'
  confidence_before: number | null
  confidence_after: number | null
}

export interface FinalBunkRequestTrace {
  bunk_request_id: string | null
  requester_cm_id: number
  requested_cm_id: number | null
  requested_name: string | null
  request_type: string
  status: string
  confidence: number
  priority: number
  resolution_method: string
  is_placeholder: boolean
  declined_reason: string | null
}

export interface PostPipelineTrace {
  conflict_detection: {
    has_conflict: boolean
    details: unknown[]
  }
  self_reference: {
    detected: boolean
  }
  reciprocal: {
    detected: boolean
    boost_applied: boolean
    boost_amount: number | null
    pair_cm_id: number | null
  }
  deduplication: {
    was_duplicate: boolean
    kept_over: string | null
  }
  final_bunk_requests: FinalBunkRequestTrace[]
}

export interface TraceData {
  pre_phase1: PrePhase1Trace
  phase1_parse: Phase1Trace
  validation: ValidationTrace
  phase2_resolution: Phase2IntentTrace[]
  placeholder_expansion: PlaceholderExpansionTrace
  historical_verification: HistoricalVerificationTrace
  phase3_disambiguation: Phase3IntentTrace[]
  post_pipeline: PostPipelineTrace
}

// =============================================================================
// API Response Types — debug_pipeline_runs
// =============================================================================

export interface StatusBreakdown {
  resolved: number
  pending: number
  declined: number
  skipped: number
}

export interface PipelineRun {
  id: string
  run_id: string
  year: number
  session: string
  source_fields: string[]
  limit_param: number
  force: boolean
  trace_count: number
  status_breakdown: StatusBreakdown
  pinned: boolean
  created: string
}

export interface PipelineRunsResponse {
  items: PipelineRun[]
  total: number
}

// =============================================================================
// API Response Types — debug_pipeline_traces
// =============================================================================

export interface PipelineTrace {
  id: string
  run_id: string
  original_request_id: string
  requester_cm_id: number
  year: number
  session_cm_id: number
  source_field: string
  trace_data: TraceData
  pinned: boolean
  schema_version: number
  created: string
}

export interface PipelineTracesResponse {
  items: PipelineTrace[]
  total: number
}

// =============================================================================
// API Response Types — debug_pipeline_summary
// =============================================================================

export interface PipelineSummaryItem {
  id: string
  run_id: string
  trace_id: string
  original_request_id: string
  bunk_request_id: string | null
  requester_cm_id: number
  requester_name: string
  target_name: string
  source_field: string
  session_cm_id: number
  request_type: string
  final_status: string
  final_confidence: number
  resolution_method: string
  phase3_triggered: boolean
  ai_reasoning_summary: string
  pre_p1_action: string
  year: number
}

export interface PipelineSummaryResponse {
  items: PipelineSummaryItem[]
  total: number
}

export interface PipelineSummaryFilters {
  final_status?: string
  resolution_method?: string
  source_field?: string
  session_cm_id?: number
  phase3_triggered?: boolean
  pre_p1_action?: string
  min_confidence?: number
  max_confidence?: number
  page?: number
  per_page?: number
  sort?: string
}

// =============================================================================
// Phase Execution Types
// =============================================================================

export type PipelinePhase =
  | 'pre_phase1'
  | 'phase1'
  | 'validation'
  | 'phase2'
  | 'expansion'
  | 'historical'
  | 'phase3'
  | 'post_pipeline'

/** Canonical ordering of pipeline phases, used by canvas and page. */
export const PHASE_ORDER: PipelinePhase[] = [
  'pre_phase1',
  'phase1',
  'validation',
  'phase2',
  'expansion',
  'historical',
  'phase3',
  'post_pipeline',
]

export interface RunPhaseRequest {
  trace_id?: string
  original_request_ids?: string[]
  year: number
  session_cm_ids: number[]
  dry_run?: boolean
}

export interface RunPhaseResponse {
  success: boolean
  trace_id: string | null
  error?: string
  phase?: string
  dry_run?: boolean
}

export interface RunFromPhaseRequest {
  trace_id: string
  year: number
  session_cm_ids: number[]
  dry_run?: boolean
}

export interface RunFullTraceRequest {
  original_request_ids: string[]
  year: number
  session_cm_ids: number[]
  dry_run?: boolean
}

export interface TogglePinResponse {
  pinned: boolean
}
