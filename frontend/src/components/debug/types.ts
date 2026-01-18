/**
 * TypeScript types for debug components
 */

export type SourceFieldType = 'bunk_with' | 'not_bunk_with' | 'bunking_notes' | 'internal_notes';

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

export interface OriginalRequestItem {
  id: string;
  requester_name: string | null;
  requester_cm_id: number | null;
  source_field: string;
  original_text: string;
  year: number;
  processed: boolean;
}

// New types for fallback pattern
export type ParseResultSource = 'debug' | 'production' | 'none';

export interface OriginalRequestWithStatus {
  id: string;
  requester_name: string | null;
  requester_cm_id: number | null;
  source_field: string;
  original_text: string;
  year: number;
  has_debug_result: boolean;
  has_production_result: boolean;
}

export interface ParseResultWithSource {
  source: ParseResultSource;
  id: string | null;
  original_request_id: string | null;
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

export const SOURCE_FIELD_LABELS: Record<SourceFieldType, string> = {
  bunk_with: 'Bunk With',
  not_bunk_with: 'Not Bunk With',
  bunking_notes: 'Bunking Notes',
  internal_notes: 'Internal Notes',
};

// Types for grouped-by-camper view (Phase 5)
export interface FieldParseResult {
  original_request_id: string;
  source_field: string;
  original_text: string;
  has_debug_result: boolean;
  has_production_result: boolean;
}

export interface CamperGroupedRequests {
  requester_cm_id: number;
  requester_name: string;
  fields: FieldParseResult[];
}

export interface GroupedRequestsResponse {
  items: CamperGroupedRequests[];
  total: number;
}

export const REQUEST_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  bunk_with: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  not_bunk_with: {
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    text: 'text-rose-700 dark:text-rose-400',
    border: 'border-rose-200 dark:border-rose-800',
  },
  bunking_notes: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
  },
  internal_notes: {
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    text: 'text-violet-700 dark:text-violet-400',
    border: 'border-violet-200 dark:border-violet-800',
  },
  unknown: {
    bg: 'bg-slate-50 dark:bg-slate-950/30',
    text: 'text-slate-700 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-800',
  },
};
