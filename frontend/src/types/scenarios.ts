// Types for Enhanced Hybrid Scenario Planning

import type { Session } from './app-types';
import type { AttendeesResponse, BunkPlansResponse } from './pocketbase-types';

export interface ScenarioMetrics {
  id: string;
  scenario_name: string;
  total_campers: number;
  
  // Request satisfaction
  requests_satisfied: number;
  requests_total: number;
  satisfaction_rate: number;
  
  // Detailed request breakdowns
  together_requests_met: number;
  together_requests_total: number;
  apart_requests_met: number;
  apart_requests_total: number;
  
  // Age/Grade cohesion metrics
  avg_age_variance_per_bunk: number;
  avg_grade_spread_per_bunk: number;
  max_age_spread_in_bunk: number;
  max_grade_spread_in_bunk: number;
  
  // Bunk utilization
  bunks_used: number;
  total_bunks: number;
  avg_occupancy_rate: number;
  min_occupancy: number;
  max_occupancy: number;
  unassigned_campers: number;
  
  // Constraint violations
  hard_constraints_violated: number;
  soft_constraints_violated: number;
  
  // Timing
  calculation_time_ms?: number;
}

export interface BunkAssignmentDraft {
  id: string;
  attendee: string;
  bunk_plan: string;
  draft_session_id: string;
  assigned_date?: string;
  is_locked?: boolean;
  assigned_by?: string;
  created: string;
  updated: string;
  // Expanded fields
  expand?: {
    attendee?: AttendeesResponse;
    bunk_plan?: BunkPlansResponse;
  };
}

export interface SavedScenario {
  id: string;
  name: string;
  description?: string;
  session: string;
  year: number;  // Year for filtering
  created_by?: string;
  status?: 'draft' | 'review' | 'approved' | 'implemented' | 'archived';
  assignments: BunkAssignmentData[]; // Stored as JSON
  metrics?: ScenarioMetrics; // Pre-calculated metrics stored as JSON
  snapshot_date?: string;
  created: string;
  updated: string;
  // Expanded fields
  expand?: {
    session?: Session;
  };
}

export interface BunkAssignmentData {
  attendee_id: string;
  bunk_plan_id: string;
  is_locked: boolean;
}

export interface PlanningSession {
  id: string;
  session: string;
  is_active: boolean;
  started_by?: string;
  started_at?: string;
  last_modified?: string;
  created: string;
  updated: string;
  // Expanded fields
  expand?: {
    session?: Session;
  };
}

export interface ScenarioComparison {
  base_scenario: {
    name: string;
    metrics: ScenarioMetrics;
  };
  compared_scenarios: Array<{
    name: string;
    metrics: ScenarioMetrics;
    diff_from_base: {
      satisfaction_rate_change: number;
      together_requests_change: number;
      apart_requests_change: number;
      unassigned_change: number;
    };
  }>;
}

// Request types for scenario planning
export interface RequestSatisfactionDetail {
  request_id: string;
  request_type: 'pair_together' | 'keep_apart';
  camper_ids: string[];
  is_satisfied: boolean;
  reason?: string; // Why it wasn't satisfied
}

export interface BunkCohesionDetail {
  bunk_id: string;
  bunk_name: string;
  camper_count: number;
  age_range: { min: number; max: number; avg: number; variance: number };
  grade_range: { min: number; max: number; avg: number; spread: number };
}

// Planning mode state
export type PlanningMode = 'view' | 'draft' | 'compare';

export interface PlanningState {
  mode: PlanningMode;
  sessionId: string;
  isDirty: boolean; // Has unsaved changes
  draftSessionId?: string; // Unique ID for current draft session
  selectedScenarios?: string[]; // For comparison mode
}