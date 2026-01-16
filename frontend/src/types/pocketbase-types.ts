/**
* This file was @generated using pocketbase-typegen
*/

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export enum Collections {
	Authorigins = "_authOrigins",
	Externalauths = "_externalAuths",
	Mfas = "_mfas",
	Otps = "_otps",
	Superusers = "_superusers",
	Attendees = "attendees",
	BunkAssignments = "bunk_assignments",
	BunkAssignmentsDraft = "bunk_assignments_draft",
	BunkPlans = "bunk_plans",
	BunkRequests = "bunk_requests",
	Bunks = "bunks",
	CampSessions = "camp_sessions",
	Config = "config",
	ConfigSections = "config_sections",
	LockedGroupMembers = "locked_group_members",
	LockedGroups = "locked_groups",
	OriginalBunkRequests = "original_bunk_requests",
	Persons = "persons",
	SavedScenarios = "saved_scenarios",
	SolverRuns = "solver_runs",
	Users = "users",
}

// Alias types for improved usability
export type IsoDateString = string
export type RecordIdString = string
export type HTMLString = string

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T }

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString
	collectionId: string
	collectionName: Collections
} & ExpandType<T>

export type AuthSystemFields<T = unknown> = {
	email: string
	emailVisibility: boolean
	username: string
	verified: boolean
} & BaseSystemFields<T>

// Record types for each collection

export interface AuthoriginsRecord {
	collectionRef: string
	created?: IsoDateString
	fingerprint: string
	id: string
	recordRef: string
	updated?: IsoDateString
}

export interface ExternalauthsRecord {
	collectionRef: string
	created?: IsoDateString
	id: string
	provider: string
	providerId: string
	recordRef: string
	updated?: IsoDateString
}

export interface MfasRecord {
	collectionRef: string
	created?: IsoDateString
	id: string
	method: string
	recordRef: string
	updated?: IsoDateString
}

export interface OtpsRecord {
	collectionRef: string
	created?: IsoDateString
	id: string
	password: string
	recordRef: string
	sentTo?: string
	updated?: IsoDateString
}

export interface SuperusersRecord {
	created?: IsoDateString
	email: string
	emailVisibility?: boolean
	id: string
	password: string
	tokenKey: string
	updated?: IsoDateString
	verified?: boolean
}

export enum AttendeesStatusOptions {
	"enrolled" = "enrolled",
	"applied" = "applied",
	"waitlisted" = "waitlisted",
	"left_early" = "left_early",
	"cancelled" = "cancelled",
	"dismissed" = "dismissed",
	"inquiry" = "inquiry",
	"withdrawn" = "withdrawn",
	"incomplete" = "incomplete",
	"unknown" = "unknown",
}
export interface AttendeesRecord {
	created?: IsoDateString
	enrollment_date?: IsoDateString
	id: string
	is_active?: boolean
	person?: RecordIdString
	person_id: number
	session: RecordIdString
	status?: AttendeesStatusOptions
	status_id?: number
	updated?: IsoDateString
	year: number
}

export interface BunkAssignmentsRecord {
	bunk?: RecordIdString
	bunk_plan?: RecordIdString
	cm_id?: number
	created?: IsoDateString
	id: string
	person?: RecordIdString
	session?: RecordIdString
	updated?: IsoDateString
	year: number
}

export interface BunkAssignmentsDraftRecord {
	assignment_locked?: boolean
	bunk?: RecordIdString
	bunk_plan?: RecordIdString
	created?: IsoDateString
	id: string
	person?: RecordIdString
	scenario?: RecordIdString
	session?: RecordIdString
	updated?: IsoDateString
	year: number
}

export interface BunkPlansRecord {
	bunk: RecordIdString
	cm_id: number
	code?: string
	created?: IsoDateString
	id: string
	name: string
	session: RecordIdString
	updated?: IsoDateString
	year: number
}

export enum BunkRequestsRequestTypeOptions {
	"bunk_with" = "bunk_with",
	"not_bunk_with" = "not_bunk_with",
	"age_preference" = "age_preference",
}

export enum BunkRequestsStatusOptions {
	"resolved" = "resolved",
	"pending" = "pending",
	"declined" = "declined",
}

export enum BunkRequestsSourceOptions {
	"family" = "family",
	"staff" = "staff",
	"notes" = "notes",
}
export interface BunkRequestsRecord<Tai_p1_reasoning = unknown, Tai_p3_reasoning = unknown, Tconfidence_explanation = unknown, Tkeywords_found = unknown, Tmetadata = unknown> {
	age_preference_target?: string
	ai_p1_reasoning?: null | Tai_p1_reasoning
	ai_p3_reasoning?: null | Tai_p3_reasoning
	ai_parsed?: boolean
	can_be_dropped?: boolean
	confidence_explanation?: null | Tconfidence_explanation
	confidence_level?: string
	confidence_score?: number
	conflict_group_id?: string
	created?: IsoDateString
	csv_position?: number
	id: string
	is_active?: boolean
	is_placeholder?: boolean
	is_reciprocal?: boolean
	keywords_found?: null | Tkeywords_found
	manual_review_reason?: string
	merged_into?: string
	metadata?: null | Tmetadata
	original_text?: string
	parse_notes?: string
	priority?: number
	request_locked?: boolean
	request_type: BunkRequestsRequestTypeOptions
	requestee_id?: number
	requested_person_name?: string
	requester_id: number
	requires_family_decision?: boolean
	requires_manual_review?: boolean
	resolution_notes?: string
	session_id: number
	source?: BunkRequestsSourceOptions
	source_detail?: string
	source_field?: string
	source_fields?: string[]
	status: BunkRequestsStatusOptions
	updated?: IsoDateString
	was_dropped_for_spread?: boolean
	year: number
}

export interface BunksRecord {
	cm_id: number
	created?: IsoDateString
	gender?: string
	id: string
	name: string
	updated?: IsoDateString
	year: number
}

export enum CampSessionsSessionTypeOptions {
	"main" = "main",
	"embedded" = "embedded",
	"ag" = "ag",
	"family" = "family",
	"quest" = "quest",
	"training" = "training",
	"bmitzvah" = "bmitzvah",
	"tli" = "tli",
	"adult" = "adult",
	"school" = "school",
	"hebrew" = "hebrew",
	"teen" = "teen",
	"other" = "other",
}
export interface CampSessionsRecord {
	cm_id: number
	created?: IsoDateString
	end_date: IsoDateString
	id: string
	name: string
	parent_id?: number
	session_type: CampSessionsSessionTypeOptions
	start_date: IsoDateString
	updated?: IsoDateString
	year: number
}

export interface ConfigRecord<Tmetadata = unknown, Tvalue = unknown> {
	category: string
	config_key: string
	created?: IsoDateString
	description?: string
	id: string
	metadata?: null | Tmetadata
	subcategory?: string
	updated?: IsoDateString
	value: null | Tvalue
}

export interface ConfigSectionsRecord {
	created?: IsoDateString
	description?: string
	display_order: number
	expanded_by_default?: boolean
	id: string
	section_key: string
	title: string
	updated?: IsoDateString
}

export interface LockedGroupMembersRecord {
	added_by?: string
	attendee: string // relation to attendees
	group: string // relation to locked_groups
}

export interface LockedGroupsRecord {
	color: string
	created_by?: string
	name?: string // optional friendly name for the group
	scenario: string // relation to saved_scenarios
	session: string // relation to camp_sessions
	year: number
}

export enum OriginalBunkRequestsFieldOptions {
	"bunk_with" = "bunk_with",
	"not_bunk_with" = "not_bunk_with",
	"bunking_notes" = "bunking_notes",
	"internal_notes" = "internal_notes",
	"socialize_with" = "socialize_with",
}
export interface OriginalBunkRequestsRecord {
	content: string
	created?: IsoDateString
	field: OriginalBunkRequestsFieldOptions
	id: string
	processed?: IsoDateString
	requester: RecordIdString
	updated?: IsoDateString
	year: number
}

export interface PersonsRecord<Taddress = unknown, Temail_addresses = unknown, Tphone_numbers = unknown, Traw_data = unknown> {
	address?: null | Taddress
	age?: number
	birthdate?: string
	cm_id: number
	created?: IsoDateString
	email_addresses?: null | Temail_addresses
	first_name: string
	gender?: string
	gender_identity_id?: number
	gender_identity_name?: string
	gender_identity_write_in?: string
	gender_pronoun_id?: number
	gender_pronoun_name?: string
	gender_pronoun_write_in?: string
	grade?: number
	household_id?: number
	id: string
	is_camper?: boolean
	last_name: string
	last_year_attended?: number
	phone_numbers?: null | Tphone_numbers
	preferred_name?: string
	raw_data?: null | Traw_data
	school?: string
	updated?: IsoDateString
	year: number
	years_at_camp?: number
}

export interface SavedScenariosRecord<Tmetadata = unknown> {
	created?: IsoDateString
	description?: string
	id: string
	is_active?: boolean
	metadata?: null | Tmetadata
	name: string
	session: RecordIdString
	year: number
	updated?: IsoDateString
}

export enum SolverRunsStatusOptions {
	"pending" = "pending",
	"running" = "running",
	"success" = "success",
	"failed" = "failed",
	"error" = "error",
}
export interface SolverRunsRecord<Tassignment_counts = unknown, Tdetails = unknown, Terror = unknown, Tlogs = unknown, Trequest_data = unknown, Tresult = unknown, Tstats = unknown> {
	assignment_counts?: null | Tassignment_counts
	completed_at?: IsoDateString
	created?: IsoDateString
	details?: null | Tdetails
	error?: null | Terror
	id: string
	logs?: null | Tlogs
	progress?: number
	request_data?: null | Trequest_data
	result?: null | Tresult
	run_id: string
	run_type?: string
	scenario?: RecordIdString  // Relation to saved_scenarios
	session: string
	session_id?: number
	started_at?: IsoDateString
	stats?: null | Tstats
	status?: SolverRunsStatusOptions
	triggered_by?: string
	updated?: IsoDateString
}

export interface UsersRecord {
	avatar?: string
	created?: IsoDateString
	email: string
	emailVisibility?: boolean
	id: string
	name?: string
	password: string
	tokenKey: string
	updated?: IsoDateString
	verified?: boolean
}

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> & BaseSystemFields<Texpand>
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> & BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> & AuthSystemFields<Texpand>
export type AttendeesResponse<Texpand = unknown> = Required<AttendeesRecord> & BaseSystemFields<Texpand>
export type BunkAssignmentsResponse<Texpand = unknown> = Required<BunkAssignmentsRecord> & BaseSystemFields<Texpand>
export type BunkAssignmentsDraftResponse<Texpand = unknown> = Required<BunkAssignmentsDraftRecord> & BaseSystemFields<Texpand>
export type BunkPlansResponse<Texpand = unknown> = Required<BunkPlansRecord> & BaseSystemFields<Texpand>
export type BunkRequestsResponse<Tai_p1_reasoning = unknown, Tai_p3_reasoning = unknown, Tconfidence_explanation = unknown, Tkeywords_found = unknown, Tmetadata = unknown, Texpand = unknown> = Required<BunkRequestsRecord<Tai_p1_reasoning, Tai_p3_reasoning, Tconfidence_explanation, Tkeywords_found, Tmetadata>> & BaseSystemFields<Texpand>
export type BunksResponse<Texpand = unknown> = Required<BunksRecord> & BaseSystemFields<Texpand>
export type CampSessionsResponse<Texpand = unknown> = Required<CampSessionsRecord> & BaseSystemFields<Texpand>
export type ConfigResponse<Tmetadata = unknown, Tvalue = unknown, Texpand = unknown> = Required<ConfigRecord<Tmetadata, Tvalue>> & BaseSystemFields<Texpand>
export type ConfigSectionsResponse<Texpand = unknown> = Required<ConfigSectionsRecord> & BaseSystemFields<Texpand>
export type LockedGroupMembersResponse<Texpand = unknown> = Required<LockedGroupMembersRecord> & BaseSystemFields<Texpand>
export type LockedGroupsResponse<Texpand = unknown> = Required<LockedGroupsRecord> & BaseSystemFields<Texpand>
export type OriginalBunkRequestsResponse<Texpand = unknown> = Required<OriginalBunkRequestsRecord> & BaseSystemFields<Texpand>
export type PersonsResponse<Taddress = unknown, Temail_addresses = unknown, Tphone_numbers = unknown, Traw_data = unknown, Texpand = unknown> = Required<PersonsRecord<Taddress, Temail_addresses, Tphone_numbers, Traw_data>> & BaseSystemFields<Texpand>
export type SavedScenariosResponse<Tmetadata = unknown, Texpand = unknown> = Required<SavedScenariosRecord<Tmetadata>> & BaseSystemFields<Texpand>
export type SolverRunsResponse<Tassignment_counts = unknown, Tdetails = unknown, Terror = unknown, Tlogs = unknown, Trequest_data = unknown, Tresult = unknown, Tstats = unknown, Texpand = unknown> = Required<SolverRunsRecord<Tassignment_counts, Tdetails, Terror, Tlogs, Trequest_data, Tresult, Tstats>> & BaseSystemFields<Texpand>
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> & AuthSystemFields<Texpand>

// Types containing all Records and Responses, useful for creating typing helper functions

export interface CollectionRecords {
	_authOrigins: AuthoriginsRecord
	_externalAuths: ExternalauthsRecord
	_mfas: MfasRecord
	_otps: OtpsRecord
	_superusers: SuperusersRecord
	attendees: AttendeesRecord
	bunk_assignments: BunkAssignmentsRecord
	bunk_assignments_draft: BunkAssignmentsDraftRecord
	bunk_plans: BunkPlansRecord
	bunk_requests: BunkRequestsRecord
	bunks: BunksRecord
	camp_sessions: CampSessionsRecord
	config: ConfigRecord
	config_sections: ConfigSectionsRecord
	locked_group_members: LockedGroupMembersRecord
	locked_groups: LockedGroupsRecord
	original_bunk_requests: OriginalBunkRequestsRecord
	persons: PersonsRecord
	saved_scenarios: SavedScenariosRecord
	solver_runs: SolverRunsRecord
	users: UsersRecord
}

export interface CollectionResponses {
	_authOrigins: AuthoriginsResponse
	_externalAuths: ExternalauthsResponse
	_mfas: MfasResponse
	_otps: OtpsResponse
	_superusers: SuperusersResponse
	attendees: AttendeesResponse
	bunk_assignments: BunkAssignmentsResponse
	bunk_assignments_draft: BunkAssignmentsDraftResponse
	bunk_plans: BunkPlansResponse
	bunk_requests: BunkRequestsResponse
	bunks: BunksResponse
	camp_sessions: CampSessionsResponse
	config: ConfigResponse
	config_sections: ConfigSectionsResponse
	locked_group_members: LockedGroupMembersResponse
	locked_groups: LockedGroupsResponse
	original_bunk_requests: OriginalBunkRequestsResponse
	persons: PersonsResponse
	saved_scenarios: SavedScenariosResponse
	solver_runs: SolverRunsResponse
	users: UsersResponse
}

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = PocketBase & {
	collection(idOrName: '_authOrigins'): RecordService<AuthoriginsResponse>
	collection(idOrName: '_externalAuths'): RecordService<ExternalauthsResponse>
	collection(idOrName: '_mfas'): RecordService<MfasResponse>
	collection(idOrName: '_otps'): RecordService<OtpsResponse>
	collection(idOrName: '_superusers'): RecordService<SuperusersResponse>
	collection(idOrName: 'attendees'): RecordService<AttendeesResponse>
	collection(idOrName: 'bunk_assignments'): RecordService<BunkAssignmentsResponse>
	collection(idOrName: 'bunk_assignments_draft'): RecordService<BunkAssignmentsDraftResponse>
	collection(idOrName: 'bunk_plans'): RecordService<BunkPlansResponse>
	collection(idOrName: 'bunk_requests'): RecordService<BunkRequestsResponse>
	collection(idOrName: 'bunks'): RecordService<BunksResponse>
	collection(idOrName: 'camp_sessions'): RecordService<CampSessionsResponse>
	collection(idOrName: 'config'): RecordService<ConfigResponse>
	collection(idOrName: 'config_sections'): RecordService<ConfigSectionsResponse>
	collection(idOrName: 'locked_group_members'): RecordService<LockedGroupMembersResponse>
	collection(idOrName: 'locked_groups'): RecordService<LockedGroupsResponse>
	collection(idOrName: 'original_bunk_requests'): RecordService<OriginalBunkRequestsResponse>
	collection(idOrName: 'persons'): RecordService<PersonsResponse>
	collection(idOrName: 'saved_scenarios'): RecordService<SavedScenariosResponse>
	collection(idOrName: 'solver_runs'): RecordService<SolverRunsResponse>
	collection(idOrName: 'users'): RecordService<UsersResponse>
}
