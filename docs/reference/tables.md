# Tables Reference

This document catalogs all PocketBase collections (tables) in the Kindred system, their sources, purposes, and key fields.

## Overview

Kindred uses PocketBase as its database layer. All collections follow these patterns:

- **CampMinder IDs**: Cross-table relationships use CampMinder IDs (`cm_id`, `person_id`, etc.), never PocketBase IDs
- **Year Scoping**: Most data tables include a `year` field to isolate data across camp seasons
- **Auto Timestamps**: All tables include `created` and `updated` autodate fields
- **Access Rules**: All tables require authentication (`@request.auth.id != ""`)

## Quick Reference

| Table | Category | Source | Purpose |
|-------|----------|--------|---------|
| `person_tag_defs` | Global Lookup | CampMinder | Tag definitions (Alumni, Volunteer, etc.) |
| `custom_field_defs` | Global Lookup | CampMinder | Custom field schema definitions |
| `divisions` | Global Lookup | CampMinder | Age/gender group definitions |
| `staff_positions` | Global Lookup | CampMinder | Staff position definitions |
| `staff_program_areas` | Global Lookup | CampMinder | Program area categories |
| `staff_org_categories` | Global Lookup | CampMinder | Organizational categories |
| `financial_categories` | Global Lookup | CampMinder | Transaction categories |
| `payment_methods` | Global Lookup | CampMinder | Payment method types |
| `config` | Configuration | Manual | Application configuration values |
| `config_sections` | Configuration | Manual | UI section definitions for config |
| `session_groups` | Year-Scoped | CampMinder | Session groupings (Main, Family, etc.) |
| `camp_sessions` | Year-Scoped | CampMinder | Session definitions with dates |
| `households` | Year-Scoped | CampMinder | Family/household records |
| `persons` | Year-Scoped | CampMinder | Person demographics and contacts |
| `attendees` | Year-Scoped | CampMinder | Person-session enrollments |
| `bunks` | Year-Scoped | CampMinder | Cabin definitions |
| `bunk_plans` | Year-Scoped | CampMinder | Bunk-session configurations |
| `staff` | Year-Scoped | CampMinder | Staff employment records |
| `financial_transactions` | Year-Scoped | CampMinder | Transaction details |
| `original_bunk_requests` | Bunking | CampMinder CSV | Raw request data from exports |
| `bunk_requests` | Bunking | Computed | Parsed and resolved requests |
| `bunk_request_sources` | Bunking | Computed | Links requests to sources |
| `bunk_assignments` | Bunking | CampMinder | Production cabin assignments |
| `bunk_assignments_draft` | Bunking | Manual | Draft assignments for planning |
| `saved_scenarios` | Solver | Manual | Named scenario configurations |
| `solver_runs` | Solver | Computed | Solver execution history |
| `locked_groups` | Solver | Manual | Lock groups for solver |
| `locked_group_members` | Solver | Manual | Members of lock groups |
| `person_custom_values` | Custom Fields | CampMinder | Custom field values for persons |
| `household_custom_values` | Custom Fields | CampMinder | Custom field values for households |
| `camper_history` | Computed | Go Sync | Denormalized camper history |
| `family_camp_adults` | Computed | Go Sync | Family camp adult attendees |
| `family_camp_registrations` | Computed | Go Sync | Family camp registration details |
| `family_camp_medical` | Computed | Go Sync | Family camp medical/dietary info |
| `users` | System | PocketBase | User authentication records |
| `debug_parse_results` | System | Computed | AI parsing debug data |

---

## Global Lookups

These tables store reference data that doesn't change year-to-year. No `year` field.

### person_tag_defs

Tag definitions from CampMinder `/persons/tags` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `name` | text | Tag name (unique identifier) |
| `is_seasonal` | bool | Whether tag is seasonal |
| `is_hidden` | bool | Whether tag is hidden |
| `last_updated_utc` | text | CampMinder timestamp |

**Unique**: `name`

### custom_field_defs

Custom field definitions from CampMinder `/persons/custom-fields` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Field name |
| `data_type` | select | None/String/Integer/Decimal/Date/Time/DateTime/Boolean |
| `partition` | select | Entity type(s): Family/Alumnus/Staff/Camper/Parent/Adult |
| `is_seasonal` | bool | Whether field is seasonal |
| `is_array` | bool | Whether field holds multiple values |
| `is_active` | bool | Whether field is active |

**Unique**: `cm_id`

### divisions

Age/gender group definitions from CampMinder `/divisions` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Division name (e.g., "Boys 3rd-4th Grade") |
| `description` | text | Optional description |
| `start_grade_id` | number | Starting grade |
| `end_grade_id` | number | Ending grade |
| `gender_id` | number | Gender identifier |
| `capacity` | number | Division capacity |
| `parent_division` | relation | Self-reference to parent division |
| `assign_on_enrollment` | bool | Auto-assign on enrollment |
| `staff_only` | bool | Staff-only division |

**Unique**: `cm_id`

### staff_positions

Staff position definitions from CampMinder `/staff/positions` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Position name |
| `program_area` | relation | Link to staff_program_areas |

**Unique**: `cm_id`

### staff_program_areas

Program area definitions from CampMinder `/staff/programareas` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Program area name |

**Unique**: `cm_id`

### staff_org_categories

Organizational categories from CampMinder `/staff/organizationalcategories` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Category name |

**Unique**: `cm_id`

### financial_categories

Financial categories from CampMinder `/financials/financialcategories` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Category name (e.g., "Fees - Summer Camp") |
| `is_archived` | bool | Whether category is archived |

**Unique**: `cm_id`

### payment_methods

Payment methods from CampMinder `/financials/paymentmethods` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Method name (Check, Credit Card, etc.) |

**Unique**: `cm_id`

---

## Configuration

Application configuration stored in the database (not JSON files).

### config

Application configuration values with metadata for UI rendering.

| Field | Type | Description |
|-------|------|-------------|
| `category` | text | Config category (e.g., "constraint", "ai") |
| `subcategory` | text | Optional subcategory |
| `config_key` | text | Key within category |
| `value` | json | Configuration value (any type) |
| `metadata` | json | UI metadata (type, min/max, tooltips) |
| `description` | text | Human-readable description |

**Unique**: `(category, subcategory, config_key)`

### config_sections

UI section definitions for organizing configuration display.

| Field | Type | Description |
|-------|------|-------------|
| `section_key` | text | Section identifier |
| `title` | text | Display title |
| `description` | text | Section description |
| `display_order` | number | Sort order |
| `expanded_by_default` | bool | Whether expanded in UI |

**Unique**: `section_key`

---

## Year-Scoped Base Data

Core data tables synced from CampMinder, scoped by `year` field.

### session_groups

Session groupings from CampMinder (e.g., "Main Sessions", "Family Camps").

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder ID |
| `name` | text | Group name |
| `description` | text | Optional description |
| `is_active` | bool | Whether group is active |
| `sort_order` | number | Display order |
| `year` | number | Camp year |

**Unique**: `(cm_id, year)`

### camp_sessions

Session definitions with dates and type information.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder session ID |
| `name` | text | Session name |
| `year` | number | Camp year |
| `start_date` | date | Session start |
| `end_date` | date | Session end |
| `session_type` | select | main/embedded/ag/family/quest/training/etc. |
| `parent_id` | number | CampMinder ID of parent session (AG only) |
| `session_group` | relation | Link to session_groups |
| `is_day` | bool | Day camp session |
| `is_residential` | bool | Overnight session |
| `is_for_children` | bool | Children's session |
| `is_for_adults` | bool | Adult session |
| `start_grade_id` | number | Grade range start |
| `end_grade_id` | number | Grade range end |
| `gender_id` | number | Gender restriction |

**Unique**: `(cm_id, year)`

**Related**: See CLAUDE.md "Session Types and Bunking Structure" for type details.

### households

Household/family records from CampMinder persons response.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder household ID |
| `greeting` | text | Greeting text |
| `mailing_title` | text | Primary mailing title |
| `alternate_mailing_title` | text | Alternate mailing title |
| `billing_mailing_title` | text | Billing mailing title |
| `household_phone` | text | Phone number |
| `billing_address` | json | Address object |
| `year` | number | Camp year |

**Unique**: `(cm_id, year)`

### persons

Person records with demographics, contacts, and relationships.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder person ID |
| `first_name` | text | First name |
| `last_name` | text | Last name |
| `preferred_name` | text | Preferred/nickname |
| `birthdate` | text | Date of birth |
| `gender` | text | M/F/etc. |
| `grade` | number | Current grade |
| `age` | number | Age (computed) |
| `school` | text | School name |
| `years_at_camp` | number | Years attended |
| `last_year_attended` | number | Last year at camp |
| `household` | relation | Primary household |
| `household_id` | number | CampMinder household ID |
| `primary_childhood_household` | relation | Primary childhood household |
| `alternate_childhood_household` | relation | Alternate childhood household |
| `division` | relation | Assigned division |
| `tags` | relation | Multi-relation to person_tag_defs |
| `is_camper` | bool | Is a camper (vs parent/staff) |
| `parent_names` | json | Parent names array |
| `phone_numbers` | json | Phone numbers array |
| `email_addresses` | json | Email addresses array |
| `address` | json | Address object |
| `year` | number | Camp year |

**Unique**: `(cm_id, year)`

### attendees

Links persons to camp sessions with enrollment status.

| Field | Type | Description |
|-------|------|-------------|
| `person_id` | number | CampMinder person ID |
| `person` | relation | Link to persons |
| `session` | relation | Link to camp_sessions |
| `status` | select | enrolled/applied/waitlisted/cancelled/etc. |
| `status_id` | number | CampMinder status ID (1=None, 2=Enrolled, 4=Applied, 8=WaitList, 16=LeftEarly, 32=Cancelled, 64=Dismissed, 128=Inquiry, 256=Withdrawn, 512=Incomplete) |
| `enrollment_date` | date | Enrollment date |
| `is_active` | bool | Active enrollment |
| `year` | number | Camp year |

**Unique**: `(person_id, year, session)`

**Filtering**: Solver uses `is_active = 1 AND status_id = 2` for active enrollees.

### bunks

Cabin/bunk definitions.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder bunk ID |
| `name` | text | Bunk name (B-1, G-3, AG-8, etc.) |
| `year` | number | Camp year |
| `gender` | text | M/F/Mixed |
| `is_active` | bool | Whether bunk is active |
| `sort_order` | number | Display order |
| `area_id` | number | Area identifier |

**Unique**: `(cm_id, year)`

**Note**: `gender = 'Mixed'` indicates AG (All-Gender) bunks. Names with `AG-` prefix.

### bunk_plans

Links bunks to sessions with activation settings.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder bunk plan ID |
| `bunk` | relation | Link to bunks |
| `session` | relation | Link to camp_sessions |
| `name` | text | Plan name |
| `code` | text | Optional code |
| `year` | number | Camp year |
| `is_active` | bool | Whether plan is active |

**Unique**: `(year, bunk, session, cm_id)`

**Capacity**: Calculated as `bunk_plans count × defaultCapacity` (from config, typically 12).

### staff

Staff employment records from CampMinder `/staff` endpoint.

| Field | Type | Description |
|-------|------|-------------|
| `person` | relation | Link to persons |
| `year` | number | Camp year |
| `status_id` | number | 1-4 status code |
| `status` | select | active/resigned/dismissed/cancelled |
| `organizational_category` | relation | Link to staff_org_categories |
| `position1` | relation | Primary position |
| `position2` | relation | Secondary position |
| `division` | relation | Assigned division |
| `bunks` | relation | Multi-relation to assigned bunks |
| `bunk_staff` | bool | Is bunk staff |
| `hire_date` | date | Hire date |
| `employment_start_date` | date | Start date |
| `employment_end_date` | date | End date |
| `international` | select | domestic/international |
| `years` | number | Years on staff |
| `salary` | number | Salary amount |

**Unique**: `(year, person)`

### financial_transactions

Transaction details from CampMinder `/financials/transactionreporting/transactiondetails`.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder transaction ID |
| `transaction_number` | number | Transaction number |
| `year` | number | Camp year |
| `post_date` | date | Posting date |
| `effective_date` | date | Effective date |
| `service_start_date` | date | Service period start |
| `service_end_date` | date | Service period end |
| `is_reversed` | bool | Transaction was reversed |
| `reversal_date` | date | Reversal date |
| `financial_category` | relation | Link to financial_categories |
| `description` | text | Description |
| `quantity` | number | Quantity |
| `unit_amount` | number | Unit price |
| `amount` | number | Total amount |
| `payment_method` | relation | Link to payment_methods |
| `session` | relation | Link to camp_sessions |
| `session_group` | relation | Link to session_groups |
| `division` | relation | Link to divisions |
| `person` | relation | Link to persons |
| `household` | relation | Link to households |

**Unique**: `(cm_id, amount)` - Handles debit/credit pairs with same ID.

---

## Bunking & Requests

Tables for managing bunk requests and assignments.

### original_bunk_requests

Raw bunk request data from CampMinder CSV exports.

| Field | Type | Description |
|-------|------|-------------|
| `year` | number | Camp year |
| `requester` | relation | Link to persons (the camper) |
| `field` | select | bunk_with/not_bunk_with/bunking_notes/internal_notes/socialize_with |
| `content` | text | Raw field content |
| `content_hash` | text | MD5 hash for change detection |
| `processed` | date | When processed (null = pending) |

**Unique**: `(year, field, requester)`

**Sync**: Go bunk_requests.go → Python processor → bunk_requests table

### bunk_requests

Parsed and resolved bunk requests (output of Python processor).

| Field | Type | Description |
|-------|------|-------------|
| `requester_id` | number | CampMinder person ID (requester) |
| `requestee_id` | number | CampMinder person ID (target, optional) |
| `requested_person_name` | text | Original name before resolution |
| `request_type` | select | bunk_with/not_bunk_with/age_preference |
| `status` | select | resolved/pending/declined |
| `year` | number | Camp year |
| `session_id` | number | CampMinder session ID |
| `priority` | number | 1-10 priority |
| `original_text` | text | Original request text |
| `confidence_score` | number | AI confidence 0.0-1.0 |
| `confidence_level` | text | Confidence description |
| `confidence_explanation` | json | Detailed breakdown |
| `source` | select | family/staff/notes |
| `source_field` | text | CSV field source |
| `csv_position` | number | Position in field (1-based) |
| `ai_parsed` | bool | Was parsed by AI |
| `ai_p1_reasoning` | json | Phase 1 AI reasoning |
| `ai_p3_reasoning` | json | Phase 3 AI reasoning |
| `is_reciprocal` | bool | Mutual request |
| `requires_manual_review` | bool | Needs staff review |
| `manual_review_reason` | text | Review reason |
| `merged_into` | relation | Self-reference for merged requests |
| `age_preference_target` | text | For age_preference type |
| `is_active` | bool | Request is active |
| `request_locked` | bool | Protected from sync overwrites |

**Unique**: `(requester_id, requestee_id, request_type, year, session_id, source_field)`

### bunk_request_sources

Junction table linking bunk_requests to their source original_bunk_requests.

| Field | Type | Description |
|-------|------|-------------|
| `bunk_request` | relation | Link to bunk_requests |
| `original_request` | relation | Link to original_bunk_requests |
| `is_primary` | bool | Primary source for this request |
| `source_field` | text | Field name for quick access |
| `parse_notes` | text | Notes from parsing |

**Unique**: `(bunk_request, original_request)`

**Purpose**: Enables cross-run deduplication and partial invalidation when sources change.

### bunk_assignments

Production cabin assignments from CampMinder.

| Field | Type | Description |
|-------|------|-------------|
| `cm_id` | number | CampMinder assignment ID |
| `person` | relation | Link to persons |
| `session` | relation | Link to camp_sessions |
| `bunk` | relation | Link to bunks |
| `bunk_plan` | relation | Link to bunk_plans |
| `year` | number | Camp year |
| `is_deleted` | bool | Soft delete flag |

**Unique**: `(year, person, session)`

### bunk_assignments_draft

Draft assignments for scenario planning (what-if analysis).

| Field | Type | Description |
|-------|------|-------------|
| `scenario` | relation | Link to saved_scenarios |
| `year` | number | Camp year |
| `person` | relation | Link to persons |
| `session` | relation | Link to camp_sessions |
| `bunk` | relation | Link to bunks |
| `bunk_plan` | relation | Link to bunk_plans |
| `assignment_locked` | bool | Locked assignment |

**Unique**: `(year, session, person, scenario)`

---

## Solver & Scenarios

Tables for constraint solver and scenario management.

### saved_scenarios

Named scenario configurations for cabin assignment planning.

| Field | Type | Description |
|-------|------|-------------|
| `name` | text | Scenario name |
| `description` | text | Optional description |
| `session` | relation | Link to camp_sessions |
| `is_active` | bool | Active scenario |
| `year` | number | Camp year |
| `metadata` | json | Additional metadata |

**Indexes**: `session`, `year`

### solver_runs

Solver execution history with status, progress, and results.

| Field | Type | Description |
|-------|------|-------------|
| `session` | text | Session identifier |
| `run_id` | text | Unique run identifier |
| `status` | select | pending/running/success/failed/error |
| `progress` | number | 0-100 progress |
| `started_at` | date | Start timestamp |
| `completed_at` | date | Completion timestamp |
| `logs` | json | Execution logs |
| `error` | json | Error details |
| `result` | json | Solver result |
| `details` | json | Detailed breakdown |
| `request_data` | json | Input request data |
| `assignment_counts` | json | Assignment statistics |
| `stats` | json | Performance statistics |
| `scenario` | relation | Link to saved_scenarios |
| `run_type` | text | Type of run |
| `triggered_by` | text | Who triggered the run |
| `session_id` | number | CampMinder session ID |

**Unique**: `run_id`

### locked_groups

Lock groups to keep campers together during solver runs.

| Field | Type | Description |
|-------|------|-------------|
| `scenario` | relation | Link to saved_scenarios |
| `name` | text | Group name |
| `session` | relation | Link to camp_sessions |
| `year` | number | Camp year |
| `color` | text | Display color for UI |
| `created_by` | text | Creator identifier |

**Indexes**: `scenario`, `session`, `(scenario, session, year)`

### locked_group_members

Junction table for lock group membership.

| Field | Type | Description |
|-------|------|-------------|
| `group` | relation | Link to locked_groups (cascade delete) |
| `attendee` | relation | Link to attendees |
| `added_by` | text | Who added this member |

**Unique**: `(group, attendee)`

---

## Custom Field Values

Stores custom field values synced from CampMinder (on-demand sync, not daily).

### person_custom_values

Custom field values for persons.

| Field | Type | Description |
|-------|------|-------------|
| `person` | relation | Link to persons |
| `field_definition` | relation | Link to custom_field_defs |
| `value` | text | Field value (typed by definition) |
| `year` | number | Camp year |
| `last_updated` | text | CampMinder timestamp |

**Unique**: `(year, person, field_definition)`

**Sync**: Requires 1 API call per person - not part of daily sync.

### household_custom_values

Custom field values for households.

| Field | Type | Description |
|-------|------|-------------|
| `household` | relation | Link to households |
| `field_definition` | relation | Link to custom_field_defs |
| `value` | text | Field value (typed by definition) |
| `year` | number | Camp year |
| `last_updated` | text | CampMinder timestamp |

**Unique**: `(year, household, field_definition)`

**Sync**: Requires 1 API call per household - not part of daily sync.

---

## Computed/Derived

Tables computed from base data by Go sync services.

### camper_history

Denormalized camper history for nonprofit reporting and analytics.

| Field | Type | Description |
|-------|------|-------------|
| `person_id` | number | CampMinder person ID |
| `first_name` | text | First name |
| `last_name` | text | Last name |
| `year` | number | Camp year |
| `sessions` | text | Comma-separated session names |
| `bunks` | text | Comma-separated bunk names |
| `school` | text | School name |
| `city` | text | City |
| `grade` | number | Grade |
| `is_returning` | bool | Returning camper |
| `years_at_camp` | number | Total years |
| `prior_year_sessions` | text | Prior year sessions |
| `prior_year_bunks` | text | Prior year bunks |

**Unique**: `(person_id, year)`

**Computed by**: `pocketbase/sync/camper_history.go`
**Exported to**: Google Sheets `{year}-camper-history`

### family_camp_adults

Family camp adult attendees extracted from custom values.

| Field | Type | Description |
|-------|------|-------------|
| `household` | relation | Link to households |
| `year` | number | Camp year |
| `adult_number` | number | 1-5 |
| `name` | text | Full name |
| `first_name` | text | First name |
| `last_name` | text | Last name |
| `email` | text | Email address |
| `pronouns` | text | Pronouns |
| `gender` | text | Gender |
| `date_of_birth` | text | Date of birth |
| `relationship_to_camper` | text | Relationship |

**Unique**: `(household, year, adult_number)`

**Computed by**: `pocketbase/sync/family_camp_derived.go`

### family_camp_registrations

Family camp registration details per household.

| Field | Type | Description |
|-------|------|-------------|
| `household` | relation | Link to households |
| `year` | number | Camp year |
| `cabin_assignment` | text | Assigned cabin |
| `share_cabin_preference` | text | Sharing preference |
| `shared_cabin_with` | text | Actual cabin mates |
| `arrival_eta` | text | Estimated arrival |
| `special_occasions` | text | Special occasions |
| `goals` | text | Goals for camp |
| `notes` | text | Additional notes |
| `needs_accommodation` | bool | Requires accommodation |
| `opt_out_vip` | bool | Opted out of VIP |

**Unique**: `(household, year)`

**Computed by**: `pocketbase/sync/family_camp_derived.go`

### family_camp_medical

Family camp medical and dietary information per household.

| Field | Type | Description |
|-------|------|-------------|
| `household` | relation | Link to households |
| `year` | number | Camp year |
| `cpap_info` | text | CPAP information |
| `physician_info` | text | Physician details |
| `special_needs_info` | text | Special needs |
| `allergy_info` | text | Allergies |
| `dietary_info` | text | Dietary restrictions |
| `additional_info` | text | Additional medical info |

**Unique**: `(household, year)`

**Computed by**: `pocketbase/sync/family_camp_derived.go`

---

## System

PocketBase system tables and debug/development tables.

### users

PocketBase user authentication collection (`_pb_users_auth_`).

Modified by migration to allow authenticated users to list all users (for admin panel).

**Note**: OAuth2 configuration is handled by the bootstrap script, not migrations.

### debug_parse_results

Stores Phase 1 AI parsing results for debugging and prompt iteration.

| Field | Type | Description |
|-------|------|-------------|
| `original_request` | relation | Link to original_bunk_requests |
| `session` | relation | Link to camp_sessions |
| `parsed_intents` | json | Parsed intent data |
| `ai_raw_response` | json | Raw AI response |
| `token_count` | number | Tokens used |
| `prompt_version` | text | Prompt version |
| `processing_time_ms` | number | Processing time |
| `is_valid` | bool | Valid parse |
| `error_message` | text | Error if invalid |

**Indexes**: `original_request`, `session`, `created`

**Purpose**: Separate from production bunk_requests for safe debugging and prompt development.

---

## Data Flow Diagram

```
CampMinder API
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  Go Sync Services (pocketbase/sync/)                        │
│                                                             │
│  sessions.go ──────────► camp_sessions                      │
│  persons.go ───────────► persons, households                │
│  attendees.go ─────────► attendees                          │
│  bunks.go ─────────────► bunks                              │
│  bunk_plans.go ────────► bunk_plans                         │
│  bunk_assignments.go ──► bunk_assignments                   │
│  bunk_requests.go ─────► original_bunk_requests             │
│  staff.go ─────────────► staff                              │
│  financial_transactions.go ──► financial_transactions       │
│  *_custom_values.go ───► person/household_custom_values     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  Python Processor (bunking/sync/bunk_request_processor/)    │
│                                                             │
│  original_bunk_requests ──► bunk_requests                   │
│                          └► bunk_request_sources            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  Go Derived Tables (pocketbase/sync/)                       │
│                                                             │
│  camper_history.go ──────► camper_history                   │
│  family_camp_derived.go ─► family_camp_adults               │
│                          └► family_camp_registrations       │
│                          └► family_camp_medical             │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  Solver & UI                                                │
│                                                             │
│  FastAPI Solver ───► solver_runs                            │
│                  ───► bunk_assignments_draft                │
│  Frontend ───────► saved_scenarios, locked_groups           │
└─────────────────────────────────────────────────────────────┘
```

---

## Migration Numbering

Migrations are numbered `1500000XXX_table_name.js`:

| Range | Purpose |
|-------|---------|
| 001-010 | Global lookups |
| 011-012 | Configuration |
| 013-019 | Year-scoped base data |
| 020-027 | Bunking, scenarios, solver |
| 028-032 | Custom values, staff, financials, users |
| 033-035 | Computed/derived tables |

See `pocketbase/pb_migrations/` for full migration source code.
