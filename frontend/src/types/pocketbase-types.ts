/**
 * This file was @generated using pocketbase-typegen
 */

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export const Collections = {
  Authorigins: '_authOrigins',
  Externalauths: '_externalAuths',
  Mfas: '_mfas',
  Otps: '_otps',
  Superusers: '_superusers',
  AttendeeStatusHistory: 'attendee_status_history',
  Attendees: 'attendees',
  BunkAssignments: 'bunk_assignments',
  BunkAssignmentsDraft: 'bunk_assignments_draft',
  BunkPlans: 'bunk_plans',
  BunkRequestSources: 'bunk_request_sources',
  BunkRequests: 'bunk_requests',
  Bunks: 'bunks',
  CampSessions: 'camp_sessions',
  CamperDietary: 'camper_dietary',
  CamperTransportation: 'camper_transportation',
  Config: 'config',
  ConfigSections: 'config_sections',
  CustomFieldDefs: 'custom_field_defs',
  DebugParseResults: 'debug_parse_results',
  DebugPipelineRuns: 'debug_pipeline_runs',
  DebugPipelineSummary: 'debug_pipeline_summary',
  DebugPipelineTraces: 'debug_pipeline_traces',
  Divisions: 'divisions',
  EnrollmentSnapshots: 'enrollment_snapshots',
  FamilyCampAdults: 'family_camp_adults',
  FamilyCampMedical: 'family_camp_medical',
  FamilyCampRegistrations: 'family_camp_registrations',
  FinancialAidApplications: 'financial_aid_applications',
  FinancialCategories: 'financial_categories',
  FinancialTransactions: 'financial_transactions',
  GeoOverrides: 'geo_overrides',
  HouseholdCustomValues: 'household_custom_values',
  HouseholdDemographics: 'household_demographics',
  Households: 'households',
  LockedGroupMembers: 'locked_group_members',
  LockedGroups: 'locked_groups',
  LodgingAreas: 'lodging_areas',
  LodgingAssignmentHistory: 'lodging_assignment_history',
  LodgingAssignments: 'lodging_assignments',
  LodgingAssignmentsDraft: 'lodging_assignments_draft',
  LodgingAvailability: 'lodging_availability',
  LodgingFieldMappings: 'lodging_field_mappings',
  LodgingFriendGroupMembers: 'lodging_friend_group_members',
  LodgingFriendGroups: 'lodging_friend_groups',
  LodgingIngestIssues: 'lodging_ingest_issues',
  LodgingSessionStatus: 'lodging_session_status',
  LodgingSlotMerges: 'lodging_slot_merges',
  LodgingUnitAliases: 'lodging_unit_aliases',
  LodgingUnits: 'lodging_units',
  NormalizedMappings: 'normalized_mappings',
  OriginalBunkRequests: 'original_bunk_requests',
  PaymentMethods: 'payment_methods',
  PersonCustomValues: 'person_custom_values',
  PersonTagDefs: 'person_tag_defs',
  Persons: 'persons',
  QuestRegistrations: 'quest_registrations',
  Roles: 'roles',
  SavedScenarios: 'saved_scenarios',
  SessionGroups: 'session_groups',
  SheetsWorkbooks: 'sheets_workbooks',
  SolverRuns: 'solver_runs',
  Staff: 'staff',
  StaffApplications: 'staff_applications',
  StaffOrgCategories: 'staff_org_categories',
  StaffPositions: 'staff_positions',
  StaffProgramAreas: 'staff_program_areas',
  StaffSkills: 'staff_skills',
  StaffVehicleInfo: 'staff_vehicle_info',
  SyncRuns: 'sync_runs',
  UserRoles: 'user_roles',
  Users: 'users',
} as const
export type Collections = (typeof Collections)[keyof typeof Collections]

// Alias types for improved usability
export type IsoDateString = string
export type IsoAutoDateString = string & { readonly autodate: unique symbol }
export type RecordIdString = string
export type FileNameString = string & { readonly filename: unique symbol }
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

export type AuthoriginsRecord = {
  collectionRef: string
  created: IsoAutoDateString
  fingerprint: string
  id: string
  recordRef: string
  updated: IsoAutoDateString
}

export type ExternalauthsRecord = {
  collectionRef: string
  created: IsoAutoDateString
  id: string
  provider: string
  providerId: string
  recordRef: string
  updated: IsoAutoDateString
}

export type MfasRecord = {
  collectionRef: string
  created: IsoAutoDateString
  id: string
  method: string
  recordRef: string
  updated: IsoAutoDateString
}

export type OtpsRecord = {
  collectionRef: string
  created: IsoAutoDateString
  id: string
  password: string
  recordRef: string
  sentTo?: string
  updated: IsoAutoDateString
}

export type SuperusersRecord = {
  created: IsoAutoDateString
  email: string
  emailVisibility?: boolean
  id: string
  password: string
  tokenKey: string
  updated: IsoAutoDateString
  verified?: boolean
}

export const AttendeeStatusHistoryOldStatusOptions = {
  none: 'none',
  enrolled: 'enrolled',
  applied: 'applied',
  waitlisted: 'waitlisted',
  left_early: 'left_early',
  cancelled: 'cancelled',
  dismissed: 'dismissed',
  inquiry: 'inquiry',
  withdrawn: 'withdrawn',
  incomplete: 'incomplete',
  unknown: 'unknown',
} as const
export type AttendeeStatusHistoryOldStatusOptions =
  (typeof AttendeeStatusHistoryOldStatusOptions)[keyof typeof AttendeeStatusHistoryOldStatusOptions]

export const AttendeeStatusHistoryNewStatusOptions = {
  none: 'none',
  enrolled: 'enrolled',
  applied: 'applied',
  waitlisted: 'waitlisted',
  left_early: 'left_early',
  cancelled: 'cancelled',
  dismissed: 'dismissed',
  inquiry: 'inquiry',
  withdrawn: 'withdrawn',
  incomplete: 'incomplete',
  unknown: 'unknown',
} as const
export type AttendeeStatusHistoryNewStatusOptions =
  (typeof AttendeeStatusHistoryNewStatusOptions)[keyof typeof AttendeeStatusHistoryNewStatusOptions]
export type AttendeeStatusHistoryRecord = {
  detected_at: IsoDateString
  id: string
  new_status: AttendeeStatusHistoryNewStatusOptions
  old_status: AttendeeStatusHistoryOldStatusOptions
  person?: RecordIdString
  person_id: number
  session: RecordIdString
  year: number
}

export const AttendeesStatusOptions = {
  none: 'none',
  enrolled: 'enrolled',
  applied: 'applied',
  waitlisted: 'waitlisted',
  left_early: 'left_early',
  cancelled: 'cancelled',
  dismissed: 'dismissed',
  inquiry: 'inquiry',
  withdrawn: 'withdrawn',
  incomplete: 'incomplete',
  unknown: 'unknown',
} as const
export type AttendeesStatusOptions =
  (typeof AttendeesStatusOptions)[keyof typeof AttendeesStatusOptions]
export type AttendeesRecord = {
  created: IsoAutoDateString
  effective_date?: IsoDateString
  enrollment_date?: IsoDateString
  id: string
  last_updated_utc?: IsoDateString
  person?: RecordIdString
  person_id: number
  session: RecordIdString
  status?: AttendeesStatusOptions
  status_id?: number
  updated: IsoAutoDateString
  year: number
}

export type BunkAssignmentsRecord = {
  bunk: RecordIdString
  bunk_plan?: RecordIdString
  cm_id?: number
  created: IsoAutoDateString
  id: string
  person: RecordIdString
  session: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type BunkAssignmentsDraftRecord = {
  assignment_locked?: boolean
  bunk?: RecordIdString
  bunk_plan?: RecordIdString
  created: IsoAutoDateString
  id: string
  person?: RecordIdString
  scenario?: RecordIdString
  session?: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type BunkPlansRecord = {
  bunk: RecordIdString
  cm_id: number
  code?: string
  created: IsoAutoDateString
  id: string
  is_active?: boolean
  name: string
  session: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type BunkRequestSourcesRecord = {
  bunk_request: RecordIdString
  created: IsoAutoDateString
  id: string
  is_primary?: boolean
  original_request: RecordIdString
  parse_notes?: string
  source_field?: string
}

export const BunkRequestsRequestTypeOptions = {
  bunk_with: 'bunk_with',
  not_bunk_with: 'not_bunk_with',
  age_preference: 'age_preference',
} as const
export type BunkRequestsRequestTypeOptions =
  (typeof BunkRequestsRequestTypeOptions)[keyof typeof BunkRequestsRequestTypeOptions]

export const BunkRequestsStatusOptions = {
  resolved: 'resolved',
  pending: 'pending',
  declined: 'declined',
} as const
export type BunkRequestsStatusOptions =
  (typeof BunkRequestsStatusOptions)[keyof typeof BunkRequestsStatusOptions]
export type BunkRequestsRecord<
  Tai_p1_reasoning = unknown,
  Tai_p3_reasoning = unknown,
  Tconfidence_explanation = unknown,
  Tkeywords_found = unknown,
  Tmetadata = unknown,
  Tsource_fields = unknown,
> = {
  age_preference_target?: string
  ai_p1_reasoning?: null | Tai_p1_reasoning
  ai_p3_reasoning?: null | Tai_p3_reasoning
  ai_parsed?: boolean
  can_be_dropped?: boolean
  confidence_explanation?: null | Tconfidence_explanation
  confidence_level?: string
  confidence_score?: number
  conflict_group_id?: string
  created: IsoAutoDateString
  csv_position?: number
  disposition_reason?: string
  id: string
  is_active?: boolean
  is_first_requested?: boolean
  is_reciprocal?: boolean
  keywords_found?: null | Tkeywords_found
  manual_review_reason?: string
  merged_into?: RecordIdString
  metadata?: null | Tmetadata
  original_text?: string
  parse_notes?: string
  priority_keyword_detected?: boolean
  request_type: BunkRequestsRequestTypeOptions
  requested_person_name?: string
  requestee_id?: number
  requester_id: number
  requires_family_decision?: boolean
  requires_manual_review?: boolean
  resolution_method?: string
  resolution_notes?: string
  session_id: number
  source_detail?: string
  source_field: string
  source_fields?: null | Tsource_fields
  source_fragment?: string
  staff_touched?: boolean
  status: BunkRequestsStatusOptions
  updated: IsoAutoDateString
  was_dropped_for_spread?: boolean
  year: number
}

export type BunksRecord = {
  area_id?: number
  cm_id: number
  created: IsoAutoDateString
  gender?: string
  id: string
  is_active?: boolean
  name: string
  sort_order?: number
  updated: IsoAutoDateString
  year: number
}

export const CampSessionsSessionTypeOptions = {
  main: 'main',
  embedded: 'embedded',
  ag: 'ag',
  family: 'family',
  quest: 'quest',
  scit: 'scit',
  bmitzvah: 'bmitzvah',
  tli: 'tli',
  adult: 'adult',
  school: 'school',
  hebrew: 'hebrew',
  teen: 'teen',
  other: 'other',
} as const
export type CampSessionsSessionTypeOptions =
  (typeof CampSessionsSessionTypeOptions)[keyof typeof CampSessionsSessionTypeOptions]
export type CampSessionsRecord = {
  cm_id: number
  created: IsoAutoDateString
  description?: string
  end_date: IsoDateString
  end_grade_id?: number
  gender_id?: number
  id: string
  is_active?: boolean
  is_day?: boolean
  is_for_adults?: boolean
  is_for_children?: boolean
  is_residential?: boolean
  name: string
  parent_id?: number
  session_group?: RecordIdString
  session_type: CampSessionsSessionTypeOptions
  sort_order?: number
  start_date: IsoDateString
  start_grade_id?: number
  updated: IsoAutoDateString
  year: number
}

export type CamperDietaryRecord = {
  additional_medical?: string
  allergy_info?: string
  created: IsoAutoDateString
  dietary_explanation?: string
  has_allergies?: boolean
  has_dietary_needs?: boolean
  id: string
  person_id: number
  updated: IsoAutoDateString
  year: number
}

export type CamperTransportationRecord = {
  alt_pickup_1_name?: string
  alt_pickup_1_phone?: string
  alt_pickup_1_relationship?: string
  alt_pickup_2_name?: string
  alt_pickup_2_phone?: string
  attendee: RecordIdString
  created: IsoAutoDateString
  dropoff_name?: string
  dropoff_phone?: string
  dropoff_relationship?: string
  from_camp_method?: string
  id: string
  person_id: number
  pickup_name?: string
  pickup_phone?: string
  pickup_relationship?: string
  session_id: number
  to_camp_method?: string
  updated: IsoAutoDateString
  used_legacy_fields?: boolean
  year: number
}

export type ConfigRecord<Tmetadata = unknown, Tvalue = unknown> = {
  category: string
  config_key: string
  created: IsoAutoDateString
  description?: string
  id: string
  metadata?: null | Tmetadata
  subcategory?: string
  updated: IsoAutoDateString
  value: null | Tvalue
}

export type ConfigSectionsRecord = {
  created: IsoAutoDateString
  description?: string
  display_order: number
  expanded_by_default?: boolean
  id: string
  section_key: string
  title: string
  updated: IsoAutoDateString
}

export const CustomFieldDefsDataTypeOptions = {
  None: 'None',
  String: 'String',
  Integer: 'Integer',
  Decimal: 'Decimal',
  Date: 'Date',
  Time: 'Time',
  DateTime: 'DateTime',
  Boolean: 'Boolean',
} as const
export type CustomFieldDefsDataTypeOptions =
  (typeof CustomFieldDefsDataTypeOptions)[keyof typeof CustomFieldDefsDataTypeOptions]

export const CustomFieldDefsPartitionOptions = {
  None: 'None',
  Family: 'Family',
  Alumnus: 'Alumnus',
  Staff: 'Staff',
  Camper: 'Camper',
  Parent: 'Parent',
  Adult: 'Adult',
} as const
export type CustomFieldDefsPartitionOptions =
  (typeof CustomFieldDefsPartitionOptions)[keyof typeof CustomFieldDefsPartitionOptions]
export type CustomFieldDefsRecord = {
  cm_id: number
  created: IsoAutoDateString
  data_type?: CustomFieldDefsDataTypeOptions
  id: string
  is_active?: boolean
  is_array?: boolean
  is_seasonal?: boolean
  name: string
  partition?: CustomFieldDefsPartitionOptions[]
  updated: IsoAutoDateString
}

export type DebugParseResultsRecord<Tai_raw_response = unknown, Tparsed_intents = unknown> = {
  ai_raw_response?: null | Tai_raw_response
  created: IsoAutoDateString
  error_message?: string
  id: string
  is_valid?: boolean
  original_request: RecordIdString
  parsed_intents?: null | Tparsed_intents
  processing_time_ms?: number
  prompt_version?: string
  session?: RecordIdString
  token_count?: number
  updated: IsoAutoDateString
}

export const DebugPipelineRunsTriggerOptions = {
  upload: 'upload',
  scheduled: 'scheduled',
  manual: 'manual',
} as const
export type DebugPipelineRunsTriggerOptions =
  (typeof DebugPipelineRunsTriggerOptions)[keyof typeof DebugPipelineRunsTriggerOptions]
export type DebugPipelineRunsRecord<
  Tsession_breakdown = unknown,
  Tsource_fields = unknown,
  Tstatus_breakdown = unknown,
> = {
  created: IsoAutoDateString
  force?: boolean
  id: string
  limit_param?: number
  pinned?: boolean
  run_id: string
  session?: string
  session_breakdown?: null | Tsession_breakdown
  source_fields?: null | Tsource_fields
  status_breakdown?: null | Tstatus_breakdown
  trace_count?: number
  trigger?: DebugPipelineRunsTriggerOptions
  updated: IsoAutoDateString
  year: number
}

export type DebugPipelineSummaryRecord = {
  ai_reasoning_summary?: string
  bunk_request?: RecordIdString
  created: IsoAutoDateString
  disposition_reason?: string
  final_confidence?: number
  final_status?: string
  id: string
  is_reciprocal?: boolean
  original_request?: RecordIdString
  phase3_triggered?: boolean
  pre_p1_action?: string
  request_type?: string
  requester_cm_id?: number
  requester_name?: string
  resolution_method?: string
  run_id: string
  session_cm_id?: number
  source_field?: string
  target_name?: string
  trace: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type DebugPipelineTracesRecord<Ttrace_data = unknown> = {
  created: IsoAutoDateString
  id: string
  original_request?: RecordIdString
  pinned?: boolean
  requester_cm_id?: number
  run_id: string
  session_cm_id?: number
  source_field?: string
  trace_data?: null | Ttrace_data
  updated: IsoAutoDateString
  year: number
}

export type DivisionsRecord = {
  assign_on_enrollment?: boolean
  capacity?: number
  cm_id: number
  created: IsoAutoDateString
  description?: string
  end_grade_id?: number
  gender_id?: number
  id: string
  name: string
  parent_division?: RecordIdString
  staff_only?: boolean
  start_grade_id?: number
  updated: IsoAutoDateString
}

export type EnrollmentSnapshotsRecord = {
  cancelled_count?: number
  cancelled_female_count?: number
  cancelled_male_count?: number
  enrolled_count?: number
  enrolled_female_count?: number
  enrolled_male_count?: number
  id: string
  session?: RecordIdString
  session_cm_id: number
  snapshot_datetime: IsoDateString
  waitlisted_count?: number
  waitlisted_female_count?: number
  waitlisted_male_count?: number
  year: number
}

export type FamilyCampAdultsRecord<Tattribute_conflicts = unknown> = {
  adult_number: number
  attribute_conflicts?: null | Tattribute_conflicts
  created: IsoAutoDateString
  date_of_birth?: string
  email?: string
  first_name?: string
  gender?: string
  household: RecordIdString
  id: string
  last_name?: string
  name?: string
  pronouns?: string
  relationship_to_camper?: string
  updated: IsoAutoDateString
  year: number
}

export type FamilyCampMedicalRecord = {
  accommodation_explain?: string
  additional_info?: string
  allergy_info?: string
  bathroom_explain?: string
  cpap_info?: string
  created: IsoAutoDateString
  dietary_info?: string
  household: RecordIdString
  id: string
  physician_info?: string
  special_needs_info?: string
  updated: IsoAutoDateString
  year: number
}

export const FamilyCampRegistrationsShareCabinGateOptions = {
  no_share: 'no_share',
  maybe_mutual: 'maybe_mutual',
  yes_share: 'yes_share',
} as const
export type FamilyCampRegistrationsShareCabinGateOptions =
  (typeof FamilyCampRegistrationsShareCabinGateOptions)[keyof typeof FamilyCampRegistrationsShareCabinGateOptions]

export const FamilyCampRegistrationsShareEligibilityOptions = {
  open: 'open',
  named: 'named',
  declined: 'declined',
  unknown: 'unknown',
} as const
export type FamilyCampRegistrationsShareEligibilityOptions =
  (typeof FamilyCampRegistrationsShareEligibilityOptions)[keyof typeof FamilyCampRegistrationsShareEligibilityOptions]

export const FamilyCampRegistrationsShareEligibilitySourceOptions = {
  form: 'form',
  registration: 'registration',
  none: 'none',
} as const
export type FamilyCampRegistrationsShareEligibilitySourceOptions =
  (typeof FamilyCampRegistrationsShareEligibilitySourceOptions)[keyof typeof FamilyCampRegistrationsShareEligibilitySourceOptions]
export type FamilyCampRegistrationsRecord = {
  accommodation_is_mandatory?: boolean
  arrival_eta?: string
  cabin_assignment?: string
  created: IsoAutoDateString
  goals?: string
  has_infant?: boolean
  household: RecordIdString
  id: string
  needs_accommodation?: boolean
  needs_power?: boolean
  needs_private_bathroom?: boolean
  notes?: string
  opt_out_vip?: boolean
  request_last_updated?: IsoDateString
  request_source_field?: string
  request_text?: string
  share_answers_conflict?: boolean
  share_cabin_gate?: FamilyCampRegistrationsShareCabinGateOptions
  share_cabin_preference?: string
  share_eligibility?: FamilyCampRegistrationsShareEligibilityOptions
  share_eligibility_source?: FamilyCampRegistrationsShareEligibilitySourceOptions
  shared_cabin_modes_raw?: string
  special_occasions?: string
  updated: IsoAutoDateString
  wants_near?: boolean
  wants_similar_ages?: boolean
  wants_with?: boolean
  year: number
}

export type FinancialAidApplicationsRecord = {
  affiliated_jcc?: boolean
  amount_awarded?: number
  amount_confirmed?: boolean
  amount_requested?: number
  applicant_signature?: string
  camper_name?: string
  child_affiliated_synagogue?: string
  children_jewish_day_school?: string
  contact_address?: string
  contact_city?: string
  contact_country?: string
  contact_email?: string
  contact_first_name?: string
  contact_jewish?: string
  contact_last_name?: string
  contact_marital_status?: string
  contact_phone?: string
  contact_state?: string
  contact_zip?: string
  covid_childcare?: boolean
  covid_childcare_amount?: number
  covid_expenses?: string
  covid_expenses_additional?: string
  covid_expenses_amount?: number
  created: IsoAutoDateString
  deposit_paid?: number
  deposit_paid_adult?: number
  donation_other?: string
  donation_preference?: string
  expected_gross_income?: number
  fc_amount_requested?: number
  fc_program?: string
  financial_support?: string
  fire?: string
  fire_affected?: boolean
  fire_detail?: string
  gov_subsidies?: boolean
  gov_subsidies_detail?: string
  household?: RecordIdString
  id: string
  income_confirmed?: boolean
  interest_expressed?: boolean
  non_retirement_savings?: number
  num_children?: number
  num_programs?: number
  num_sessions?: number
  one_happy_camper?: string
  other_financial_support?: string
  other_support_amount?: number
  other_support_expectations?: string
  owns_home?: boolean
  parent_2_jewish?: string
  parent_2_marital_status?: string
  parent_2_name?: string
  person: RecordIdString
  person_id: number
  retirement_accounts?: number
  russian_speaking?: boolean
  single_parent?: boolean
  special_circumstances?: string
  still_unemployed?: boolean
  student_debt?: number
  summer_amount_requested?: number
  summer_program?: string
  synagogue_grant?: string
  tbm_amount_requested?: number
  tbm_program?: string
  total_adjusted_income?: number
  total_edu_expenses?: number
  total_exemptions?: number
  total_gross_income?: number
  total_housing_expenses?: number
  total_medical_expenses?: number
  total_rent?: number
  unemployment?: boolean
  updated: IsoAutoDateString
  year: number
}

export type FinancialCategoriesRecord = {
  cm_id: number
  created: IsoAutoDateString
  id: string
  is_archived?: boolean
  name?: string
  updated: IsoAutoDateString
}

export type FinancialTransactionsRecord = {
  amount?: number
  cm_id: number
  created: IsoAutoDateString
  deferral_gl_account_id?: string
  description?: string
  division?: RecordIdString
  effective_date?: IsoDateString
  financial_category?: RecordIdString
  gl_account_note?: string
  household?: RecordIdString
  id: string
  is_reversed?: boolean
  payment_method?: RecordIdString
  person?: RecordIdString
  post_date?: IsoDateString
  program_id?: number
  quantity?: number
  recognition_gl_account_id?: string
  reversal_date?: IsoDateString
  service_end_date?: IsoDateString
  service_start_date?: IsoDateString
  session?: RecordIdString
  session_group?: RecordIdString
  transaction_note?: string
  transaction_number?: number
  unit_amount?: number
  updated: IsoAutoDateString
  year: number
}

export const GeoOverridesCategoryOptions = {
  city: 'city',
  school: 'school',
  congregation: 'congregation',
} as const
export type GeoOverridesCategoryOptions =
  (typeof GeoOverridesCategoryOptions)[keyof typeof GeoOverridesCategoryOptions]

export const GeoOverridesOverrideTypeOptions = {
  alias: 'alias',
  canonical: 'canonical',
  merge: 'merge',
  rejected: 'rejected',
} as const
export type GeoOverridesOverrideTypeOptions =
  (typeof GeoOverridesOverrideTypeOptions)[keyof typeof GeoOverridesOverrideTypeOptions]

export const GeoOverridesNominatimStatusOptions = {
  resolved: 'resolved',
  no_result: 'no_result',
  ambiguous: 'ambiguous',
} as const
export type GeoOverridesNominatimStatusOptions =
  (typeof GeoOverridesNominatimStatusOptions)[keyof typeof GeoOverridesNominatimStatusOptions]
export type GeoOverridesRecord = {
  address_country?: string
  canonical_name: string
  category: GeoOverridesCategoryOptions
  city?: string
  created: IsoAutoDateString
  id: string
  lat?: number
  lng?: number
  merged_into?: string
  nominatim_status?: GeoOverridesNominatimStatusOptions
  notes?: string
  override_type: GeoOverridesOverrideTypeOptions
  raw_value?: string
  state?: string
  updated: IsoAutoDateString
  year: number
}

export type HouseholdCustomValuesRecord = {
  created: IsoAutoDateString
  field_definition?: RecordIdString
  household?: RecordIdString
  id: string
  last_updated?: string
  updated: IsoAutoDateString
  value?: string
  year: number
}

export type HouseholdDemographicsRecord = {
  away_during_camp?: boolean
  away_from_date?: string
  away_location?: string
  away_phone?: string
  away_return_date?: string
  board_member?: boolean
  congregation_family?: string
  congregation_summer?: string
  created: IsoAutoDateString
  custody_family?: string
  custody_summer?: string
  family_description?: string
  family_description_other?: string
  form_filler?: string
  has_custody_considerations?: boolean
  household: RecordIdString
  id: string
  jcc_family?: string
  jcc_summer?: string
  jewish_affiliation?: string
  jewish_affiliation_other?: string
  jewish_identities?: string
  military_family?: boolean
  parent_immigrant?: boolean
  parent_immigrant_origin?: string
  person?: RecordIdString
  person_id?: number
  updated: IsoAutoDateString
  year: number
}

export type HouseholdsRecord = {
  alternate_mailing_title?: string
  billing_address1?: string
  billing_address2?: string
  billing_city?: string
  billing_country?: string
  billing_mailing_title?: string
  billing_postal_code?: string
  billing_state?: string
  cm_id: number
  created: IsoAutoDateString
  greeting?: string
  household_phone?: string
  id: string
  mailing_title?: string
  updated: IsoAutoDateString
  year: number
}

export type LockedGroupMembersRecord = {
  added_by?: string
  attendee: RecordIdString
  group: RecordIdString
  id: string
}

export type LockedGroupsRecord = {
  color: string
  created: IsoAutoDateString
  created_by?: string
  id: string
  name?: string
  scenario: RecordIdString
  session: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type LodgingAreasRecord = {
  code: string
  created: IsoAutoDateString
  id: string
  map_x?: number
  map_y?: number
  name: string
  sort_order?: number
  updated: IsoAutoDateString
  year: number
}

export type LodgingAssignmentHistoryRecord = {
  created: IsoAutoDateString
  detected_at: IsoDateString
  household_cm_id?: number
  id: string
  new_unit?: string
  old_unit?: string
  person_cm_id?: number
  session?: RecordIdString
  session_cm_id?: number
  source_field?: string
  year: number
}

export const LodgingAssignmentsSourceOptions = {
  campminder_sync: 'campminder_sync',
  jotform_sync: 'jotform_sync',
  staff_manual: 'staff_manual',
} as const
export type LodgingAssignmentsSourceOptions =
  (typeof LodgingAssignmentsSourceOptions)[keyof typeof LodgingAssignmentsSourceOptions]
export type LodgingAssignmentsRecord = {
  created: IsoAutoDateString
  household_cm_id?: number
  id: string
  party_size?: number
  person_cm_id?: number
  session: RecordIdString
  session_cm_id: number
  source?: LodgingAssignmentsSourceOptions
  staff_touched?: boolean
  units?: RecordIdString[]
  updated: IsoAutoDateString
  year: number
}

export const LodgingAssignmentsDraftSourceOptions = {
  campminder_sync: 'campminder_sync',
  jotform_sync: 'jotform_sync',
  staff_manual: 'staff_manual',
} as const
export type LodgingAssignmentsDraftSourceOptions =
  (typeof LodgingAssignmentsDraftSourceOptions)[keyof typeof LodgingAssignmentsDraftSourceOptions]
export type LodgingAssignmentsDraftRecord = {
  created: IsoAutoDateString
  household_cm_id?: number
  id: string
  party_size?: number
  person_cm_id?: number
  scenario: RecordIdString
  session: RecordIdString
  session_cm_id: number
  source?: LodgingAssignmentsDraftSourceOptions
  staff_touched?: boolean
  units?: RecordIdString[]
  updated: IsoAutoDateString
  year: number
}

export type LodgingAvailabilityRecord = {
  created: IsoAutoDateString
  family_available?: boolean
  id: string
  note?: string
  occupant_name?: string
  session: RecordIdString
  session_cm_id: number
  unit: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type LodgingFieldMappingsRecord = {
  created: IsoAutoDateString
  field_cm_id: number
  field_name?: string
  id: string
  is_enabled?: boolean
  last_seen_count?: number
  last_seen_year?: number
  note?: string
  prior_year_count?: number
  target?: string
  updated: IsoAutoDateString
}

export type LodgingFriendGroupMembersRecord = {
  added_by?: string
  created: IsoAutoDateString
  group: RecordIdString
  household_cm_id: number
  id: string
}

export const LodgingFriendGroupsSourceOptions = {
  staff_manual: 'staff_manual',
  proposed: 'proposed',
} as const
export type LodgingFriendGroupsSourceOptions =
  (typeof LodgingFriendGroupsSourceOptions)[keyof typeof LodgingFriendGroupsSourceOptions]
export type LodgingFriendGroupsRecord = {
  color: string
  created: IsoAutoDateString
  created_by?: string
  id: string
  name?: string
  session: RecordIdString
  session_cm_id: number
  source: LodgingFriendGroupsSourceOptions
  updated: IsoAutoDateString
  year: number
}

export const LodgingIngestIssuesKindOptions = {
  unresolved_alias: 'unresolved_alias',
  ambiguous_alias: 'ambiguous_alias',
  ambiguous_session: 'ambiguous_session',
  no_session: 'no_session',
  field_zero_values: 'field_zero_values',
  unknown_party: 'unknown_party',
  write_failed: 'write_failed',
} as const
export type LodgingIngestIssuesKindOptions =
  (typeof LodgingIngestIssuesKindOptions)[keyof typeof LodgingIngestIssuesKindOptions]
export type LodgingIngestIssuesRecord<Tcandidate_session_cm_ids = unknown> = {
  candidate_session_cm_ids?: null | Tcandidate_session_cm_ids
  created: IsoAutoDateString
  first_seen?: IsoDateString
  household_cm_id?: number
  id: string
  is_resolved?: boolean
  kind: LodgingIngestIssuesKindOptions
  last_seen?: IsoDateString
  occurrences?: number
  person_cm_id?: number
  raw_value?: string
  resolution_note?: string
  resolved_alias?: RecordIdString
  source_field?: string
  suggested_session?: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export const LodgingSessionStatusStatusOptions = {
  active: 'active',
  cancelled: 'cancelled',
} as const
export type LodgingSessionStatusStatusOptions =
  (typeof LodgingSessionStatusStatusOptions)[keyof typeof LodgingSessionStatusStatusOptions]
export type LodgingSessionStatusRecord = {
  created: IsoAutoDateString
  id: string
  session_cm_id: number
  status: LodgingSessionStatusStatusOptions
  updated: IsoAutoDateString
  year: number
}

export type LodgingSlotMergesRecord = {
  combined?: boolean
  id: string
  scenario?: RecordIdString
  session: RecordIdString
  session_cm_id: number
  unit: RecordIdString
  year: number
}

export type LodgingUnitAliasesRecord = {
  alias_string: string
  created: IsoAutoDateString
  id: string
  member_units: RecordIdString[]
  notes?: string
  source_field?: string
  updated: IsoAutoDateString
  valid_from_year?: number
  valid_to_year?: number
}

export const LodgingUnitsBathroomOptions = {
  none: 'none',
  private: 'private',
  shared: 'shared',
} as const
export type LodgingUnitsBathroomOptions =
  (typeof LodgingUnitsBathroomOptions)[keyof typeof LodgingUnitsBathroomOptions]

export const LodgingUnitsInventoryClassOptions = {
  family_pool: 'family_pool',
  staff_default: 'staff_default',
} as const
export type LodgingUnitsInventoryClassOptions =
  (typeof LodgingUnitsInventoryClassOptions)[keyof typeof LodgingUnitsInventoryClassOptions]

export const LodgingUnitsHasRampOptions = {
  yes: 'yes',
  no: 'no',
  partial: 'partial',
} as const
export type LodgingUnitsHasRampOptions =
  (typeof LodgingUnitsHasRampOptions)[keyof typeof LodgingUnitsHasRampOptions]

export const LodgingUnitsShareabilityOptions = {
  shareable: 'shareable',
  single_party: 'single_party',
} as const
export type LodgingUnitsShareabilityOptions =
  (typeof LodgingUnitsShareabilityOptions)[keyof typeof LodgingUnitsShareabilityOptions]
export type LodgingUnitsRecord<Tbeds = unknown> = {
  area: RecordIdString
  bathroom?: LodgingUnitsBathroomOptions
  bathroom_group?: string
  beds?: null | Tbeds
  code: string
  created: IsoAutoDateString
  default_combined?: boolean
  has_ac?: boolean
  has_changing_table?: boolean
  has_crib?: boolean
  has_fridge?: boolean
  has_heat?: boolean
  has_kitchen?: boolean
  has_lights?: boolean
  has_living_room?: boolean
  has_pack_play_space?: boolean
  has_plumbing?: boolean
  has_power?: boolean
  has_ramp?: LodgingUnitsHasRampOptions
  has_shared_fridge?: boolean
  has_space_heater?: boolean
  has_tub?: boolean
  id: string
  inventory_class?: LodgingUnitsInventoryClassOptions
  is_accessible?: boolean
  is_active?: boolean
  is_confirmed?: boolean
  is_container?: boolean
  is_weatherized?: boolean
  map_x?: number
  map_y?: number
  max_beds?: number
  name: string
  near_bathhouse?: boolean
  notes?: string
  parent_unit?: RecordIdString
  shareability?: LodgingUnitsShareabilityOptions
  sleeps?: number
  updated: IsoAutoDateString
  year: number
}

export const NormalizedMappingsCategoryOptions = {
  city: 'city',
  school: 'school',
  congregation: 'congregation',
} as const
export type NormalizedMappingsCategoryOptions =
  (typeof NormalizedMappingsCategoryOptions)[keyof typeof NormalizedMappingsCategoryOptions]
export type NormalizedMappingsRecord = {
  address_city?: string
  address_country?: string
  address_state?: string
  category: NormalizedMappingsCategoryOptions
  confidence?: number
  created: IsoAutoDateString
  id: string
  normalized_value: string
  original_value: string
  person?: RecordIdString
  session?: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export const OriginalBunkRequestsFieldOptions = {
  bunk_request_form: 'bunk_request_form',
  staff_not_bunk_with: 'staff_not_bunk_with',
  bunking_notes: 'bunking_notes',
  internal_notes: 'internal_notes',
  socialize_with: 'socialize_with',
} as const
export type OriginalBunkRequestsFieldOptions =
  (typeof OriginalBunkRequestsFieldOptions)[keyof typeof OriginalBunkRequestsFieldOptions]
export type OriginalBunkRequestsRecord = {
  content: string
  content_hash?: string
  created: IsoAutoDateString
  field: OriginalBunkRequestsFieldOptions
  id: string
  processed?: IsoDateString
  requester: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type PaymentMethodsRecord = {
  cm_id: number
  created: IsoAutoDateString
  id: string
  name?: string
  updated: IsoAutoDateString
}

export type PersonCustomValuesRecord = {
  created: IsoAutoDateString
  field_definition?: RecordIdString
  id: string
  last_updated?: string
  person?: RecordIdString
  updated: IsoAutoDateString
  value?: string
  year: number
}

export type PersonTagDefsRecord = {
  created: IsoAutoDateString
  id: string
  is_hidden?: boolean
  is_seasonal?: boolean
  last_updated_utc?: string
  name: string
  updated: IsoAutoDateString
}

export type PersonsRecord<Tparent_names = unknown, Traw_data = unknown> = {
  address_city?: string
  address_state?: string
  age?: number
  alternate_childhood_household?: RecordIdString
  birthdate?: string
  cm_id: number
  cm_lead_date?: string
  created: IsoAutoDateString
  division?: RecordIdString
  first_name: string
  gender?: string
  gender_identity_id?: number
  gender_identity_name?: string
  gender_identity_write_in?: string
  gender_pronoun_id?: number
  gender_pronoun_name?: string
  gender_pronoun_write_in?: string
  grade?: number
  household?: RecordIdString
  household_id?: number
  id: string
  is_camper?: boolean
  last_name: string
  last_year_attended?: number
  lead_date?: string
  normalized_city?: string
  normalized_congregation?: string
  normalized_school?: string
  parent_names?: null | Tparent_names
  partition_id?: number
  preferred_name?: string
  primary_childhood_household?: RecordIdString
  primary_email?: string
  raw_data?: null | Traw_data
  school?: string
  secondary_email?: string
  tags?: RecordIdString[]
  tshirt_size?: string
  updated: IsoAutoDateString
  year: number
  years_at_camp?: number
}

export type QuestRegistrationsRecord = {
  any_medications?: string
  anything_else?: string
  away_before?: string
  away_explain?: string
  backpack_info?: string
  bad_camp_experiences?: string
  bar_mitzvah_month?: string
  bar_mitzvah_where?: string
  bar_mitzvah_year?: boolean
  biggest_accomplishment?: string
  biggest_concern?: string
  biggest_disappointment?: string
  biggest_hope?: string
  bus_alt_phone?: string
  bus_alt_pickup?: string
  bus_pickup_name?: string
  bus_pickup_phone?: string
  bus_pickup_relationship?: string
  change_since_last_year?: string
  child_matured?: string
  concerns_for_child?: string
  cook_chores?: string
  cook_chores_explain?: string
  cooperates_with_limits?: string
  created: IsoAutoDateString
  decision_attend?: string
  express_frustration?: string
  extracurricular?: string
  fears_anxieties?: string
  has_quester_before?: string
  how_can_help?: string
  how_much_child?: string
  id: string
  if_returning?: string
  least_looking_forward?: string
  make_friends_ease?: string
  make_friends_explain?: string
  most_looking_forward?: string
  parent_signature?: string
  person_id: number
  physical_limit_explain?: string
  physical_limitations?: string
  preferred_name?: string
  quester_signature?: string
  separation_explain?: string
  separation_reaction?: string
  situations_transitions?: string
  special_needs?: string
  techniques_limits?: string
  updated: IsoAutoDateString
  what_makes_angry?: string
  whose_decision?: string
  why_come?: string
  year: number
}

export type RolesRecord<Tpermissions = unknown> = {
  created: IsoAutoDateString
  description?: string
  id: string
  is_system?: boolean
  name: string
  permissions: null | Tpermissions
  slug: string
  updated: IsoAutoDateString
}

export type SavedScenariosRecord<Tmetadata = unknown> = {
  created: IsoAutoDateString
  description?: string
  id: string
  is_active?: boolean
  metadata?: null | Tmetadata
  name: string
  session: RecordIdString
  updated: IsoAutoDateString
  year: number
}

export type SessionGroupsRecord = {
  cm_id: number
  created: IsoAutoDateString
  description?: string
  id: string
  is_active?: boolean
  name: string
  sort_order?: number
  updated: IsoAutoDateString
  year: number
}

export const SheetsWorkbooksWorkbookTypeOptions = {
  globals: 'globals',
  year: 'year',
} as const
export type SheetsWorkbooksWorkbookTypeOptions =
  (typeof SheetsWorkbooksWorkbookTypeOptions)[keyof typeof SheetsWorkbooksWorkbookTypeOptions]

export const SheetsWorkbooksStatusOptions = {
  ok: 'ok',
  error: 'error',
  syncing: 'syncing',
} as const
export type SheetsWorkbooksStatusOptions =
  (typeof SheetsWorkbooksStatusOptions)[keyof typeof SheetsWorkbooksStatusOptions]
export type SheetsWorkbooksRecord = {
  created: IsoAutoDateString
  error_message?: string
  id: string
  last_sync: IsoAutoDateString
  spreadsheet_id: string
  status?: SheetsWorkbooksStatusOptions
  tab_count?: number
  title: string
  total_records?: number
  url?: string
  workbook_type: SheetsWorkbooksWorkbookTypeOptions
  year?: number
}

export const SolverRunsStatusOptions = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failed: 'failed',
  error: 'error',
  cancelled: 'cancelled',
} as const
export type SolverRunsStatusOptions =
  (typeof SolverRunsStatusOptions)[keyof typeof SolverRunsStatusOptions]
export type SolverRunsRecord<
  Tassignment_counts = unknown,
  Tdetails = unknown,
  Terror = unknown,
  Tlogs = unknown,
  Tresult = unknown,
  Tstats = unknown,
> = {
  assignment_counts?: null | Tassignment_counts
  break_glass_used?: boolean
  completed_at?: IsoDateString
  created: IsoAutoDateString
  details?: null | Tdetails
  error?: null | Terror
  id: string
  infeasibility_diagnosis?: string
  logs?: null | Tlogs
  overflow_used?: number
  progress?: number
  result?: null | Tresult
  run_id: string
  run_type?: string
  scenario?: RecordIdString
  session?: RecordIdString
  session_id?: number
  started_at?: IsoDateString
  stats?: null | Tstats
  status?: SolverRunsStatusOptions
  triggered_by?: string
  updated: IsoAutoDateString
  year: number
}

export const StaffStatusOptions = {
  active: 'active',
  resigned: 'resigned',
  dismissed: 'dismissed',
  cancelled: 'cancelled',
} as const
export type StaffStatusOptions = (typeof StaffStatusOptions)[keyof typeof StaffStatusOptions]

export const StaffInternationalOptions = {
  domestic: 'domestic',
  international: 'international',
} as const
export type StaffInternationalOptions =
  (typeof StaffInternationalOptions)[keyof typeof StaffInternationalOptions]
export type StaffRecord = {
  bunk_staff?: boolean
  bunks?: RecordIdString[]
  contract_due_date?: IsoDateString
  contract_in_date?: IsoDateString
  contract_out_date?: IsoDateString
  created: IsoAutoDateString
  division?: RecordIdString
  employment_end_date?: IsoDateString
  employment_start_date?: IsoDateString
  hire_date?: IsoDateString
  id: string
  international?: StaffInternationalOptions
  organizational_category?: RecordIdString
  person?: RecordIdString
  person_id?: number
  position1?: RecordIdString
  position2?: RecordIdString
  salary?: number
  status?: StaffStatusOptions
  status_id?: number
  updated: IsoAutoDateString
  year: number
  years?: number
}

export type StaffApplicationsRecord = {
  activity_program?: string
  advice_would_give?: string
  autobiography?: string
  can_work_dates?: string
  cant_work_explain?: string
  closest_friend?: string
  community_means?: string
  created: IsoAutoDateString
  dietary_needs?: string
  dietary_needs_other?: string
  favorite_camper_moment?: string
  how_look_at_camp?: string
  id: string
  jedi_new_staff?: string
  jedi_returner?: string
  jewish_community?: string
  languages?: string
  last_summer_learned?: string
  over_18?: boolean
  over_21?: boolean
  person_id: number
  position_pref_1?: string
  position_pref_2?: string
  position_pref_3?: string
  qualification_changes?: string
  qualifications?: string
  ref_1_email?: string
  ref_1_name?: string
  ref_1_phone?: string
  ref_1_relationship?: string
  ref_1_years?: string
  since_camp?: string
  someone_admire?: string
  spiritual_moment?: string
  staff: RecordIdString
  stress_response?: string
  stress_situation?: string
  tawonga_makes_think?: string
  three_rules?: string
  updated: IsoAutoDateString
  why_tawonga?: string
  why_work_again?: string
  wish_knew?: string
  work_dates_driver?: string
  work_dates_kitchen_supervisor?: boolean
  work_dates_supervisor?: string
  work_dates_wild?: string
  work_expectations?: string
  working_across_differences?: string
  year: number
}

export type StaffOrgCategoriesRecord = {
  cm_id: number
  created: IsoAutoDateString
  id: string
  name: string
  updated: IsoAutoDateString
}

export type StaffPositionsRecord = {
  cm_id: number
  created: IsoAutoDateString
  id: string
  name: string
  program_area?: RecordIdString
  updated: IsoAutoDateString
}

export type StaffProgramAreasRecord = {
  cm_id: number
  created: IsoAutoDateString
  id: string
  name: string
  updated: IsoAutoDateString
}

export type StaffSkillsRecord = {
  can_teach?: boolean
  created: IsoAutoDateString
  first_name?: string
  id: string
  is_certified?: boolean
  is_experienced?: boolean
  is_intermediate?: boolean
  last_name?: string
  person?: RecordIdString
  person_id: number
  raw_value?: string
  skill_cm_id: number
  skill_name: string
  updated: IsoAutoDateString
  year: number
}

export type StaffVehicleInfoRecord = {
  can_bring_others?: string
  created: IsoAutoDateString
  driver_name?: string
  driving_to_camp?: boolean
  how_getting_to_camp?: string
  id: string
  license_plate?: string
  person_id: number
  ride_from?: string
  staff: RecordIdString
  transport_notes?: string
  updated: IsoAutoDateString
  vehicle_make?: string
  vehicle_model?: string
  which_friend?: string
  year: number
}

export const SyncRunsStatusOptions = {
  success: 'success',
  failed: 'failed',
} as const
export type SyncRunsStatusOptions =
  (typeof SyncRunsStatusOptions)[keyof typeof SyncRunsStatusOptions]

export const SyncRunsTriggerOptions = {
  hourly: 'hourly',
  daily: 'daily',
  weekly: 'weekly',
  custom_values: 'custom_values',
  historical: 'historical',
  manual: 'manual',
} as const
export type SyncRunsTriggerOptions =
  (typeof SyncRunsTriggerOptions)[keyof typeof SyncRunsTriggerOptions]
export type SyncRunsRecord<Tsub_stats = unknown> = {
  already_processed_count?: number
  batch_id: string
  created: IsoAutoDateString
  created_count?: number
  deleted_count?: number
  duration?: number
  ended?: IsoDateString
  error?: string
  errors_count?: number
  expanded_count?: number
  id: string
  lodging_prod_audit_warnings_count?: number
  prod_audit_warnings_count?: number
  rejected_count?: number
  service: string
  skipped_count?: number
  started?: IsoDateString
  status: SyncRunsStatusOptions
  sub_stats?: null | Tsub_stats
  trigger: SyncRunsTriggerOptions
  updated: IsoAutoDateString
  updated_count?: number
  year: number
}

export type UserRolesRecord = {
  created: IsoAutoDateString
  id: string
  role: RecordIdString
  updated: IsoAutoDateString
  user: RecordIdString
}

export type UsersRecord<Tcached_permissions = unknown> = {
  avatar?: FileNameString
  cached_permissions?: null | Tcached_permissions
  created: IsoAutoDateString
  email: string
  emailVisibility?: boolean
  id: string
  is_admin?: boolean
  last_login?: IsoDateString
  name?: string
  password: string
  tokenKey: string
  updated: IsoAutoDateString
  verified?: boolean
}

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> &
  BaseSystemFields<Texpand>
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> &
  BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> &
  AuthSystemFields<Texpand>
export type AttendeeStatusHistoryResponse<Texpand = unknown> =
  Required<AttendeeStatusHistoryRecord> & BaseSystemFields<Texpand>
export type AttendeesResponse<Texpand = unknown> = Required<AttendeesRecord> &
  BaseSystemFields<Texpand>
export type BunkAssignmentsResponse<Texpand = unknown> = Required<BunkAssignmentsRecord> &
  BaseSystemFields<Texpand>
export type BunkAssignmentsDraftResponse<Texpand = unknown> = Required<BunkAssignmentsDraftRecord> &
  BaseSystemFields<Texpand>
export type BunkPlansResponse<Texpand = unknown> = Required<BunkPlansRecord> &
  BaseSystemFields<Texpand>
export type BunkRequestSourcesResponse<Texpand = unknown> = Required<BunkRequestSourcesRecord> &
  BaseSystemFields<Texpand>
export type BunkRequestsResponse<
  Tai_p1_reasoning = unknown,
  Tai_p3_reasoning = unknown,
  Tconfidence_explanation = unknown,
  Tkeywords_found = unknown,
  Tmetadata = unknown,
  Tsource_fields = unknown,
  Texpand = unknown,
> = Required<
  BunkRequestsRecord<
    Tai_p1_reasoning,
    Tai_p3_reasoning,
    Tconfidence_explanation,
    Tkeywords_found,
    Tmetadata,
    Tsource_fields
  >
> &
  BaseSystemFields<Texpand>
export type BunksResponse<Texpand = unknown> = Required<BunksRecord> & BaseSystemFields<Texpand>
export type CampSessionsResponse<Texpand = unknown> = Required<CampSessionsRecord> &
  BaseSystemFields<Texpand>
export type CamperDietaryResponse<Texpand = unknown> = Required<CamperDietaryRecord> &
  BaseSystemFields<Texpand>
export type CamperTransportationResponse<Texpand = unknown> = Required<CamperTransportationRecord> &
  BaseSystemFields<Texpand>
export type ConfigResponse<Tmetadata = unknown, Tvalue = unknown, Texpand = unknown> = Required<
  ConfigRecord<Tmetadata, Tvalue>
> &
  BaseSystemFields<Texpand>
export type ConfigSectionsResponse<Texpand = unknown> = Required<ConfigSectionsRecord> &
  BaseSystemFields<Texpand>
export type CustomFieldDefsResponse<Texpand = unknown> = Required<CustomFieldDefsRecord> &
  BaseSystemFields<Texpand>
export type DebugParseResultsResponse<
  Tai_raw_response = unknown,
  Tparsed_intents = unknown,
  Texpand = unknown,
> = Required<DebugParseResultsRecord<Tai_raw_response, Tparsed_intents>> & BaseSystemFields<Texpand>
export type DebugPipelineRunsResponse<
  Tsession_breakdown = unknown,
  Tsource_fields = unknown,
  Tstatus_breakdown = unknown,
  Texpand = unknown,
> = Required<DebugPipelineRunsRecord<Tsession_breakdown, Tsource_fields, Tstatus_breakdown>> &
  BaseSystemFields<Texpand>
export type DebugPipelineSummaryResponse<Texpand = unknown> = Required<DebugPipelineSummaryRecord> &
  BaseSystemFields<Texpand>
export type DebugPipelineTracesResponse<Ttrace_data = unknown, Texpand = unknown> = Required<
  DebugPipelineTracesRecord<Ttrace_data>
> &
  BaseSystemFields<Texpand>
export type DivisionsResponse<Texpand = unknown> = Required<DivisionsRecord> &
  BaseSystemFields<Texpand>
export type EnrollmentSnapshotsResponse<Texpand = unknown> = Required<EnrollmentSnapshotsRecord> &
  BaseSystemFields<Texpand>
export type FamilyCampAdultsResponse<Tattribute_conflicts = unknown, Texpand = unknown> = Required<
  FamilyCampAdultsRecord<Tattribute_conflicts>
> &
  BaseSystemFields<Texpand>
export type FamilyCampMedicalResponse<Texpand = unknown> = Required<FamilyCampMedicalRecord> &
  BaseSystemFields<Texpand>
export type FamilyCampRegistrationsResponse<Texpand = unknown> =
  Required<FamilyCampRegistrationsRecord> & BaseSystemFields<Texpand>
export type FinancialAidApplicationsResponse<Texpand = unknown> =
  Required<FinancialAidApplicationsRecord> & BaseSystemFields<Texpand>
export type FinancialCategoriesResponse<Texpand = unknown> = Required<FinancialCategoriesRecord> &
  BaseSystemFields<Texpand>
export type FinancialTransactionsResponse<Texpand = unknown> =
  Required<FinancialTransactionsRecord> & BaseSystemFields<Texpand>
export type GeoOverridesResponse<Texpand = unknown> = Required<GeoOverridesRecord> &
  BaseSystemFields<Texpand>
export type HouseholdCustomValuesResponse<Texpand = unknown> =
  Required<HouseholdCustomValuesRecord> & BaseSystemFields<Texpand>
export type HouseholdDemographicsResponse<Texpand = unknown> =
  Required<HouseholdDemographicsRecord> & BaseSystemFields<Texpand>
export type HouseholdsResponse<Texpand = unknown> = Required<HouseholdsRecord> &
  BaseSystemFields<Texpand>
export type LockedGroupMembersResponse<Texpand = unknown> = Required<LockedGroupMembersRecord> &
  BaseSystemFields<Texpand>
export type LockedGroupsResponse<Texpand = unknown> = Required<LockedGroupsRecord> &
  BaseSystemFields<Texpand>
export type LodgingAreasResponse<Texpand = unknown> = Required<LodgingAreasRecord> &
  BaseSystemFields<Texpand>
export type LodgingAssignmentHistoryResponse<Texpand = unknown> =
  Required<LodgingAssignmentHistoryRecord> & BaseSystemFields<Texpand>
export type LodgingAssignmentsResponse<Texpand = unknown> = Required<LodgingAssignmentsRecord> &
  BaseSystemFields<Texpand>
export type LodgingAssignmentsDraftResponse<Texpand = unknown> =
  Required<LodgingAssignmentsDraftRecord> & BaseSystemFields<Texpand>
export type LodgingAvailabilityResponse<Texpand = unknown> = Required<LodgingAvailabilityRecord> &
  BaseSystemFields<Texpand>
export type LodgingFieldMappingsResponse<Texpand = unknown> = Required<LodgingFieldMappingsRecord> &
  BaseSystemFields<Texpand>
export type LodgingFriendGroupMembersResponse<Texpand = unknown> =
  Required<LodgingFriendGroupMembersRecord> & BaseSystemFields<Texpand>
export type LodgingFriendGroupsResponse<Texpand = unknown> = Required<LodgingFriendGroupsRecord> &
  BaseSystemFields<Texpand>
export type LodgingIngestIssuesResponse<
  Tcandidate_session_cm_ids = unknown,
  Texpand = unknown,
> = Required<LodgingIngestIssuesRecord<Tcandidate_session_cm_ids>> & BaseSystemFields<Texpand>
export type LodgingSessionStatusResponse<Texpand = unknown> = Required<LodgingSessionStatusRecord> &
  BaseSystemFields<Texpand>
export type LodgingSlotMergesResponse<Texpand = unknown> = Required<LodgingSlotMergesRecord> &
  BaseSystemFields<Texpand>
export type LodgingUnitAliasesResponse<Texpand = unknown> = Required<LodgingUnitAliasesRecord> &
  BaseSystemFields<Texpand>
export type LodgingUnitsResponse<Tbeds = unknown, Texpand = unknown> = Required<
  LodgingUnitsRecord<Tbeds>
> &
  BaseSystemFields<Texpand>
export type NormalizedMappingsResponse<Texpand = unknown> = Required<NormalizedMappingsRecord> &
  BaseSystemFields<Texpand>
export type OriginalBunkRequestsResponse<Texpand = unknown> = Required<OriginalBunkRequestsRecord> &
  BaseSystemFields<Texpand>
export type PaymentMethodsResponse<Texpand = unknown> = Required<PaymentMethodsRecord> &
  BaseSystemFields<Texpand>
export type PersonCustomValuesResponse<Texpand = unknown> = Required<PersonCustomValuesRecord> &
  BaseSystemFields<Texpand>
export type PersonTagDefsResponse<Texpand = unknown> = Required<PersonTagDefsRecord> &
  BaseSystemFields<Texpand>
export type PersonsResponse<
  Tparent_names = unknown,
  Traw_data = unknown,
  Texpand = unknown,
> = Required<PersonsRecord<Tparent_names, Traw_data>> & BaseSystemFields<Texpand>
export type QuestRegistrationsResponse<Texpand = unknown> = Required<QuestRegistrationsRecord> &
  BaseSystemFields<Texpand>
export type RolesResponse<Tpermissions = unknown, Texpand = unknown> = Required<
  RolesRecord<Tpermissions>
> &
  BaseSystemFields<Texpand>
export type SavedScenariosResponse<Tmetadata = unknown, Texpand = unknown> = Required<
  SavedScenariosRecord<Tmetadata>
> &
  BaseSystemFields<Texpand>
export type SessionGroupsResponse<Texpand = unknown> = Required<SessionGroupsRecord> &
  BaseSystemFields<Texpand>
export type SheetsWorkbooksResponse<Texpand = unknown> = Required<SheetsWorkbooksRecord> &
  BaseSystemFields<Texpand>
export type SolverRunsResponse<
  Tassignment_counts = unknown,
  Tdetails = unknown,
  Terror = unknown,
  Tlogs = unknown,
  Tresult = unknown,
  Tstats = unknown,
  Texpand = unknown,
> = Required<SolverRunsRecord<Tassignment_counts, Tdetails, Terror, Tlogs, Tresult, Tstats>> &
  BaseSystemFields<Texpand>
export type StaffResponse<Texpand = unknown> = Required<StaffRecord> & BaseSystemFields<Texpand>
export type StaffApplicationsResponse<Texpand = unknown> = Required<StaffApplicationsRecord> &
  BaseSystemFields<Texpand>
export type StaffOrgCategoriesResponse<Texpand = unknown> = Required<StaffOrgCategoriesRecord> &
  BaseSystemFields<Texpand>
export type StaffPositionsResponse<Texpand = unknown> = Required<StaffPositionsRecord> &
  BaseSystemFields<Texpand>
export type StaffProgramAreasResponse<Texpand = unknown> = Required<StaffProgramAreasRecord> &
  BaseSystemFields<Texpand>
export type StaffSkillsResponse<Texpand = unknown> = Required<StaffSkillsRecord> &
  BaseSystemFields<Texpand>
export type StaffVehicleInfoResponse<Texpand = unknown> = Required<StaffVehicleInfoRecord> &
  BaseSystemFields<Texpand>
export type SyncRunsResponse<Tsub_stats = unknown, Texpand = unknown> = Required<
  SyncRunsRecord<Tsub_stats>
> &
  BaseSystemFields<Texpand>
export type UserRolesResponse<Texpand = unknown> = Required<UserRolesRecord> &
  BaseSystemFields<Texpand>
export type UsersResponse<Tcached_permissions = unknown, Texpand = unknown> = Required<
  UsersRecord<Tcached_permissions>
> &
  AuthSystemFields<Texpand>

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
  _authOrigins: AuthoriginsRecord
  _externalAuths: ExternalauthsRecord
  _mfas: MfasRecord
  _otps: OtpsRecord
  _superusers: SuperusersRecord
  attendee_status_history: AttendeeStatusHistoryRecord
  attendees: AttendeesRecord
  bunk_assignments: BunkAssignmentsRecord
  bunk_assignments_draft: BunkAssignmentsDraftRecord
  bunk_plans: BunkPlansRecord
  bunk_request_sources: BunkRequestSourcesRecord
  bunk_requests: BunkRequestsRecord
  bunks: BunksRecord
  camp_sessions: CampSessionsRecord
  camper_dietary: CamperDietaryRecord
  camper_transportation: CamperTransportationRecord
  config: ConfigRecord
  config_sections: ConfigSectionsRecord
  custom_field_defs: CustomFieldDefsRecord
  debug_parse_results: DebugParseResultsRecord
  debug_pipeline_runs: DebugPipelineRunsRecord
  debug_pipeline_summary: DebugPipelineSummaryRecord
  debug_pipeline_traces: DebugPipelineTracesRecord
  divisions: DivisionsRecord
  enrollment_snapshots: EnrollmentSnapshotsRecord
  family_camp_adults: FamilyCampAdultsRecord
  family_camp_medical: FamilyCampMedicalRecord
  family_camp_registrations: FamilyCampRegistrationsRecord
  financial_aid_applications: FinancialAidApplicationsRecord
  financial_categories: FinancialCategoriesRecord
  financial_transactions: FinancialTransactionsRecord
  geo_overrides: GeoOverridesRecord
  household_custom_values: HouseholdCustomValuesRecord
  household_demographics: HouseholdDemographicsRecord
  households: HouseholdsRecord
  locked_group_members: LockedGroupMembersRecord
  locked_groups: LockedGroupsRecord
  lodging_areas: LodgingAreasRecord
  lodging_assignment_history: LodgingAssignmentHistoryRecord
  lodging_assignments: LodgingAssignmentsRecord
  lodging_assignments_draft: LodgingAssignmentsDraftRecord
  lodging_availability: LodgingAvailabilityRecord
  lodging_field_mappings: LodgingFieldMappingsRecord
  lodging_friend_group_members: LodgingFriendGroupMembersRecord
  lodging_friend_groups: LodgingFriendGroupsRecord
  lodging_ingest_issues: LodgingIngestIssuesRecord
  lodging_session_status: LodgingSessionStatusRecord
  lodging_slot_merges: LodgingSlotMergesRecord
  lodging_unit_aliases: LodgingUnitAliasesRecord
  lodging_units: LodgingUnitsRecord
  normalized_mappings: NormalizedMappingsRecord
  original_bunk_requests: OriginalBunkRequestsRecord
  payment_methods: PaymentMethodsRecord
  person_custom_values: PersonCustomValuesRecord
  person_tag_defs: PersonTagDefsRecord
  persons: PersonsRecord
  quest_registrations: QuestRegistrationsRecord
  roles: RolesRecord
  saved_scenarios: SavedScenariosRecord
  session_groups: SessionGroupsRecord
  sheets_workbooks: SheetsWorkbooksRecord
  solver_runs: SolverRunsRecord
  staff: StaffRecord
  staff_applications: StaffApplicationsRecord
  staff_org_categories: StaffOrgCategoriesRecord
  staff_positions: StaffPositionsRecord
  staff_program_areas: StaffProgramAreasRecord
  staff_skills: StaffSkillsRecord
  staff_vehicle_info: StaffVehicleInfoRecord
  sync_runs: SyncRunsRecord
  user_roles: UserRolesRecord
  users: UsersRecord
}

export type CollectionResponses = {
  _authOrigins: AuthoriginsResponse
  _externalAuths: ExternalauthsResponse
  _mfas: MfasResponse
  _otps: OtpsResponse
  _superusers: SuperusersResponse
  attendee_status_history: AttendeeStatusHistoryResponse
  attendees: AttendeesResponse
  bunk_assignments: BunkAssignmentsResponse
  bunk_assignments_draft: BunkAssignmentsDraftResponse
  bunk_plans: BunkPlansResponse
  bunk_request_sources: BunkRequestSourcesResponse
  bunk_requests: BunkRequestsResponse
  bunks: BunksResponse
  camp_sessions: CampSessionsResponse
  camper_dietary: CamperDietaryResponse
  camper_transportation: CamperTransportationResponse
  config: ConfigResponse
  config_sections: ConfigSectionsResponse
  custom_field_defs: CustomFieldDefsResponse
  debug_parse_results: DebugParseResultsResponse
  debug_pipeline_runs: DebugPipelineRunsResponse
  debug_pipeline_summary: DebugPipelineSummaryResponse
  debug_pipeline_traces: DebugPipelineTracesResponse
  divisions: DivisionsResponse
  enrollment_snapshots: EnrollmentSnapshotsResponse
  family_camp_adults: FamilyCampAdultsResponse
  family_camp_medical: FamilyCampMedicalResponse
  family_camp_registrations: FamilyCampRegistrationsResponse
  financial_aid_applications: FinancialAidApplicationsResponse
  financial_categories: FinancialCategoriesResponse
  financial_transactions: FinancialTransactionsResponse
  geo_overrides: GeoOverridesResponse
  household_custom_values: HouseholdCustomValuesResponse
  household_demographics: HouseholdDemographicsResponse
  households: HouseholdsResponse
  locked_group_members: LockedGroupMembersResponse
  locked_groups: LockedGroupsResponse
  lodging_areas: LodgingAreasResponse
  lodging_assignment_history: LodgingAssignmentHistoryResponse
  lodging_assignments: LodgingAssignmentsResponse
  lodging_assignments_draft: LodgingAssignmentsDraftResponse
  lodging_availability: LodgingAvailabilityResponse
  lodging_field_mappings: LodgingFieldMappingsResponse
  lodging_friend_group_members: LodgingFriendGroupMembersResponse
  lodging_friend_groups: LodgingFriendGroupsResponse
  lodging_ingest_issues: LodgingIngestIssuesResponse
  lodging_session_status: LodgingSessionStatusResponse
  lodging_slot_merges: LodgingSlotMergesResponse
  lodging_unit_aliases: LodgingUnitAliasesResponse
  lodging_units: LodgingUnitsResponse
  normalized_mappings: NormalizedMappingsResponse
  original_bunk_requests: OriginalBunkRequestsResponse
  payment_methods: PaymentMethodsResponse
  person_custom_values: PersonCustomValuesResponse
  person_tag_defs: PersonTagDefsResponse
  persons: PersonsResponse
  quest_registrations: QuestRegistrationsResponse
  roles: RolesResponse
  saved_scenarios: SavedScenariosResponse
  session_groups: SessionGroupsResponse
  sheets_workbooks: SheetsWorkbooksResponse
  solver_runs: SolverRunsResponse
  staff: StaffResponse
  staff_applications: StaffApplicationsResponse
  staff_org_categories: StaffOrgCategoriesResponse
  staff_positions: StaffPositionsResponse
  staff_program_areas: StaffProgramAreasResponse
  staff_skills: StaffSkillsResponse
  staff_vehicle_info: StaffVehicleInfoResponse
  sync_runs: SyncRunsResponse
  user_roles: UserRolesResponse
  users: UsersResponse
}

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<
  {
    // Omit AutoDate fields
    [
      K in keyof T as Extract<T[K], IsoAutoDateString> extends never ? K : never // Convert FileNameString to File
    ]: T[K] extends infer U
      ? U extends FileNameString | FileNameString[]
        ? U extends any[]
          ? File[]
          : File
        : U
      : never
  },
  'id'
>

// Create type for Auth collections
export type CreateAuth<T> = {
  id?: RecordIdString
  email: string
  emailVisibility?: boolean
  password: string
  passwordConfirm: string
  verified?: boolean
} & ProcessCreateAndUpdateFields<T>

// Create type for Base collections
export type CreateBase<T> = {
  id?: RecordIdString
} & ProcessCreateAndUpdateFields<T>

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
  Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
  email?: string
  emailVisibility?: boolean
  oldPassword?: string
  password?: string
  passwordConfirm?: string
  verified?: boolean
}

// Update type for Base collections
export type UpdateBase<T> = Partial<Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>>

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
  CollectionResponses[T] extends AuthSystemFields
    ? CreateAuth<CollectionRecords[T]>
    : CreateBase<CollectionRecords[T]>

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
  CollectionResponses[T] extends AuthSystemFields
    ? UpdateAuth<CollectionRecords[T]>
    : UpdateBase<CollectionRecords[T]>

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
  collection<T extends keyof CollectionResponses>(
    idOrName: T
  ): RecordService<CollectionResponses[T]>
} & PocketBase
