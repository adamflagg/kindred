/**
 * Shared types for camper hooks
 */

import type { PersonsResponse } from '../../types/pocketbase-types';

// Historical camp record
export interface HistoricalRecord {
  year: number;
  sessionName: string;
  sessionType: string;
  bunkName: string;
  startDate?: string;
  endDate?: string;
}

// Original CSV bunk data structure
export interface OriginalBunkData {
  share_bunk_with?: string;
  share_bunk_with_updated?: string;
  share_bunk_with_processed?: string;
  do_not_share_bunk_with?: string;
  do_not_share_bunk_with_updated?: string;
  do_not_share_bunk_with_processed?: string;
  internal_bunk_notes?: string;
  internal_bunk_notes_updated?: string;
  internal_bunk_notes_processed?: string;
  bunking_notes_notes?: string;
  bunking_notes_notes_updated?: string;
  bunking_notes_notes_processed?: string;
  ret_parent_socialize_with_best?: string;
  ret_parent_socialize_with_best_updated?: string;
  ret_parent_socialize_with_best_processed?: string;
  first_name?: string;
  last_name?: string;
  person_cm_id?: number;
}

// Satisfaction check types
export type SatisfactionStatus = 'satisfied' | 'not_satisfied' | 'checking' | 'unknown';

export interface SatisfactionResult {
  status: SatisfactionStatus;
  detail?: string;
}

export type SatisfactionMap = Record<string, SatisfactionResult>;

// Sibling with enrollment info
export interface SiblingWithEnrollment extends PersonsResponse {
  session?: {
    id: string;
    cm_id: number;
    name: string;
    session_type: string;
    start_date?: string;
    end_date?: string;
  };
  bunkName?: string | null;
}
