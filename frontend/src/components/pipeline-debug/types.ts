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
  result: 'not_needed' | 'resolved' | 'no_match' | 'invalid_ai_output' | 'still_ambiguous'
  confidence_before: number | null
  confidence_after: number | null
  // JW reranker metadata (optional for backward compat with old traces)
  reranked?: boolean
  jw_score?: number | null
  ai_confidence?: number | null
  no_match_signal?: boolean
}

export interface FinalBunkRequestTrace {
  bunk_request_id: string | null
  requester_cm_id: number
  requested_cm_id: number | null
  requested_name: string | null
  request_type: string
  status: string
  confidence: number
  resolution_method: string
  declined_reason: string | null
  disposition_reason: string
  is_reciprocal: boolean
}

// ---------------------------------------------------------------------------
// Finalization stage traces — flattened from the former PostPipelineTrace
// (issue #877). `self_reference` lives on DedupSaveTrace to match the UI
// (DedupDetail panel), NOT on BatchSignalsTrace.
// ---------------------------------------------------------------------------

export interface ReciprocalSignal {
  detected: boolean
  boost_applied: boolean
  boost_amount: number | null
  pair_cm_id: number | null
}

export interface SelfReferenceSignal {
  detected: boolean
}

export interface BatchSignalsTrace {
  reciprocal: ReciprocalSignal
}

export interface ConflictDetectionTrace {
  has_conflict: boolean
  details: unknown[]
}

export interface DispositionTrace {
  final_bunk_requests: FinalBunkRequestTrace[]
}

export interface DedupSaveTrace {
  was_duplicate: boolean
  kept_over: string | null
  self_reference: SelfReferenceSignal
}

export interface TraceData {
  pre_phase1: PrePhase1Trace
  phase1_parse: Phase1Trace
  validation: ValidationTrace
  phase2_resolution: Phase2IntentTrace[]
  historical_verification: HistoricalVerificationTrace
  phase3_disambiguation: Phase3IntentTrace[]
  batch_signals: BatchSignalsTrace
  conflict_detection: ConflictDetectionTrace
  disposition: DispositionTrace
  dedup_save: DedupSaveTrace
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
  disposition_reason: string
  is_reciprocal: boolean
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
  /** Free-text search across requester_name and target_name. */
  search?: string
}

// =============================================================================
// Phase Execution Types
// =============================================================================

export type PipelinePhase =
  | 'pre_phase1'
  | 'phase1'
  | 'validation'
  | 'phase2'
  | 'historical'
  | 'phase3'
  | 'post_pipeline'

/** Canonical ordering of pipeline phases, used by canvas and page. */
export const PHASE_ORDER: PipelinePhase[] = [
  'pre_phase1',
  'phase1',
  'validation',
  'phase2',
  'historical',
  'phase3',
  'post_pipeline',
]

// =============================================================================
// Granular Pipeline Stages — 13 stages mapped to 7 PipelinePhases
// =============================================================================

export type PipelineStage =
  // Pre-Processing
  | 'staff_detect'
  | 'na_strip'
  // AI Parse
  | 'phase1_parse'
  // Validation
  | 'type_validation'
  | 'temporal_filter'
  | 'source_text_validation'
  // Resolution
  | 'phase2_resolve'
  | 'historical'
  | 'phase3_disambig'
  // Finalization
  | 'batch_signals'
  | 'conflict_detect'
  | 'disposition'
  | 'dedup_save'

export type StageGroup =
  | 'pre_processing'
  | 'ai_parse'
  | 'validation'
  | 'resolution'
  | 'finalization'

/** Maps each granular stage back to its parent PipelinePhase for trace data access and re-runs. */
export const STAGE_TO_PHASE: Record<PipelineStage, PipelinePhase> = {
  staff_detect: 'pre_phase1',
  na_strip: 'pre_phase1',
  phase1_parse: 'phase1',
  type_validation: 'validation',
  temporal_filter: 'validation',
  source_text_validation: 'validation',
  phase2_resolve: 'phase2',
  historical: 'historical',
  phase3_disambig: 'phase3',
  batch_signals: 'post_pipeline',
  conflict_detect: 'post_pipeline',
  disposition: 'post_pipeline',
  dedup_save: 'post_pipeline',
}

export interface StageGroupConfig {
  id: StageGroup
  label: string
  stages: PipelineStage[]
}

export const STAGE_GROUPS: StageGroupConfig[] = [
  { id: 'pre_processing', label: 'Pre-Processing', stages: ['staff_detect', 'na_strip'] },
  { id: 'ai_parse', label: 'AI Parse', stages: ['phase1_parse'] },
  {
    id: 'validation',
    label: 'Validation',
    stages: ['type_validation', 'temporal_filter', 'source_text_validation'],
  },
  {
    id: 'resolution',
    label: 'Resolution',
    stages: ['phase2_resolve', 'historical', 'phase3_disambig'],
  },
  {
    id: 'finalization',
    label: 'Finalization',
    stages: ['batch_signals', 'conflict_detect', 'disposition', 'dedup_save'],
  },
]

/** Canonical order of all 13 stages. */
export const STAGE_ORDER: PipelineStage[] = STAGE_GROUPS.flatMap((g) => g.stages)

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
  stop_at_phase?: string | null
}

export interface RunFullTraceRequest {
  original_request_ids: string[]
  year: number
  session_cm_ids: number[]
  dry_run?: boolean
  stop_at_phase?: string | null
}

export interface TogglePinResponse {
  pinned: boolean
}

// =============================================================================
// Person Search Types (for New Trace modal)
// =============================================================================

export interface PersonSearchItem {
  cm_id: number
  first_name: string
  last_name: string
  grade: number | null
  sessions: number[]
}

export interface PersonSearchResponse {
  items: PersonSearchItem[]
  total: number
}

// =============================================================================
// Original Request Item (for New Trace modal, matches api/schemas/debug.py)
// =============================================================================

export interface OriginalRequestItem {
  id: string
  requester_name: string
  requester_cm_id: number
  source_field: string
  original_text: string
  year: number
  processed: boolean
}

export interface OriginalRequestsResponse {
  items: OriginalRequestItem[]
  total: number
}
