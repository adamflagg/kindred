/**
 * Application-specific types for UI components and transformations
 * These types compose, extend, or alias the auto-generated PocketBase types
 */

import type {
  BunksResponse,
  CampSessionsResponse,
  AttendeesResponse,
  SavedScenariosResponse,
} from './pocketbase-types'

/**
 * UI representation of a camper that combines data from multiple tables
 * Used throughout the frontend for displaying and managing camper information
 */
export interface Camper {
  id: string // Composite ID: "person_id:session_id"
  attendee_id?: string // PocketBase attendee ID if needed
  name: string
  age: number
  grade: number
  gender: 'M' | 'F' | 'NB'
  session_cm_id: number // CampMinder session ID
  assigned_bunk_cm_id?: number // CampMinder bunk ID
  assigned_bunk?: string // PocketBase bunk ID relation
  person_cm_id: number // CampMinder person ID
  created: string
  updated: string
  // Additional fields from CampMinder
  first_name?: string
  last_name?: string
  preferred_name?: string
  birthdate?: string
  years_at_camp?: number
  last_year_attended?: number
  school?: string
  pronouns?: string
  email?: string
  parent_email?: string
  phone?: string
  tags?: string[]
  socialize_with_best?: string
  socialize_with_best_explain?: string
  // Additional V2 fields
  lead_date?: string
  tshirt_size?: string
  camp_grade_name?: string
  school_grade_name?: string
  // V2 Schema fields
  gender_identity_id?: number
  gender_identity_name?: string
  gender_identity_write_in?: string
  gender_pronoun_id?: number
  gender_pronoun_name?: string
  gender_pronoun_write_in?: string
  household_id?: number
  primary_household_id?: string
  alternate_household_id?: string
  external_id?: string
  primary_email?: string
  secondary_email?: string
  bunking_requests?: Array<{
    id?: string
    type?: string
    requested_person_id?: number
    priority?: number
    [key: string]: unknown
  }> // Array of bunking requests
  custom_fields?: Record<string, unknown>
  attendee_status?: string
  attendee_created?: string
  attendee_updated?: string
  last_updated_utc?: string
  // Expanded fields
  expand?: {
    session?: CampSessionsResponse | null
    assigned_bunk?: BunksResponse | null
    tags?: Array<{
      id: string
      name: string
      category: string | null
      is_seasonal?: boolean
    }>
    person_tag_assignments?: Array<{
      id: string
      expand?: {
        tag?: {
          id: string
          name: string
          category: string | null
          is_seasonal?: boolean
        }
      }
    }>
    attendee?: AttendeesResponse
  }
}

/**
 * Session type — direct alias for PocketBase CampSessionsResponse.
 * Replaces the hand-rolled Session interface that had phantom fields
 * (code, persistent_id) which were always empty strings.
 */
export type Session = CampSessionsResponse

/**
 * Bunk type — PocketBase BunksResponse plus computed capacity.
 * capacity is computed from bunk_plans count, not stored in PB.
 */
export type Bunk = BunksResponse & { capacity?: number }

export interface BunkRequest {
  id: string
  requester_id: number // CampMinder person ID
  requestee_id?: number | null // CampMinder person ID
  request_type: 'bunk_with' | 'not_bunk_with' | 'age_preference'
  priority?: number
  year: number
  session_id: number // CampMinder session ID
  status: 'resolved' | 'pending' | 'declined'
  original_text?: string
  confidence_score?: number
  parse_notes?: string
  socialize_explain?: string
  source_field?: string // CSV field this came from (bunk_with, not_bunk_with, manual, etc.)
  is_reciprocal?: boolean
  priority_locked?: boolean
  manual_notes?: string
  // Age preference specific
  age_preference_target?: string // 'older' or 'younger'
  metadata?: Record<string, unknown> // JSON metadata field
  ai_reasoning?: {
    csv_source_field?: string
    [key: string]: unknown
  }
  // Additional fields from DB
  confidence_level?: string
  keywords_found?: Record<string, unknown>
  can_be_dropped?: boolean
  is_placeholder?: boolean
  requires_manual_review?: boolean
  manual_review_reason?: string
  was_dropped_for_spread?: boolean
  // Merge tracking — empty string or undefined means not merged; non-empty is the PB record ID it was merged into
  merged_into?: string
  created: string
  updated: string
}

export type ConstraintType = 'pair_together' | 'keep_apart' | 'age_preference' | 'bunk_preference'

export interface Constraint {
  id: string
  description: string // Required in DB
  session_id: number // CampMinder session ID
  scope?: 'global' | 'single' | 'pair'
  severity?: 'hard' | 'soft'
  single_camper_id?: number // CampMinder person ID for single constraints
  pair_camper1_id?: number // CampMinder person ID for pair constraints
  pair_camper2_id?: number // CampMinder person ID for pair constraints
  year: number
  created: string
  updated: string
  // Legacy fields for backward compatibility
  constraint_type?: string
  type?: ConstraintType
  session?: string
  campers?: string[]
  metadata?: Record<string, unknown>
  // Expanded fields
  expand?: {
    session?: CampSessionsResponse
    campers?: Camper[]
  }
}

/**
 * SavedScenario — PB SavedScenariosResponse with typed session expand.
 * Not a composite UI type; direct alias for the PB collection.
 */
export type SavedScenario = SavedScenariosResponse<unknown, { session?: CampSessionsResponse }>

/**
 * SolverRun — FastAPI response type, NOT a PocketBase collection.
 * Uses 'completed'/'failed' status (not PB's 'success'/'error' enum).
 * Kept in app-types because it represents a solver API response shape.
 */
export interface SolverRun {
  id: string
  session: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  constraints_snapshot?: Record<string, unknown>
  locked_bunks?: string[]
  results?: {
    assignments: Array<{
      camper_id: string
      bunk_id: string
    }>
    stats: {
      total_campers: number
      assigned_campers: number
      satisfied_constraints: number
      total_constraints: number
      solve_time_ms: number
      // Request-based stats (newer API)
      satisfied_request_count?: number
      total_requests?: number
      request_validation?: {
        impossible_requests: number
        affected_campers: number
      }
    }
  }
  error_message?: string
  started_at?: string
  completed_at?: string
  created: string
  updated: string
}

// UI-specific types
export interface DragItem {
  id: string
  type: 'camper'
  camper: Camper
  sourceBunkId?: string
}

export interface BunkWithCampers extends Bunk {
  campers: Camper[]
  occupancy: number
  utilization: number
}
