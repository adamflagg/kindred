/**
 * Application-specific types for UI components and transformations
 * These types compose, extend, or alias the auto-generated PocketBase types
 *
 * Hand-written cache/API shapes carry `readonly` fields (and `readonly T[]` /
 * `Readonly<Record>` on collections): these flow through the React Query cache
 * and dozens of components, so the compiler forbids accidental in-place
 * mutation of a shared instance. Defensive copies (`[...arr]`, `.map(...)`) are
 * unaffected; the generated PB aliases (`Session`, `Bunk`, `SavedScenario`)
 * are intentionally left mutable — their immutability belongs in codegen.
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
  readonly id: string // Composite ID: "person_id:session_id"
  readonly attendee_id?: string // PocketBase attendee ID if needed
  readonly name: string
  readonly age: number
  readonly grade: number
  readonly gender: 'M' | 'F' | 'NB'
  readonly session_cm_id: number // CampMinder session ID
  readonly assigned_bunk_cm_id?: number // CampMinder bunk ID
  readonly assigned_bunk?: string // PocketBase bunk ID relation
  readonly person_cm_id: number // CampMinder person ID
  readonly created: string
  readonly updated: string
  // Additional fields from CampMinder
  readonly first_name?: string
  readonly last_name?: string
  readonly preferred_name?: string
  readonly birthdate?: string
  readonly years_at_camp?: number
  readonly last_year_attended?: number
  readonly school?: string
  readonly pronouns?: string
  readonly email?: string
  readonly parent_email?: string
  readonly phone?: string
  readonly tags?: readonly string[]
  readonly socialize_with_best?: string
  readonly socialize_with_best_explain?: string
  // Additional V2 fields
  readonly lead_date?: string
  readonly tshirt_size?: string
  readonly camp_grade_name?: string
  readonly school_grade_name?: string
  // V2 Schema fields
  readonly gender_identity_id?: number
  readonly gender_identity_name?: string
  readonly gender_identity_write_in?: string
  readonly gender_pronoun_id?: number
  readonly gender_pronoun_name?: string
  readonly gender_pronoun_write_in?: string
  readonly household_id?: number
  readonly primary_household_id?: string
  readonly alternate_household_id?: string
  readonly external_id?: string
  readonly primary_email?: string
  readonly secondary_email?: string
  readonly bunking_requests?: readonly {
    readonly id?: string
    readonly type?: string
    readonly requested_person_id?: number
    readonly is_first_requested?: boolean
    readonly [key: string]: unknown
  }[] // Array of bunking requests
  readonly custom_fields?: Readonly<Record<string, unknown>>
  readonly attendee_status?: string
  readonly attendee_created?: string
  readonly attendee_updated?: string
  readonly last_updated_utc?: string
  // Expanded fields
  readonly expand?: {
    readonly session?: CampSessionsResponse | null
    readonly assigned_bunk?: BunksResponse | null
    readonly tags?: readonly {
      readonly id: string
      readonly name: string
      readonly category: string | null
      readonly is_seasonal?: boolean
    }[]
    readonly person_tag_assignments?: readonly {
      readonly id: string
      readonly expand?: {
        readonly tag?: {
          readonly id: string
          readonly name: string
          readonly category: string | null
          readonly is_seasonal?: boolean
        }
      }
    }[]
    readonly attendee?: AttendeesResponse
  }
}

/**
 * Session type — direct alias for PocketBase CampSessionsResponse.
 * Replaces the hand-rolled Session interface that had phantom fields
 * (code, persistent_id) which were always empty strings.
 */
export type Session = CampSessionsResponse

/**
 * Bunk type — direct alias for PocketBase BunksResponse.
 *
 * Note: there is no per-bunk capacity stored anywhere. Capacity is treated as
 * a uniform `DEFAULT_BUNK_CAPACITY` (see `utils/capacityConstants`) at every
 * reader site. If per-bunk capacity is ever introduced, model it on the bunks
 * collection rather than re-adding a phantom optional field here.
 */
export type Bunk = BunksResponse

export interface BunkRequest {
  readonly id: string
  readonly requester_id: number // CampMinder person ID
  readonly requestee_id?: number | null // CampMinder person ID
  readonly request_type: 'bunk_with' | 'not_bunk_with' | 'age_preference'
  readonly is_first_requested?: boolean
  readonly year: number
  readonly session_id: number // CampMinder session ID
  readonly status: 'resolved' | 'pending' | 'declined'
  readonly original_text?: string
  readonly confidence_score?: number
  readonly parse_notes?: string
  readonly socialize_explain?: string
  readonly source_field?: string // CSV field this came from (bunk_with, not_bunk_with, manual, etc.)
  readonly is_reciprocal?: boolean
  readonly manual_notes?: string
  // Age preference specific
  readonly age_preference_target?: string // 'older' or 'younger'
  readonly metadata?: Readonly<Record<string, unknown>> // JSON metadata field
  readonly ai_reasoning?: {
    readonly csv_source_field?: string
    readonly [key: string]: unknown
  }
  // Additional fields from DB
  readonly confidence_level?: string
  readonly keywords_found?: Readonly<Record<string, unknown>>
  readonly can_be_dropped?: boolean
  readonly is_placeholder?: boolean
  readonly requires_manual_review?: boolean
  readonly manual_review_reason?: string
  readonly was_dropped_for_spread?: boolean
  // Merge tracking — empty string or undefined means not merged; non-empty is the PB record ID it was merged into
  readonly merged_into?: string
  readonly created: string
  readonly updated: string
}

export type ConstraintType = 'pair_together' | 'keep_apart' | 'age_preference' | 'bunk_preference'

export interface Constraint {
  readonly id: string
  readonly description: string // Required in DB
  readonly session_id: number // CampMinder session ID
  readonly scope?: 'global' | 'single' | 'pair'
  readonly severity?: 'hard' | 'soft'
  readonly single_camper_id?: number // CampMinder person ID for single constraints
  readonly pair_camper1_id?: number // CampMinder person ID for pair constraints
  readonly pair_camper2_id?: number // CampMinder person ID for pair constraints
  readonly year: number
  readonly created: string
  readonly updated: string
  // Legacy fields for backward compatibility
  readonly constraint_type?: string
  readonly type?: ConstraintType
  readonly session?: string
  readonly campers?: readonly string[]
  readonly metadata?: Readonly<Record<string, unknown>>
  // Expanded fields
  readonly expand?: {
    readonly session?: CampSessionsResponse
    readonly campers?: readonly Camper[]
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
  readonly id: string
  readonly session: string
  readonly status: 'pending' | 'running' | 'completed' | 'failed'
  readonly constraints_snapshot?: Readonly<Record<string, unknown>>
  readonly locked_bunks?: readonly string[]
  readonly results?: {
    readonly assignments: readonly {
      readonly camper_id: string
      readonly bunk_id: string
    }[]
    readonly stats: {
      readonly total_campers: number
      readonly assigned_campers: number
      readonly satisfied_constraints: number
      readonly total_constraints: number
      readonly solve_time_ms: number
      // Request-based stats (newer API)
      readonly satisfied_request_count?: number
      readonly total_requests?: number
      readonly request_validation?: {
        readonly impossible_requests: number
        readonly affected_campers: number
      }
    }
  }
  readonly error_message?: string
  readonly started_at?: string
  readonly completed_at?: string
  readonly created: string
  readonly updated: string
}

// UI-specific types
export interface DragItem {
  readonly id: string
  readonly type: 'camper'
  readonly camper: Camper
  readonly sourceBunkId?: string
}

export interface BunkWithCampers extends Bunk {
  readonly campers: readonly Camper[]
  readonly occupancy: number
  readonly utilization: number
}
